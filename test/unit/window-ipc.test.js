const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

function fakeIpc() {
  const handlers = {};
  return { handlers, ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } } };
}

function fakeSender(id) {
  const s = new EventEmitter();
  s.id = id;
  s.isDestroyed = () => false;
  return s;
}

test('workspace:open guarda a raiz por janela (webContents.id) e libera ao destruir', async () => {
  const { register } = require('../../src/main/ipc/workspace');
  const { handlers, ipcMain } = fakeIpc();
  const allowed = new Set(['/a', '/b']);
  let recent = [];
  const api = register(ipcMain, {
    guard: { isAllowed: (p) => allowed.has(p), allow: (p) => allowed.add(p) },
    getRecentFolders: () => recent,
    addRecentFolder: (p) => { recent = [p, ...recent.filter((x) => x !== p)]; },
    clearRecentFolders: () => { recent = []; },
  });
  const w1 = fakeSender(1);
  const w2 = fakeSender(2);
  assert.equal(await handlers['workspace:open']({ sender: w1 }, '/a'), true);
  assert.equal(await handlers['workspace:open']({ sender: w2 }, '/b'), true);
  assert.equal(api.rootFor(1), '/a');
  assert.equal(api.rootFor(2), '/b');
  assert.equal(api.rootFor(3), null);

  // Pasta não liberada e fora dos recentes: recusa e não muda a raiz da janela
  assert.equal(await handlers['workspace:open']({ sender: w1 }, '/x'), false);
  assert.equal(api.rootFor(1), '/a');

  await handlers['workspace:close']({ sender: w1 });
  assert.equal(api.rootFor(1), null);

  w2.emit('destroyed');
  assert.equal(api.rootFor(2), null);

  assert.deepEqual(recent, ['/b', '/a']);
  assert.deepEqual(await handlers['workspace:clearRecent']({ sender: w1 }), []);
  assert.deepEqual(recent, []);
});

test('window:* age na janela do remetente; window:new cria outra', async () => {
  const { register } = require('../../src/main/ipc/window');
  const { handlers, ipcMain } = fakeIpc();
  const calls = [];
  const win = {
    isFullScreen: () => false,
    setFullScreen: (v) => calls.push(['fullscreen', v]),
    close: () => calls.push(['close']),
    webContents: { toggleDevTools: () => calls.push(['devtools']) },
  };
  register(ipcMain, {
    createWindow: () => calls.push(['new']),
    fromWebContents: (wc) => (wc.id === 7 ? win : null),
    quit: () => calls.push(['quit']),
  });
  const evt = { sender: fakeSender(7) };
  await handlers['window:new'](evt);
  await handlers['window:toggleFullScreen'](evt);
  await handlers['window:toggleDevTools'](evt);
  await handlers['window:close'](evt);
  await handlers['app:quit'](evt);
  // Remetente sem janela: não quebra
  await handlers['window:close']({ sender: fakeSender(99) });
  assert.deepEqual(calls, [['new'], ['fullscreen', true], ['devtools'], ['close'], ['quit']]);
});

test('agent getRoot: sem payload.root usa a pasta da janela (não a última global)', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { register } = require('../../src/main/ipc/agent');
  const { createPathGuard } = require('../../src/main/lib/path-guard');
  const a = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-wa-')));
  const b = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-wb-')));
  try {
    const guard = createPathGuard();
    guard.allow(a); guard.allow(b);
    const { ipcMain } = fakeIpc();
    const seen = [];
    const api = register(ipcMain, {
      settingsStore: { load: () => ({ recentFolders: [b] }), save: () => {} },
      store: { get: () => null },
      guard,
      userDataDir: null,
      getWindowRoot: (sender) => (sender.id === 1 ? a : null),
      sessionOptions: {},
    });
    const roots = api._rootsFor;
    seen.push(roots(fakeSender(1), {}), roots(fakeSender(2), {}), roots(fakeSender(2), { root: b }));
    assert.deepEqual(seen, [a, null, b]);
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});
