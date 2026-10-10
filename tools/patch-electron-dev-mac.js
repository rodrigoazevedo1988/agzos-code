#!/usr/bin/env node
/**
 * Agzos Code — branding do Electron.app de desenvolvimento (só macOS)
 *
 * Em `npm run dev` o macOS lê nome e ícone do bundle
 * node_modules/electron/dist/Electron.app, não do nosso package.json.
 * Resultado: Dock e menu mostram "Electron" com o ícone do Electron
 * (app.dock.setIcon só troca o ícone depois do boot).
 *
 * Este script:
 *   - copia build/icon.icns para Contents/Resources/electron.icns
 *   - define CFBundleName / CFBundleDisplayName = "Agzos Code" no Info.plist
 *   - toca o bundle para o Finder/Dock recarregarem o ícone
 *
 * Roda no postinstall e após `npm run build:icons`. Em outras plataformas
 * não faz nada. Reverter: `rm -rf node_modules/electron && npm install`.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const APP_NAME = 'Agzos Code';
const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
const ICNS = path.join(ROOT, 'build', 'icon.icns');

function main() {
  if (process.platform !== 'darwin') return;
  if (!fs.existsSync(BUNDLE)) {
    console.warn('⚠ Electron.app não encontrado — pulando patch de branding (dev).');
    return;
  }

  if (fs.existsSync(ICNS)) {
    fs.copyFileSync(ICNS, path.join(BUNDLE, 'Contents', 'Resources', 'electron.icns'));
  }

  const plist = path.join(BUNDLE, 'Contents', 'Info.plist');
  for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    let r = spawnSync('plutil', ['-replace', key, '-string', APP_NAME, plist]);
    if (r.status !== 0) r = spawnSync('plutil', ['-insert', key, '-string', APP_NAME, plist]);
    if (r.status !== 0) console.warn(`⚠ plutil falhou em ${key}: ${r.stderr}`);
  }

  spawnSync('touch', [BUNDLE]);
  console.log(`✓ Electron.app de dev com nome e ícone "${APP_NAME}"`);
  console.log('  Se o Dock ainda mostrar o ícone antigo: killall Dock');
}

main();
