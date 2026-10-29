#!/usr/bin/env node
/**
 * Agzos Code — assinatura local de um .app já empacotado (macOS).
 *
 * O electron-builder só assina automaticamente com certificado
 * "Developer ID Application". Para testes locais usamos a identidade
 * "Rodrigo Dev Local" (Keychain), que dá uma identidade estável ao TCC.
 *
 * Uso:
 *   node tools/sign-mac-app.js [caminho/App.app]
 *   npm run sign:mac:dist
 *
 * Sem identidade válida (CI/outra máquina), avisa e não quebra.
 * Isto NÃO substitui Developer ID + notarização da Fase 5.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEFAULT_IDENTITY = 'Rodrigo Dev Local';
const BUNDLE_ID = 'com.agzos.code';

const USAGE_STRINGS = {
  NSDesktopFolderUsageDescription:
    'O Agzos Code acessa a Área de Trabalho apenas para abrir a pasta que você escolher.',
  NSDocumentsFolderUsageDescription:
    'O Agzos Code acessa seus Documentos apenas para abrir a pasta que você escolher.',
  NSDownloadsFolderUsageDescription:
    'O Agzos Code acessa seus Downloads apenas para abrir a pasta que você escolher.',
};

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf-8' });
}

function setPlistString(plist, key, value) {
  let r = run('plutil', ['-replace', key, '-string', value, plist]);
  if (r.status !== 0) r = run('plutil', ['-insert', key, '-string', value, plist]);
  if (r.status !== 0) throw new Error(`plutil falhou em ${key}: ${r.stderr || r.stdout}`);
}

function findIdentity(identity) {
  const r = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (r.status !== 0) return false;
  return r.stdout.includes(`"${identity}"`);
}

function findApp() {
  const candidates = [];
  for (const dir of ['mac-arm64', 'mac', 'mac-x64', 'mac-universal']) {
    candidates.push(path.join(ROOT, 'dist', dir, 'Agzos Code.app'));
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function signApp(appPath, { identity = process.env.AGZOS_MAC_SIGN_IDENTITY || DEFAULT_IDENTITY } = {}) {
  if (process.platform !== 'darwin') return { signed: false, reason: 'not-darwin' };
  if (!fs.existsSync(appPath)) throw new Error(`App não encontrado: ${appPath}`);
  if (!findIdentity(identity)) {
    console.warn(`⚠ Identidade "${identity}" não encontrada — .app segue sem assinatura estável.`);
    return { signed: false, reason: 'identity-missing' };
  }

  const plist = path.join(appPath, 'Contents', 'Info.plist');
  setPlistString(plist, 'CFBundleIdentifier', BUNDLE_ID);
  for (const [key, value] of Object.entries(USAGE_STRINGS)) {
    setPlistString(plist, key, value);
  }

  // Assinatura local: identidade estável, sem hardened runtime/notarização.
  const sign = run('codesign', ['--force', '--deep', '--sign', identity, '--timestamp=none', appPath]);
  if (sign.status !== 0) {
    throw new Error(`codesign falhou: ${sign.stderr || sign.stdout}`);
  }

  const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  if (verify.status !== 0) {
    throw new Error(`codesign --verify falhou: ${verify.stderr || verify.stdout}`);
  }

  const info = run('codesign', ['-dv', '--verbose=4', appPath]);
  const authority = (info.stderr || '').split('\n').find((line) => line.startsWith('Authority='));
  console.log(`✓ ${path.basename(appPath)} assinado com "${identity}" (${BUNDLE_ID})`);
  if (authority) console.log(`  ${authority}`);
  return { signed: true, identity };
}

function main() {
  if (process.platform !== 'darwin') {
    console.log('• Assinatura de .app só se aplica ao macOS.');
    return;
  }
  const target = process.argv[2] ? path.resolve(process.argv[2]) : findApp();
  if (!target) {
    console.error('✗ Nenhum .app encontrado em dist/. Rode `npm run pack` antes.');
    process.exitCode = 1;
    return;
  }
  signApp(target);
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`✗ Assinatura falhou: ${e.message}`);
    process.exitCode = 1;
  }
}

module.exports = { signApp, findIdentity, BUNDLE_ID };
