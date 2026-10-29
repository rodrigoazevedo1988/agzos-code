/**
 * Agzos Code — remove sujeira do macOS de um diretório empacotado.
 *
 * Zip/arraste de uma pasta gerada no Mac no Windows deixa arquivos AppleDouble
 * (`._Agzos Code.exe`, `._app.asar`), `.DS_Store`, `._.DS_Store`, `.AppleDouble/`
 * e `.LSOverride` junto do app. O electron-builder já exclui a maioria pelo
 * `build.files`, mas `extraResources`, `asarUnpack` e cópias manuais escapam,
 * então o hook `afterPack` varre a saída como cinto e suspensório.
 */

const fs = require('fs');
const path = require('path');

// Nomes removidos em qualquer nível da árvore.
const JUNK_NAMES = new Set(['.DS_Store', '.LSOverride', 'Thumbs.db']);
// Prefixos removidos (arquivos `._*` do AppleDouble, em qualquer nível).
const JUNK_PREFIXES = ['._'];
// Diretórios removidos inteiros.
const JUNK_DIRS = new Set(['.AppleDouble']);

function isJunk(name) {
  if (JUNK_NAMES.has(name)) return true;
  if (JUNK_DIRS.has(name)) return true;
  return JUNK_PREFIXES.some((p) => name.startsWith(p) && name.length > p.length);
}

/**
 * Varre `dir` recursivamente e apaga os arquivos/diretórios de sujeira do macOS.
 * Nunca segue links simbólicos (evita apagar fora de `dir`).
 * @returns {string[]} caminhos removidos, em ordem de descoberta
 */
function scrubAppleDouble(dir) {
  const removed = [];

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (isJunk(entry.name)) {
        try {
          fs.rmSync(full, { recursive: true, force: true });
          removed.push(full);
        } catch {
          // arquivo em uso/locked: segue, o build não deve quebrar por isso
        }
        continue;
      }
      // `entry.isDirectory()` é falso para symlink: não descemos em links.
      if (entry.isDirectory()) walk(full);
    }
  }

  if (dir && fs.existsSync(dir)) walk(dir);
  return removed;
}

module.exports = { scrubAppleDouble, isJunk, JUNK_NAMES, JUNK_PREFIXES, JUNK_DIRS };
