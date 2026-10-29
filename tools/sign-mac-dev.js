#!/usr/bin/env node
/**
 * Agzos Code — assinatura do Electron.app de desenvolvimento (macOS)
 *
 * Em `npm run dev`, o macOS usa o bundle node_modules/electron/dist/Electron.app.
 * Ele vem assinado em modo ad-hoc e com o bundle id `com.github.Electron`.
 * Resultado: cada rebuild parece um app diferente para o TCC, e o macOS pede
 * permissão de novo para Área de Trabalho/Documentos/Downloads.
 *
 * Este script:
 *   - fixa CFBundleIdentifier = com.agzos.code (mesmo do app empacotado)
 *   - adiciona descrições de uso das pastas protegidas
 *   - assina o bundle com uma identidade estável do Keychain
 *
 * Identidade: AGZOS_MAC_SIGN_IDENTITY ou "Rodrigo Dev Local".
 * Sem identidade válida (CI, outra máquina), sai com aviso e não quebra o install.
 * Para pular de propósito: AGZOS_SKIP_MAC_SIGN=1.
 *
 * Roda depois de patch-electron-dev-mac.js no postinstall e no build:icons.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BUNDLE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
const INFO_PLIST = path.join(BUNDLE, 'Contents', 'Info.plist');
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

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf-8', ...opts });
}

function setPlistString(plist, key, value) {
  let r = run('plutil', ['-replace', key, '-string', value, plist]);
  if (r.status !== 0) r = run('plutil', ['-insert', key, '-string', value, plist]);
  if (r.status !== 0) {
    throw new Error(`plutil falhou em ${key}: ${r.stderr || r.stdout}`);
  }
}

function identityAvailable(identity) {
  const r = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (r.status !== 0) return false;
  return r.stdout.includes(`"${identity}"`);
}

function main() {
  if (process.platform !== 'darwin') return;
  if (process.env.AGZOS_SKIP_MAC_SIGN === '1') {
    console.log('• Assinatura do app de dev pulada (AGZOS_SKIP_MAC_SIGN=1).');
    return;
  }
  if (!fs.existsSync(BUNDLE)) {
    console.warn('⚠ Electron.app não encontrado — pulando assinatura de dev.');
    return;
  }

  const identity = process.env.AGZOS_MAC_SIGN_IDENTITY || DEFAULT_IDENTITY;
  if (!identityAvailable(identity)) {
    console.warn(`⚠ Identidade "${identity}" não encontrada no Keychain — app de dev fica sem assinatura estável.`);
    console.warn('  Crie/instale o certificado ou defina AGZOS_MAC_SIGN_IDENTITY.');
    return;
  }

  // O patch de branding mexe no Info.plist; o bundle id precisa ser o mesmo do app empacotado.
  setPlistString(INFO_PLIST, 'CFBundleIdentifier', BUNDLE_ID);
  for (const [key, value] of Object.entries(USAGE_STRINGS)) {
    setPlistString(INFO_PLIST, key, value);
  }

  // --deep cobre os helpers/frameworks internos do Electron. Para o app de dev
  // não usamos hardened runtime: a identidade estável já resolve o TCC e evita
  // exigir entitlements em cada helper.
  const sign = run('codesign', [
    '--force',
    '--deep',
    '--sign', identity,
    '--timestamp=none',
    BUNDLE,
  ]);
  if (sign.status !== 0) {
    console.error(`✗ Falha ao assinar o app de dev: ${sign.stderr || sign.stdout}`);
    process.exitCode = 1;
    return;
  }

  const verify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', BUNDLE]);
  if (verify.status !== 0) {
    console.warn(`⚠ Assinatura aplicada, mas a verificação falhou: ${verify.stderr || verify.stdout}`);
  }

  const info = run('codesign', ['-dv', '--verbose=4', BUNDLE]);
  const authority = (info.stderr || '').split('\n').find((line) => line.startsWith('Authority='));
  console.log(`✓ Electron.app de dev assinado com "${identity}" (${BUNDLE_ID})`);
  if (authority) console.log(`  ${authority}`);
  console.log('  Se o macOS ainda pedir permissão, reinicie o app; o TCC guarda pela assinatura + bundle id.');
}

try {
  main();
} catch (e) {
  console.error(`✗ Assinatura do app de dev falhou: ${e.message}`);
  process.exitCode = 1;
}
