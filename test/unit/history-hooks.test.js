// Gatilhos do histórico local: escritas do agente, da Vassoura e do Cofre guardam
// o conteúdo anterior (origem agente | vassoura | cofre).
const { test, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const history = require('../../src/main/modules/history');
const { createToolbox } = require('../../src/main/agent/tools');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const { createWorkerHost } = require('../../src/main/modules/worker-host');

const script = path.join(__dirname, '..', '..', 'src', 'main', 'modules', 'worker.js');
function fork(file) {
  const child = childProcess.fork(file, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  return { postMessage: (m) => child.connected && child.send(m), on: (ev, fn) => child.on(ev, fn), kill: () => child.kill() };
}
const workerHost = createWorkerHost({ script, fork });
after(() => workerHost.dispose());

let root;
let userData;
const p = (...parts) => path.join(root, ...parts);
const origins = (file) => history.getHistoryStore().list(file).map((e) => e.origin);
const versions = (file) => history.getHistoryStore().list(file).map((e) => history.getHistoryStore().read(file, e.id).toString());

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-hook-')));
  userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-hookud-')));
  history.configureHistory({ userDataDir: userData, getSettings: () => ({}) });
});
afterEach(() => {
  history.resetHistory();
  for (const d of [root, userData]) fs.rmSync(d, { recursive: true, force: true });
});

test('agente: write_file e edit_file guardam o conteúdo anterior', async () => {
  fs.writeFileSync(p('a.js'), 'const a = 1;\n');
  const box = createToolbox({ root });
  await box.prepare('edit_file', { path: 'a.js', old_string: '1', new_string: '2' }).execute({});
  await box.prepare('write_file', { path: 'a.js', content: 'novo\n' }).execute({});
  assert.deepEqual(versions(p('a.js')), ['const a = 2;\n', 'const a = 1;\n']);
  assert.deepEqual(origins(p('a.js')), ['agente', 'agente']);
});

test('agente: delete_path de arquivo guarda o conteúdo', async () => {
  fs.writeFileSync(p('b.js'), 'apagar\n');
  const box = createToolbox({ root });
  await box.prepare('delete_path', { path: 'b.js' }).execute({});
  assert.deepEqual(versions(p('b.js')), ['apagar\n']);
});

test('vassoura: cleanFile guarda o conteúdo anterior', async () => {
  const { register } = require('../../src/main/ipc/broom');
  const DIRTY = "// comentário\nexport const n = 1;\n";
  fs.writeFileSync(p('s.js'), DIRTY);
  const guard = createPathGuard();
  guard.allow(root);
  const handlers = {};
  register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    guard, settingsStore: { load: () => ({ recentFolders: [root], modules: {} }) }, userDataDir: userData, workerHost,
  });
  const sender = new EventEmitter();
  sender.isDestroyed = () => false;
  sender.send = () => {};
  await handlers['broom:cleanFile']({ sender }, p('s.js'));
  assert.deepEqual(versions(p('s.js')), [DIRTY]);
  assert.deepEqual(origins(p('s.js')), ['vassoura']);
});

test('cofre: setValue guarda o conteúdo anterior', async () => {
  const envIpc = require('../../src/main/ipc/envvault');
  fs.writeFileSync(p('.env'), 'A=1\n');
  const guard = createPathGuard();
  guard.allow(root);
  const h = {};
  envIpc.register({ handle: (ch, fn) => { h[ch] = fn; } }, {
    guard, userDataDir: userData, settingsStore: { load: () => ({ recentFolders: [root], modules: {} }) },
  });
  await h['envvault:setValue']({}, p('.env'), 'A', '2');
  assert.deepEqual(versions(p('.env')), ['A=1\n']);
  assert.deepEqual(origins(p('.env')), ['cofre']);
});
