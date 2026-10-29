const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = require('../../src/main/lib/settings');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-settings-'));
  return path.join(dir, 'settings.json');
}

test('arquivo ausente retorna defaults', () => {
  const p = tmpFile();
  assert.deepEqual(loadSettings(p), DEFAULT_SETTINGS);
});

test('mescla arquivo com defaults', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ fontSize: 18 }));
  const s = loadSettings(p);
  assert.equal(s.fontSize, 18);
  assert.equal(s.theme, 'agzos-dark');
  assert.equal(s.iconTheme, 'lucide-color');
});

test('mescla e persiste iconTheme customizado', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ iconTheme: 'emoji' }));
  const s = loadSettings(p);
  assert.equal(s.iconTheme, 'emoji');

  saveSettings(p, { ...s, iconTheme: 'badges' });
  assert.equal(loadSettings(p).iconTheme, 'badges');
});

test('JSON inválido vira backup e retorna defaults', () => {
  const p = tmpFile();
  fs.writeFileSync(p, '{ isto não é json');
  const s = loadSettings(p);
  assert.deepEqual(s, DEFAULT_SETTINGS);
  assert.ok(!fs.existsSync(p), 'arquivo original deve sair do caminho');
  const backups = fs.readdirSync(path.dirname(p)).filter((f) => f.startsWith('settings.json.corrupt-'));
  assert.equal(backups.length, 1);
});

test('defaults retornados não compartilham referência com DEFAULT_SETTINGS', () => {
  const p = tmpFile();
  const s = loadSettings(p);
  s.recentFolders.push('/x');
  assert.deepEqual(DEFAULT_SETTINGS.recentFolders, []);
});

test('saveSettings grava e loadSettings lê de volta, sem sobrar .tmp', () => {
  const p = tmpFile();
  assert.equal(saveSettings(p, { ...DEFAULT_SETTINGS, theme: 'agzos-light' }), true);
  assert.equal(loadSettings(p).theme, 'agzos-light');
  assert.ok(!fs.existsSync(p + '.tmp'));
});

/* --------------------------------------------------------------------------
   BOM — PowerShell e editores Windows gravam settings.json com BOM.
   Antes, o arquivo era tratado como corrompido e as configurações voltavam
   ao padrão (com welcome e onboarding de novo).
   -------------------------------------------------------------------------- */

function backups(p) {
  return fs.readdirSync(path.dirname(p)).filter((f) => f.startsWith('settings.json.corrupt-'));
}

test('settings.json com BOM UTF-8 é lido, não vira corrupto', () => {
  const p = tmpFile();
  const corpo = JSON.stringify({ theme: 'monokai', welcomeSeen: true, onboardingCompleted: true }, null, 2);
  fs.writeFileSync(p, `\ufeff${corpo}`, 'utf-8');

  const s = loadSettings(p);
  assert.equal(s.theme, 'monokai');
  assert.equal(s.welcomeSeen, true);
  assert.equal(s.onboardingCompleted, true);
  assert.equal(s.iconTheme, 'lucide-color', 'defaults continuam preenchidos');
  assert.ok(fs.existsSync(p), 'arquivo original não deve ser renomeado');
  assert.equal(backups(p).length, 0, 'não deve criar backup de corrupção');
});

test('settings.json com BOM UTF-8 em bytes crus é lido', () => {
  const p = tmpFile();
  const corpo = Buffer.from(JSON.stringify({ fontSize: 21 }), 'utf-8');
  fs.writeFileSync(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), corpo]));

  assert.equal(loadSettings(p).fontSize, 21);
  assert.ok(fs.existsSync(p));
});

test('settings.json gravado pelo PowerShell (UTF-16 LE com BOM) é lido', () => {
  const p = tmpFile();
  const corpo = Buffer.from(JSON.stringify({ theme: 'agzos-light', fontSize: 16 }), 'utf16le');
  fs.writeFileSync(p, Buffer.concat([Buffer.from([0xff, 0xfe]), corpo]));

  const s = loadSettings(p);
  assert.equal(s.theme, 'agzos-light');
  assert.equal(s.fontSize, 16);
});

test('settings.json com BOM UTF-16 BE é lido', () => {
  const p = tmpFile();
  const body = Buffer.from(JSON.stringify({ fontSize: 19 }), 'utf16le');
  body.swap16(); // vira UTF-16 BE
  fs.writeFileSync(p, Buffer.concat([Buffer.from([0xfe, 0xff]), body]));

  assert.equal(loadSettings(p).fontSize, 19);
});

test('BOM não esconde JSON inválido: ainda vira backup', () => {
  const p = tmpFile();
  fs.writeFileSync(p, '\ufeff{ isto não é json', 'utf-8');

  assert.deepEqual(loadSettings(p), DEFAULT_SETTINGS);
  assert.ok(!fs.existsSync(p));
  assert.equal(backups(p).length, 1);
});

test('saveSettings sobrescreve arquivo com BOM sem reintroduzir o BOM', () => {
  const p = tmpFile();
  fs.writeFileSync(p, `\ufeff${JSON.stringify({ theme: 'monokai' })}`, 'utf-8');

  const s = loadSettings(p);
  s.theme = 'agzos-dark';
  assert.equal(saveSettings(p, s), true);

  const bytes = fs.readFileSync(p);
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(loadSettings(p).theme, 'agzos-dark');
});
