/**
 * Handlers IPC usam o guard da janela que pediu (event.sender).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const { createWindowGuards } = require('../../src/main/lib/window-guards');

function tmp(prefix, files = {}) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
  return d;
}
function fakeIpc() {
  const handlers = {};
  return { handlers, ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } };
}
function wc(id) {
  const s = new EventEmitter();
  s.id = id;
  s.isDestroyed = () => false;
  s.send = () => {};
  return s;
}

test('fs:* nega na janela B o arquivo da pasta da janela A', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  require('../../src/main/ipc/fs').register(ipcMain, { guardFor: reg.guardFor, shell: {} });
  const dirA = tmp('agzos-ipc-a-', { 'a.txt': 'A' });
  const a = wc(1);
  const b = wc(2);
  reg.guardFor(a).allow(dirA);
  const read = await handlers['fs:readFile']({ sender: a }, path.join(dirA, 'a.txt'));
  assert.equal(read.content, 'A');
  await assert.rejects(handlers['fs:readFile']({ sender: b }, path.join(dirA, 'a.txt')), /Acesso negado/);
  await assert.rejects(handlers['fs:writeFile']({ sender: b }, path.join(dirA, 'a.txt'), 'x'), /Acesso negado/);
  // arrastar arquivo em B libera só em B
  const f = path.join(tmp('agzos-ipc-drop-', { 'd.txt': 'D' }), 'd.txt');
  await handlers['fs:allowDropped']({ sender: b }, f);
  assert.equal(reg.guardFor(b).isAllowed(f), true);
  assert.equal(reg.guardFor(a).isAllowed(f), false);
});

test('dialog:openFile libera só na janela que abriu o diálogo', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  const f = path.join(tmp('agzos-ipc-dlg-', { 'x.md': 'x' }), 'x.md');
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [f] }) };
  require('../../src/main/ipc/dialog').register(ipcMain, { dialog, getWindowFor: () => ({}), guardFor: reg.guardFor });
  const a = wc(1);
  const b = wc(2);
  assert.equal(await handlers['dialog:openFile']({ sender: a }), f);
  assert.equal(reg.guardFor(a).isAllowed(f), true);
  assert.equal(reg.guardFor(b).isAllowed(f), false);
});

test('workspace:open libera na janela; trocar de pasta revoga a antiga; recentes reabrem', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  let recent = [];
  const api = require('../../src/main/ipc/workspace').register(ipcMain, {
    guardFor: reg.guardFor,
    getRecentFolders: () => recent,
    addRecentFolder: (p) => { recent = [p, ...recent.filter((x) => x !== p)]; },
  });
  const dir1 = tmp('agzos-ws1-', { 'a.txt': 'a' });
  const dir2 = tmp('agzos-ws2-', { 'b.txt': 'b' });
  const a = wc(1);
  const b = wc(2);
  reg.guardFor(a).allow(dir1); // diálogo
  assert.equal(await handlers['workspace:open']({ sender: a }, dir1), true);
  assert.equal(api.rootFor(1), dir1);
  // B não vê dir1 e não pode abri-la sem estar nos recentes / diálogo
  assert.equal(reg.guardFor(b).isAllowed(path.join(dir1, 'a.txt')), false);

  reg.guardFor(a).allow(dir2);
  assert.equal(await handlers['workspace:open']({ sender: a }, dir2), true);
  assert.equal(reg.guardFor(a).isAllowed(path.join(dir1, 'a.txt')), false, 'pasta antiga revogada');
  assert.equal(reg.guardFor(a).isAllowed(path.join(dir2, 'b.txt')), true);

  // recente reabre pelo fluxo de abrir
  assert.equal(await handlers['workspace:open']({ sender: a }, dir1), true);
  assert.equal(reg.guardFor(a).isAllowed(path.join(dir1, 'a.txt')), true);
  assert.equal(reg.guardFor(a).isAllowed(path.join(dir2, 'b.txt')), false);

  await handlers['workspace:close']({ sender: a });
  assert.equal(reg.guardFor(a).isAllowed(path.join(dir1, 'a.txt')), false, 'fechar pasta revoga');
});

test('ssh:configPath libera ~/.ssh/config só na janela que pediu', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  const home = tmp('agzos-ssh-home-');
  require('../../src/main/ipc/ssh').register(ipcMain, { guardFor: reg.guardFor, home: () => home });
  const a = wc(1);
  const b = wc(2);
  const p = await handlers['ssh:configPath']({ sender: a });
  assert.equal(reg.guardFor(a).isAllowed(p), true);
  assert.equal(reg.guardFor(b).isAllowed(p), false);
});

test('agente usa o guard da janela que iniciou o pedido', () => {
  const reg = createWindowGuards();
  const { ipcMain } = fakeIpc();
  const dirA = tmp('agzos-ag-a-');
  const a = wc(1);
  const b = wc(2);
  reg.guardFor(a).allow(dirA);
  const api = require('../../src/main/ipc/agent').register(ipcMain, {
    settingsStore: { load: () => ({}), save: () => {} },
    store: { get: () => null },
    guardFor: reg.guardFor,
    userDataDir: null,
    getWindowRoot: () => dirA,
  });
  assert.equal(api._rootsFor(a, {}), dirA);
  assert.equal(api._rootsFor(b, {}), null);
  assert.equal(api._rootsFor(b, { root: dirA }), null);
});

test('envvault: raiz padrão = pasta da janela; outra janela não lista a pasta de A', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  const dirA = tmp('agzos-ev-a-', { '.env': 'A=1\n' });
  const a = wc(1);
  const b = wc(2);
  reg.guardFor(a).allow(dirA);
  require('../../src/main/ipc/envvault').register(ipcMain, {
    guardFor: reg.guardFor,
    getWindowRoot: (sender) => (sender.id === 1 ? dirA : null),
    settingsStore: { load: () => ({ recentFolders: [dirA] }) },
  });
  const list = await handlers['envvault:list']({ sender: a });
  assert.ok(list);
  await assert.rejects(handlers['envvault:list']({ sender: b }), /Abra uma pasta|Acesso negado/);
  await assert.rejects(handlers['envvault:list']({ sender: b }, dirA), /Acesso negado/);
});

test('broom: scanWorkspace sem raiz usa a pasta da janela; outra janela é negada', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  const dirA = tmp('agzos-br-a-', { 'a.js': 'console.log(1);\n' });
  const a = wc(1);
  const b = wc(2);
  reg.guardFor(a).allow(dirA);
  const scanned = [];
  const engine = { scan: async (dir) => { scanned.push(dir); return { files: [], truncated: false, cancelled: false }; } };
  require('../../src/main/ipc/broom').register(ipcMain, {
    guardFor: reg.guardFor,
    getWindowRoot: (sender) => (sender.id === 1 ? dirA : null),
    settingsStore: { load: () => ({ recentFolders: [dirA] }) },
    engine,
  });
  await handlers['broom:scanWorkspace']({ sender: a }, 'r1');
  assert.deepEqual(scanned, [dirA]);
  await assert.rejects(handlers['broom:scanWorkspace']({ sender: b }, 'r2'), /Abra uma pasta/);
  await assert.rejects(handlers['broom:scanWorkspace']({ sender: b }, 'r3', dirA), /Abra uma pasta/);
  await assert.rejects(handlers['broom:analyzeFile']({ sender: b }, path.join(dirA, 'a.js')), /Acesso negado/);
});

test('git:* e github:* usam o guard da janela que pediu', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  const dirA = tmp('agzos-git-a-');
  const a = wc(1);
  const b = wc(2);
  reg.guardFor(a).allow(dirA);
  require('../../src/main/ipc/git').register(ipcMain, { guardFor: reg.guardFor, accounts: null });
  require('../../src/main/ipc/github').register(ipcMain, {
    guardFor: reg.guardFor, settingsStore: { load: () => ({}), save: () => {} }, store: { get: () => null }, app: {},
  });
  const denied = await handlers['git:log']({ sender: b }, dirA);
  assert.equal(denied.ok, false);
  assert.match(denied.error.message, /Acesso negado/);
  const deniedGh = await handlers['github:accountForCwd']({ sender: b }, dirA);
  assert.match(deniedGh.error.message, /Acesso negado/);
  const okA = await handlers['git:log']({ sender: a }, dirA);
  assert.doesNotMatch(okA.error?.message || '', /Acesso negado/);
  const clone = await handlers['git:clone']({ sender: b }, 'https://github.com/x/y.git', dirA);
  assert.match(clone.error.message, /Acesso negado/);
});

test('ai:attach:read com caminhos do Explorer: só os liberados na janela que pediu; diálogo na janela dela', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  const dirA = tmp('agzos-ai-a-', { 'n.txt': 'nota' });
  const a = wc(1);
  const b = wc(2);
  reg.guardFor(a).allow(dirA);
  const parents = [];
  const winB = { id: 'janela-b' };
  require('../../src/main/ipc/ai').register(ipcMain, {
    settingsStore: { load: () => ({}), save: () => {} },
    store: { get: () => null },
    guardFor: reg.guardFor,
    getWindowFor: (evt) => (evt?.sender?.id === 2 ? winB : null),
    dialog: { showOpenDialog: async (win) => { parents.push(win); return { canceled: true, filePaths: [] }; } },
  });
  const okA = await handlers['ai:attach:read']({ sender: a }, [path.join(dirA, 'n.txt')]);
  assert.equal(okA[0].error, undefined);
  const deniedB = await handlers['ai:attach:read']({ sender: b }, [path.join(dirA, 'n.txt')]);
  assert.match(deniedB[0].error, /Fora das pastas liberadas/);
  await handlers['ai:attach:read']({ sender: b });
  assert.deepEqual(parents, [winB]);
});

test('agent:skills libera a pasta de skills só na janela que pediu', async () => {
  const reg = createWindowGuards();
  const { handlers, ipcMain } = fakeIpc();
  const userData = tmp('agzos-skills-ud-');
  fs.mkdirSync(path.join(userData, 'skills'));
  const a = wc(1);
  const b = wc(2);
  require('../../src/main/ipc/agent').register(ipcMain, {
    settingsStore: { load: () => ({}), save: () => {} },
    store: { get: () => null },
    guardFor: reg.guardFor,
    userDataDir: userData,
    getWindowRoot: () => null,
  });
  await handlers['agent:skills']({ sender: a }, {});
  const skillsDir = path.join(userData, 'skills');
  assert.equal(reg.guardFor(a).isAllowed(skillsDir), true);
  assert.equal(reg.guardFor(b).isAllowed(skillsDir), false);
});
