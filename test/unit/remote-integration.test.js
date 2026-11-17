const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRemoteManager } = require('../../src/main/remote/manager');
const kh = require('../../src/main/remote/known-hosts');
const { providerFor, setRemoteManager, runAsOwner } = require('../../src/main/workspace/provider-for');
const { createWindowGuards } = require('../../src/main/lib/window-guards');
const formatterIpc = require('../../src/main/ipc/formatter');
const treeIpc = require('../../src/main/ipc/tree');
const { createRemoteToolbox } = require('../../src/main/agent/remote-tools');
const treeTool = require('../../src/main/modules/tree/agent-tool');
const historyIo = require('../../src/main/modules/history/io');
const { createSshServer, generateKey } = require('../fixtures/ssh-server');

const userKey = generateKey();
let server;
let manager;
let proj;
let rootUri;
const sender = { id: 4242, once() {}, isDestroyed: () => false };
let guards;

before(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-rint-')));
  proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'src', 'js'), { recursive: true });
  fs.mkdirSync(path.join(proj, 'build'));
  fs.writeFileSync(path.join(proj, '.prettierrc'), '{ "semi": false, "singleQuote": true }');
  fs.writeFileSync(path.join(proj, 'src', 'js', '.prettierrc.js'), 'module.exports = { semi: true }');
  fs.writeFileSync(path.join(proj, 'src', 'a.js'), 'x');
  fs.writeFileSync(path.join(proj, '.gitignore'), 'build/\n');
  server = createSshServer({ root, users: { deploy: { publicKeys: [userKey.public] } } });
  await server.listen();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-rint-home-'));
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

after(async () => { manager.disposeAll(); setRemoteManager(null); await server.close(); });

test('Formatador remoto: lê .prettierrc do host; .prettierrc.js é ignorado com aviso (nada executa)', async () => {
  const h = {};
  const calls = [];
  formatterIpc.register({ handle: (ch, fn) => { h[ch] = fn; } }, {
    guardFor: guards.guardFor, getWindowRoot: () => rootUri, settingsStore: { load: () => ({}) },
    workerHost: { call: async (_n, req) => { calls.push(req); return { text: req.text, parser: 'babel' }; } },
  });
  const a = await h['formatter:format']({ sender }, { path: `${rootUri}/src/a.js`, text: 'x', languageId: 'javascript' });
  assert.equal(a.configFile, `${rootUri}/.prettierrc`);
  assert.equal(calls[0].options.semi, false);
  assert.equal(calls[0].options.singleQuote, true);
  const b = await h['formatter:format']({ sender }, { path: `${rootUri}/src/js/b.js`, text: 'y', languageId: 'javascript' });
  assert.match(b.warning, /nunca executa código/);
  assert.equal(calls[1].options.semi, undefined);
});

test('Árvore remota: tree:generate (IPC) e project_tree do agente usam o provider', async () => {
  const h = {};
  treeIpc.register({ handle: (ch, fn) => { h[ch] = fn; } }, { guardFor: guards.guardFor, settingsStore: { load: () => ({}) } });
  const r = await h['tree:generate']({ sender }, rootUri, { gitignore: true });
  assert.equal(r.text.split('\n')[0], 'proj/');
  assert.match(r.text, /a\.js/);
  assert.doesNotMatch(r.text, /build/);
  await assert.rejects(h['tree:generate']({ sender }, `${rootUri}/../`, {}), /Acesso negado|inválido/);

  const tb = createRemoteToolbox({ root: rootUri, provider: providerFor(rootUri, sender), extraTools: [treeTool] });
  const out = await runAsOwner(sender, async () => (await tb.prepare('project_tree', { path: 'src' })).execute());
  assert.equal(out.ok, true);
  assert.match(out.result, /^src\//);
  assert.match(out.result, /a\.js/);
});

test('histórico (io.js): lê e grava pelo provider da janela do contexto', async () => {
  const uri = `${rootUri}/src/a.js`;
  await runAsOwner(sender, async () => {
    assert.equal((await historyIo.readFileFor(uri)).toString(), 'x');
    await historyIo.writeFileFor(uri, Buffer.from('restaurado'));
  });
  assert.equal(fs.readFileSync(path.join(proj, 'src', 'a.js'), 'utf8'), 'restaurado');
  await assert.rejects(historyIo.readFileFor(uri), /sem janela/);
});
