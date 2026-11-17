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

test('modules: defaults de modules', () => {
  const p = tmpFile();
  const s = loadSettings(p);
  assert.deepEqual(s.modules, {
    broom: {
      enabled: true,
      rules: { console: true, comments: true, unusedImports: true, deadCode: true },
      keepConsole: ['error', 'warn'],
      keepComments: ['jsdoc', 'directives', 'license'],
      statusBar: true,
    },
    envVault: {
      enabled: true,
      blockCommits: true,
      extraPatterns: [],
      allowlist: [],
      revealTimeoutSec: 10,
    },
    tree: { enabled: true },
    snap: { enabled: true, watermark: true },
  });
  const { normalizeModules } = require('../../src/main/lib/settings');
  assert.deepEqual(normalizeModules(undefined), DEFAULT_SETTINGS.modules);
  assert.deepEqual(normalizeModules('lixo'), DEFAULT_SETTINGS.modules);
});

test('modules: modules.broom.rules.console inválido volta a true', () => {
  const { normalizeModules } = require('../../src/main/lib/settings');
  const out = normalizeModules({ broom: { enabled: 'sim', rules: { console: 'x', comments: false }, statusBar: 1 } });
  assert.equal(out.broom.rules.console, true);
  assert.equal(out.broom.rules.comments, false);
  assert.equal(out.broom.rules.unusedImports, true);
  assert.equal(out.broom.enabled, true);
  assert.equal(out.broom.statusBar, true);
  assert.equal(normalizeModules({ broom: { rules: 'nada' } }).broom.rules.deadCode, true);
});

test('modules: keepConsole não-array volta a [error, warn]', () => {
  const { normalizeModules } = require('../../src/main/lib/settings');
  assert.deepEqual(normalizeModules({ broom: { keepConsole: 'error' } }).broom.keepConsole, ['error', 'warn']);
  assert.deepEqual(normalizeModules({ broom: { keepConsole: ['info', 3, '', 'a b'] } }).broom.keepConsole, ['info']);
  assert.deepEqual(normalizeModules({ broom: { keepConsole: [] } }).broom.keepConsole, []);
  assert.deepEqual(normalizeModules({ broom: { keepComments: 'x' } }).broom.keepComments, ['jsdoc', 'directives', 'license']);
  assert.deepEqual(normalizeModules({ broom: { keepComments: ['jsdoc', 'outro'] } }).broom.keepComments, ['jsdoc']);
});

test('modules: revealTimeoutSec fora de 3..120 volta a 10', () => {
  const { normalizeModules } = require('../../src/main/lib/settings');
  const t = (v) => normalizeModules({ envVault: { revealTimeoutSec: v } }).envVault.revealTimeoutSec;
  assert.equal(t(2), 10);
  assert.equal(t(121), 10);
  assert.equal(t('30'), 10);
  assert.equal(t(Number.NaN), 10);
  assert.equal(t(3), 3);
  assert.equal(t(120), 120);
  assert.equal(t(30), 30);
  const out = normalizeModules({ envVault: { enabled: false, blockCommits: 'nao', allowlist: ['abc', 5, ''] } });
  assert.equal(out.envVault.enabled, false);
  assert.equal(out.envVault.blockCommits, true);
  assert.deepEqual(out.envVault.allowlist, ['abc']);
  assert.deepEqual(normalizeModules({ envVault: { allowlist: 'x' } }).envVault.allowlist, []);
});

test('modules: extraPatterns com regex inválida é descartado item a item', () => {
  const { normalizeModules } = require('../../src/main/lib/settings');
  const out = normalizeModules({
    envVault: {
      extraPatterns: [
        { name: 'interno', regex: 'INT_[A-Z0-9]{20}' },
        { name: 'quebrado', regex: '([a-z' },
        { name: '', regex: 'abc' },
        { name: 'sem regex' },
        'texto',
        { name: 'outro', regex: 'tok_[0-9]+' },
      ],
    },
  });
  assert.deepEqual(out.envVault.extraPatterns, [
    { name: 'interno', regex: 'INT_[A-Z0-9]{20}' },
    { name: 'outro', regex: 'tok_[0-9]+' },
  ]);
  assert.deepEqual(normalizeModules({ envVault: { extraPatterns: {} } }).envVault.extraPatterns, []);
});

