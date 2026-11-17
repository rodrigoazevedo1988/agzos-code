const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { createRemoteManager } = require('../../src/main/remote/manager');
const kh = require('../../src/main/remote/known-hosts');
const { setRemoteManager } = require('../../src/main/workspace/provider-for');
const { createWindowGuards } = require('../../src/main/lib/window-guards');
const gitIpc = require('../../src/main/ipc/git');
const { createSshServer, generateKey } = require('../fixtures/ssh-server');

Object.assign(process.env, { GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 't@x.com', GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 't@x.com' });

const TOKEN = 'ghp_TOKEN_QUE_NUNCA_VAI_AO_HOST_123456';
const userKey = generateKey();
let server;
let root;
let manager;
let rootUri;
const sender = { id: 777, once() {}, isDestroyed: () => false };
const handlers = new Map();
const call = (ch, ...args) => handlers.get(ch)({ sender }, ...args);

before(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-rgit-')));
  const proj = path.join(root, "meu proj's");
  fs.mkdirSync(proj);
  execFileSync('git', ['init', '-q', '-b', 'main', proj]);
  execFileSync('git', ['-C', proj, 'remote', 'add', 'origin', 'https://github.com/agzos/x.git']);
  fs.writeFileSync(path.join(proj, 'a.txt'), 'um\n');
  server = createSshServer({ root, users: { deploy: { publicKeys: [userKey.public] } } });
  await server.listen();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-rgit-home-'));
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', server.port, server.hostPublic));
  fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), userKey.private, { mode: 0o600 });
  manager = createRemoteManager({ connectionOptions: () => ({ home, env: {}, platform: 'linux', knownHostsFiles: [path.join(home, '.ssh', 'known_hosts')] }) });
  setRemoteManager(manager);
  const { authority } = await manager.connect(sender.id, `deploy@127.0.0.1:${server.port}`);
  rootUri = `ssh://${authority}${proj}`;
  const guards = createWindowGuards();
  guards.guardFor(sender).allow(rootUri);
  const accounts = {
    resolveForRemote: () => ({ token: TOKEN, account: { id: 1, login: 'u' }, github: { https: true }, remoteKey: 'k' }),
    pickDefault: () => ({ id: 1, login: 'u', name: 'U' }),
    tokenFor: () => TOKEN,
  };
  gitIpc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, { guardFor: guards.guardFor, accounts, commitGuard: null });
});

after(async () => {
  manager.disposeAll();
  setRemoteManager(null);
  await server.close();
});

test('git remoto: status com raiz ssh://, stage, commit e log pelo exec do host', async () => {
  const st = await call('git:status', rootUri);
  assert.equal(st.ok, true, st.error?.message);
  assert.equal(st.data.root, rootUri);
  assert.deepEqual(st.data.changes.map((f) => f.path), ['a.txt']);
  assert.equal((await call('git:stage', rootUri, ['a.txt'])).ok, true);
  const c = await call('git:commit', rootUri, "primeiro $(touch PWNED) 'aspas'");
  assert.equal(c.ok, true, c.error?.message);
  const log = await call('git:log', rootUri, 5);
  assert.equal(log.data[0].subject, "primeiro $(touch PWNED) 'aspas'");
  assert.equal(fs.existsSync(path.join(root, 'PWNED')), false);
  fs.writeFileSync(path.join(root, "meu proj's", 'a.txt'), 'dois\n');
  const diff = await call('git:diffFile', rootUri, 'a.txt');
  assert.deepEqual([diff.data.original, diff.data.modified], ['um\n', 'dois\n']);
  // Todos os comandos foram git -C <raiz> com aspas.
  const gitCmds = server.execLog.filter((c) => c.includes("'git'"));
  assert.ok(gitCmds.length > 3);
  for (const cmd of gitCmds) assert.match(cmd, /^env GIT_TERMINAL_PROMPT='0' .*'git' '-C' '\/.*\/meu proj'\\''s' /);
});

test('git remoto: token do GitHub nunca vai ao host (nem extraheader nem env)', async () => {
  const before = server.execLog.length;
  const res = await call('git:fetch', rootUri); // origin inexistente: falha, mas sem token
  assert.equal(res.ok, false);
  await call('git:push', rootUri);
  const sent = server.execLog.slice(before).join('\n') + JSON.stringify(server.envLog);
  assert.ok(sent.includes("'fetch'"));
  assert.ok(!sent.includes(TOKEN), 'token não pode aparecer');
  assert.ok(!/extraheader|GIT_CONFIG_(COUNT|KEY|VALUE)|AUTHORIZATION/i.test(sent));
});

test('git remoto: arquivo fora da raiz é negado no stage', async () => {
  const res = await call('git:stage', rootUri, ['../fora.txt']);
  assert.equal(res.ok, false);
});
