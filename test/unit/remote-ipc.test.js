const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const remoteIpc = require('../../src/main/ipc/remote');
const { createRemoteManager } = require('../../src/main/remote/manager');
const kh = require('../../src/main/remote/known-hosts');
const { createSshServer, generateKey } = require('../fixtures/ssh-server');

const userKey = generateKey();
let server;
let root;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-remote-ipc-'));
  fs.mkdirSync(path.join(root, 'proj'));
  fs.mkdirSync(path.join(root, '.oculta'));
  fs.writeFileSync(path.join(root, 'a.txt'), 'x');
  server = createSshServer({ root, users: { ana: { password: 'abc' }, deploy: { publicKeys: [userKey.public] } } });
  await server.listen();
});
after(() => server.close());

function makeSender(id) {
  const s = new EventEmitter();
  s.id = id;
  s.sent = [];
  s.isDestroyed = () => false;
  s.send = (ch, ...args) => { s.sent.push([ch, ...args]); s.emit('sent', ch, ...args); };
  return s;
}

function setup({ trusted = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-remote-ipc-home-'));
  fs.mkdirSync(path.join(home, '.ssh'), { mode: 0o700 });
  fs.writeFileSync(path.join(home, '.ssh', 'config'), `Host fixture\n  HostName 127.0.0.1\n  User ana\n  Port ${server.port}\n`);
  if (trusted) fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', server.port, server.hostPublic));
  const manager = createRemoteManager({
    connectionOptions: () => ({ home, env: {}, platform: 'linux', knownHostsFiles: [path.join(home, '.ssh', 'known_hosts')] }),
    retryDelays: [10],
  });
  const handlers = new Map();
  remoteIpc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, { manager, home: () => home });
  const call = (ch, sender, ...args) => handlers.get(ch)({ sender }, ...args);
  return { home, manager, call };
}

test('remote:connect por alias do config pede senha só à janela dona; resposta de outra janela é ignorada', async () => {
  const { call, manager } = setup();
  const owner = makeSender(11);
  const intruder = makeSender(12);
  owner.on('sent', async (ch, id, payload) => {
    if (ch !== 'remote:prompt') return;
    assert.equal(payload.kind, 'secret');
    assert.equal(payload.target, `ana@127.0.0.1:${server.port}`);
    assert.equal(await call('remote:prompt:reply', intruder, id, { value: 'errada' }), false);
    assert.equal(await call('remote:prompt:reply', owner, id, { value: 'abc', remember: false }), true);
  });
  const res = await call('remote:connect', owner, 'fixture');
  assert.equal(res.ok, true, res.error);
  assert.equal(res.authority, 'fixture');
  assert.equal(res.home, server.root);
  assert.equal(res.homeUri, `ssh://fixture${server.root}`);
  assert.equal(intruder.sent.length, 0);
  // Janela fechada: conexões dela são encerradas.
  owner.emit('destroyed');
  assert.deepEqual(manager.list(11), []);
});

test('remote:connect com host key desconhecida pergunta (kind hostkey); recusa → erro', async () => {
  const { call } = setup({ trusted: false });
  const owner = makeSender(21);
  owner.on('sent', (ch, id, payload) => {
    if (ch === 'remote:prompt' && payload.kind === 'hostkey') {
      assert.match(payload.fingerprint, /^SHA256:/);
      call('remote:prompt:reply', owner, id, false);
    }
  });
  const res = await call('remote:connect', owner, 'fixture');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'HOSTKEY_REJECTED');
});

test('remote:connect com host key divergente: erro HOSTKEY_MISMATCH sem nenhum diálogo', async () => {
  const { call, home } = setup({ trusted: false });
  const other = require('../fixtures/ssh-server').publicBlob(generateKey().private);
  fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', server.port, other));
  const owner = makeSender(31);
  const res = await call('remote:connect', owner, 'fixture');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'HOSTKEY_MISMATCH');
  assert.equal(owner.sent.filter(([ch]) => ch === 'remote:prompt').length, 0);
});

test('remote:browse lista só pastas visíveis e exige conexão da própria janela', async () => {
  const { call, home } = setup();
  fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), userKey.private, { mode: 0o600 });
  const owner = makeSender(41);
  const res = await call('remote:connect', owner, `deploy@127.0.0.1:${server.port}`);
  assert.equal(res.ok, true, res.error);
  const list = await call('remote:browse', owner, res.authority, server.root);
  assert.equal(list.ok, true, list.error);
  assert.deepEqual(list.dirs.map((d) => d.name), ['proj']);
  const other = await call('remote:browse', makeSender(42), res.authority, server.root);
  assert.equal(other.ok, false);
  const bad = await call('remote:browse', owner, res.authority, `${server.root}/../..`);
  assert.equal(bad.ok, false);
  owner.emit('destroyed');
});