test('modules: loadSettings normaliza modules do disco', () => {
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ modules: { broom: { enabled: false, keepConsole: 7 }, envVault: { revealTimeoutSec: 999 } } }));
  const s = loadSettings(p);
  assert.equal(s.modules.broom.enabled, false);
  assert.deepEqual(s.modules.broom.keepConsole, ['error', 'warn']);
  assert.equal(s.modules.envVault.revealTimeoutSec, 10);
  assert.equal(s.modules.envVault.blockCommits, true);
});

test('modules: settings:save preserva modules ao salvar outra seção', () => {
  const { register } = require('../../src/main/ipc/settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-settings-ipc-'));
  const handlers = {};
  register({ handle: (name, fn) => { handlers[name] = fn; } }, { app: { getPath: () => dir } });
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ modules: { envVault: { blockCommits: false } }, custom: { x: 1 } }));
  // cópia do renderer sem `modules` (ex.: salva só o tema)
  handlers['settings:save'](null, { theme: 'monokai' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.theme, 'monokai');
  assert.equal(saved.modules.envVault.blockCommits, false);
  assert.equal(saved.modules.broom.enabled, true);
  assert.deepEqual(saved.custom, { x: 1 });
  // com `modules` no payload, vale o payload (normalizado)
  handlers['settings:save'](null, { theme: 'monokai', modules: { envVault: { blockCommits: true, revealTimeoutSec: 1 } } });
  const saved2 = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved2.modules.envVault.blockCommits, true);
  assert.equal(saved2.modules.envVault.revealTimeoutSec, 10);
  assert.equal(saved2.modules.broom.enabled, true);
});

test('window.confirmBeforeQuit: padrão true; inválido volta ao padrão; false mantido', () => {
  const { normalizeWindow } = require('../../src/main/lib/settings');
  assert.deepEqual(DEFAULT_SETTINGS.window, { confirmBeforeQuit: true });
  assert.equal(loadSettings(tmpFile()).window.confirmBeforeQuit, true);
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ window: { confirmBeforeQuit: 'sim' } }));
  assert.equal(loadSettings(p).window.confirmBeforeQuit, true);
  fs.writeFileSync(p, JSON.stringify({ window: { confirmBeforeQuit: false } }));
  assert.equal(loadSettings(p).window.confirmBeforeQuit, false);
  fs.writeFileSync(p, JSON.stringify({ window: 'lixo' }));
  assert.deepEqual(loadSettings(p).window, { confirmBeforeQuit: true });
  assert.deepEqual(normalizeWindow(undefined), { confirmBeforeQuit: true });
});

test('aiSkills.trusted: normaliza registros de confiança e settings:save não aceita do renderer', () => {
  const { normalizeAiSkills } = require('../../src/main/lib/settings');
  const sha = 'a'.repeat(64);
  const good = { root: path.resolve('/w/p'), path: path.resolve('/w/p/.agzos/skills/x.md'), sha256: sha };
  assert.deepEqual(DEFAULT_SETTINGS.aiSkills, { trusted: [] });
  assert.deepEqual(normalizeAiSkills(undefined), { trusted: [] });
  assert.deepEqual(normalizeAiSkills({ trusted: [good, good, { ...good, sha256: 'curto' }, { ...good, root: 'relativo' }, 'lixo', null] }).trusted, [good]);
  const p = tmpFile();
  fs.writeFileSync(p, JSON.stringify({ aiSkills: { trusted: [good, { root: 1 }] } }));
  assert.deepEqual(loadSettings(p).aiSkills.trusted, [good]);

  const { register } = require('../../src/main/ipc/settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-settings-ipc-'));
  const handlers = {};
  register({ handle: (name, fn) => { handlers[name] = fn; } }, { app: { getPath: () => dir } });
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ aiSkills: { trusted: [good] } }));
  const evil = { ...good, path: path.resolve('/w/p/.agzos/skills/y.md') };
  handlers['settings:save'](null, { theme: 'monokai', aiSkills: { trusted: [evil] } });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.theme, 'monokai');
  assert.deepEqual(saved.aiSkills.trusted, [good]);
});
