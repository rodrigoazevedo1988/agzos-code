const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRemoteManager } = require('../../src/main/remote/manager');
const kh = require('../../src/main/remote/known-hosts');
const { providerFor, setRemoteManager } = require('../../src/main/workspace/provider-for');
const { createWindowGuards } = require('../../src/main/lib/window-guards');
const { createRemoteToolbox } = require('../../src/main/agent/remote-tools');
const { createCheckpointStore } = require('../../src/main/agent/checkpoints');
const envIpc = require('../../src/main/ipc/envvault');
const { createSshServer, generateKey } = require('../fixtures/ssh-server');

const FAKE_PASS = ['Hj7Kq2', 'Lm9Np4Rt5Vw8xY'].join('');
const userKey = generateKey();
let server;
let root;
let proj;
let manager;
let rootUri;
const sender = { id: 909, once() {}, isDestroyed: () => false };
let guards;

before(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ragent-')));
  proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'a.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(proj, '.env'), `DB_PASSWORD=${FAKE_PASS}\nPLAIN=1\n`);
  fs.writeFileSync(path.join(root, 'fora.txt'), 'fora');
  server = createSshServer({ root, users: { deploy: { publicKeys: [userKey.public] } } });
  await server.listen();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ragent-home-'));
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', server.port, server.hostPublic));
  fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), userKey.private, { mode: 0o600 });
  manager = createRemoteManager({ connectionOptions: () => ({ home, env: {}, platform: 'linux', knownHostsFiles: [path.join(home, '.ssh', 'known_hosts')] }) });
  setRemoteManager(manager);
  const { authority } = await manager.connect(sender.id, `deploy@127.0.0.1:${server.port}`);
  rootUri = `ssh://${authority}${proj}`;
  guards = createWindowGuards();
  guards.guardFor(sender).allow(rootUri);
});

after(async () => {
  manager.disposeAll();
  setRemoteManager(null);
  await server.close();
});

function toolbox() {
  const store = createCheckpointStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ragent-cp-')) });
  const checkpoint = store.create({ root: rootUri });
  const tb = createRemoteToolbox({ root: rootUri, provider: providerFor(rootUri, sender), checkpoint });
  return { tb, store, checkpoint };
}

test('agente remoto: fora da raiz é negado; .env mascarado; edição + undo pelo provider', async () => {
  const { tb, store, checkpoint } = toolbox();
  await assert.rejects(tb.prepare('read_file', { path: '../fora.txt' }), /fora da pasta/);
  await assert.rejects(tb.prepare('read_file', { path: `ssh://outro${proj}/src/a.js` }), /fora da pasta/);
  const env = await (await tb.prepare('read_file', { path: '.env' })).execute();
  assert.ok(!env.result.includes(FAKE_PASS));
  const edit = await tb.prepare('edit_file', { path: 'src/a.js', old_string: 'const a = 1;', new_string: 'const a = 2;' });
  assert.equal(edit.category, 'write');
  await edit.execute();
  await (await tb.prepare('write_file', { path: 'x/y/novo.txt', content: 'oi\n' })).execute();
  assert.equal(fs.readFileSync(path.join(proj, 'src', 'a.js'), 'utf8'), 'const a = 2;\n');
  const changes = checkpoint.changes().map((c) => [path.posix.basename(c.path), !!c.created]);
  assert.deepEqual(changes.sort(), [['a.js', false], ['novo.txt', true]]);
  assert.equal(checkpoint.finalize(), true);
  // Undo síncrono recusa caminhos remotos; undoAsync restaura pelo provider.
  assert.match(store.undo(checkpoint.id).errors[0].message, /undoAsync/);
  const r = await store.undoAsync(checkpoint.id, {
    assertPath: (p) => guards.guardFor(sender).assertAllowed(p),
    providerFor: (p) => providerFor(p, sender),
  });
  assert.deepEqual(r.errors, []);
  assert.equal(fs.readFileSync(path.join(proj, 'src', 'a.js'), 'utf8'), 'const a = 1;\n');
  assert.equal(fs.existsSync(path.join(proj, 'x')), false);
});

test('agente remoto: run_command roda no host, com risco avaliado e segredos do .env redigidos', async () => {
  const { tb } = toolbox();
  const risky = await tb.prepare('run_command', { command: 'rm -rf /' });
  assert.equal(risky.risky, true);
  const cmd = await tb.prepare('run_command', { command: `echo "$(pwd)"; cat ../.env`, cwd: 'src' });
  const res = await cmd.execute();
  assert.equal(res.ok, true);
  assert.match(res.result, new RegExp(`${proj}/src`));
  assert.ok(!res.result.includes(FAKE_PASS), 'segredo do .env redigido');
  const search = await (await tb.prepare('search', { query: 'CONST A' })).execute();
  assert.match(search.result, /src\/a\.js:1:/);
});

test('Cofre .env remoto: lista mascarada, revela, edita com checkpoint e desfaz', async () => {
  const handlers = {};
  envIpc.register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    guardFor: guards.guardFor,
    getWindowRoot: () => rootUri,
    settingsStore: { load: () => ({}) },
    userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ragent-ud-')),
    clipboard: { writeText() {} },
  });
  const call = (name, ...args) => handlers[`envvault:${name}`]({ sender }, ...args);
  const list = await call('list');
  assert.equal(list.root, rootUri);
  assert.deepEqual(list.files.map((f) => f.path), [`${rootUri}/.env`]);
  assert.ok(!JSON.stringify(list).includes(FAKE_PASS));
  assert.equal(list.files[0].entries.find((e) => e.key === 'DB_PASSWORD').flags.secret, true);
  assert.equal((await call('reveal', `${rootUri}/.env`, 'DB_PASSWORD')).value, FAKE_PASS);
  const { checkpointId } = await call('setValue', `${rootUri}/.env`, 'PLAIN', '2');
  assert.match(fs.readFileSync(path.join(proj, '.env'), 'utf8'), /PLAIN=2/);
  const undo = await call('undo', checkpointId);
  assert.deepEqual(undo.errors, []);
  assert.match(fs.readFileSync(path.join(proj, '.env'), 'utf8'), /PLAIN=1/);
  await assert.rejects(call('reveal', `ssh://deploy@127.0.0.1:${server.port}${root}/.env`, 'X'), /Acesso negado/);
  await assert.rejects(call('installHook'), /Indisponível em pasta remota/);
});
