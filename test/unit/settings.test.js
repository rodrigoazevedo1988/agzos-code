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
  fs.writeFileSync(p, JSON.stringify({ fontSize: 18, editor: { tabSize: 4 } }));
  const s = loadSettings(p);
  assert.equal(s.fontSize, 18);
  assert.equal(s.theme, 'agzos-dark');
  assert.equal(s.iconTheme, 'lucide-color');
  assert.equal(s.editor.tabSize, 4);
  assert.equal(s.editor.wordWrap, 'off');
  assert.equal(s.editor.insertSpaces, true);
  assert.equal(s.terminal.fontSize, 13);
  assert.equal(s.update.autoDownload, true);
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

test('aiPanel: defaults e normalização de valores inválidos', () => {
  const { normalizeAiPanel } = require('../../src/main/lib/settings');
  assert.deepEqual(normalizeAiPanel(undefined), DEFAULT_SETTINGS.aiPanel);
  const out = normalizeAiPanel({
    position: 'top', width: 'x', visible: 'sim', fontSize: 40, density: 'huge',
    showAvatars: 0, sendKey: 'alt', defaultContext: { file: false, terminal: 'y' },
  });
  assert.equal(out.position, 'right');
  assert.equal(out.width, 380);
  assert.equal(out.visible, true);
  assert.equal(out.fontSize, 18);
  assert.equal(out.density, 'comfortable');
  assert.equal(out.showAvatars, true);
  assert.equal(out.sendKey, 'enter');
  assert.deepEqual(out.defaultContext, { file: false, selection: true, terminal: false });
  assert.equal(normalizeAiPanel({ fontSize: 5 }).fontSize, 11);
  assert.equal(normalizeAiPanel({ width: 99999 }).width, 1600);
  const ok = normalizeAiPanel({ position: 'bottom', density: 'compact', sendKey: 'ctrlEnter', showAvatars: false, fontSize: 15 });
  assert.equal(ok.position, 'bottom');
  assert.equal(ok.density, 'compact');
  assert.equal(ok.sendKey, 'ctrlEnter');
  assert.equal(ok.showAvatars, false);
  assert.equal(ok.fontSize, 15);
});

test('aiPanel: loadSettings normaliza e herda ai.context antigo', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ ai: { context: { file: false, selection: false, terminal: true } }, aiPanel: { position: 'nada' } }));
  const s = loadSettings(p);
  assert.equal(s.aiPanel.position, 'right');
  assert.deepEqual(s.aiPanel.defaultContext, { file: false, selection: false, terminal: true });
  fs.writeFileSync(p, JSON.stringify({ ai: { context: { file: false } }, aiPanel: { defaultContext: { file: true, selection: true, terminal: true } } }));
  assert.deepEqual(loadSettings(p).aiPanel.defaultContext, { file: true, selection: true, terminal: true });
});

test('settings:save mantém perfis de IA do disco (cópia do renderer pode estar velha)', () => {
  const { register } = require('../../src/main/ipc/settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-settings-ipc-'));
  const handlers = {};
  register({ handle: (name, fn) => { handlers[name] = fn; } }, { app: { getPath: () => dir } });
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ ai: { activeProfileId: 'p1', profiles: [{ id: 'p1', label: 'X' }] } }));
  handlers['settings:save'](null, { theme: 'monokai', ai: { profiles: [], activeProfileId: null, context: { file: false } }, aiPanel: { position: 'left' } });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.theme, 'monokai');
  assert.equal(saved.ai.activeProfileId, 'p1');
  assert.equal(saved.ai.profiles.length, 1);
  assert.deepEqual(saved.ai.context, { file: false });
  assert.equal(saved.aiPanel.position, 'left');
});
