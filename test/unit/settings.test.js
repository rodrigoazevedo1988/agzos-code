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
