#!/usr/bin/env node
/**
 * Agzos Code — Setup de assets vendor
 *
 * Copia os assets do Monaco Editor e xterm.js de node_modules
 * para src/renderer/vendor/ para que o renderer (com CSP restritiva)
 * possa carregá-los via <script> e <link>.
 *
 * Uso:
 *   node tools/setup-vendor.js
 *
 * Idempotente: sobrescreve os alvos.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'src', 'renderer', 'vendor');

function rimraf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function ensureCleanVendor() {
  rimraf(VENDOR);
  fs.mkdirSync(VENDOR, { recursive: true });
}

function copyMonaco() {
  const monacoRoot = path.join(ROOT, 'node_modules', 'monaco-editor');
  if (!fs.existsSync(monacoRoot)) {
    console.error('✗ monaco-editor não encontrado em node_modules. Rode `npm install` primeiro.');
    process.exit(1);
  }
  // O monaco-editor expõe o esm/ completo. Para o loader AMD legacy (vs/loader.js),
  // precisamos do `monaco-editor/min/vs`. O conteúdo vai pra vendor/monaco/vs/
  // pra que o AMD loader encontre `loader.js` em vs/loader.js.
  const src = path.join(monacoRoot, 'min', 'vs');
  if (!fs.existsSync(src)) {
    console.error('✗ monaco-editor/min/vs não encontrado. Versão muito antiga?');
    process.exit(1);
  }
  const dst = path.join(VENDOR, 'monaco', 'vs');
  copyDir(src, dst);
  const size = dirSize(dst);
  console.log(`✓ Monaco copiado para ${path.relative(ROOT, dst)} (${formatSize(size)})`);
}

function copyXterm() {
  const xtermRoot = path.join(ROOT, 'node_modules', 'xterm');
  const fitRoot = path.join(ROOT, 'node_modules', 'xterm-addon-fit');
  if (!fs.existsSync(xtermRoot) || !fs.existsSync(fitRoot)) {
    console.error('✗ xterm/xterm-addon-fit não encontrados em node_modules. Rode `npm install` primeiro.');
    process.exit(1);
  }
  const dst = path.join(VENDOR, 'xterm');
  fs.mkdirSync(dst, { recursive: true });

  // xterm css
  const xtermCss = path.join(xtermRoot, 'css', 'xterm.css');
  if (fs.existsSync(xtermCss)) {
    fs.copyFileSync(xtermCss, path.join(dst, 'xterm.css'));
  }
  // xterm js (UMD)
  const xtermJs = path.join(xtermRoot, 'lib', 'xterm.js');
  if (fs.existsSync(xtermJs)) {
    fs.copyFileSync(xtermJs, path.join(dst, 'xterm.js'));
  }
  // fit addon
  const fitJs = path.join(fitRoot, 'lib', 'xterm-addon-fit.js');
  if (fs.existsSync(fitJs)) {
    fs.mkdirSync(path.join(dst, 'addon'), { recursive: true });
    fs.copyFileSync(fitJs, path.join(dst, 'addon', 'fit.js'));
  }
  console.log(`✓ xterm copiado para ${path.relative(ROOT, dst)}`);
}

function copyLucide() {
  const lucideRoot = path.join(ROOT, 'node_modules', 'lucide-static');
  if (!fs.existsSync(lucideRoot)) {
    console.error('✗ lucide-static não encontrado em node_modules. Rode `npm install` primeiro.');
    process.exit(1);
  }
  const dst = path.join(VENDOR, 'lucide');
  fs.mkdirSync(dst, { recursive: true });
  const spritePath = path.join(lucideRoot, 'sprite.svg');
  if (!fs.existsSync(spritePath)) {
    console.error('✗ lucide-static/sprite.svg não encontrado.');
    process.exit(1);
  }
  // Copia sprite.svg cru (pra inspeção)
  fs.copyFileSync(spritePath, path.join(dst, 'sprite.svg'));
  // Gera inline.js que injeta os <symbol> direto no body
  // (mais robusto que fetch em file:// no Electron com CSP)
  const raw = fs.readFileSync(spritePath, 'utf-8');
  const m = raw.match(/<defs>([\s\S]*?)<\/defs>/);
  if (!m) {
    console.error('✗ sprite.svg não contém <defs>…</defs>');
    process.exit(1);
  }
  const symbols = m[1];
  // Escreve um <script> que cria um container invisível com os <symbol>s
  // Usa String.raw pra evitar problemas com caracteres especiais
  const inlineJs = `/* Auto-gerado por tools/setup-vendor.js a partir de lucide-static/sprite.svg */
(function () {
  if (window.__LUCIDE_SPRITE_LOADED__) return;
  window.__LUCIDE_SPRITE_LOADED__ = true;
  var symbols = ${JSON.stringify(symbols)};
  var container = document.createElement('div');
  container.id = 'lucide-sprite';
  container.setAttribute('aria-hidden', 'true');
  container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  container.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + symbols + '</svg>';
  // Insere no body assim que possível
  function inject() {
    if (document.body) {
      document.body.insertBefore(container, document.body.firstChild);
    } else {
      document.addEventListener('DOMContentLoaded', inject);
    }
  }
  inject();
})();
`;
  fs.writeFileSync(path.join(dst, 'inline.js'), inlineJs, 'utf-8');
  const size = fs.statSync(spritePath).size;
  console.log(`✓ Lucide sprite copiado (${formatSize(size)}) + inline.js gerado`);
}

function dirSize(p) {
  let total = 0;
  function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const s = path.join(d, ent.name);
      if (ent.isDirectory()) walk(s);
      else total += fs.statSync(s).size;
    }
  }
  walk(p);
  return total;
}
function formatSize(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1024*1024) return `${(b/1024).toFixed(1)}KB`;
  return `${(b/1024/1024).toFixed(1)}MB`;
}

function main() {
  ensureCleanVendor();
  copyMonaco();
  copyXterm();
  copyLucide();
  console.log('\nVendor pronto. Rode `npm start` para abrir o Agzos Code.');
}

main();
