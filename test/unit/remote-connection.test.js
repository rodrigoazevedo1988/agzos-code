const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveTarget, openConnection } = require('../../src/main/remote/connection');
const { createRemoteManager } = require('../../src/main/remote/manager');
const kh = require('../../src/main/remote/known-hosts');
const { createSshServer, generateKey } = require('../fixtures/ssh-server');

const userKey = generateKey();
let server;
let root;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-remote-'));
  fs.writeFileSync(path.join(root, 'ola.txt'), 'olá');
  server = createSshServer({
    root,
    users: { deploy: { password: 's3nha', publicKeys: [userKey.public] }, ana: { password: 'abc' } },
  });
  await server.listen();
});

after(async () => { await server.close(); });

function freshHome({ trusted = true, key = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-remote-home-'));
  fs.mkdirSync(path.join(home, '.ssh'), { mode: 0o700 });
  if (trusted) fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', server.port, server.hostPublic));
  if (key) fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), userKey.private, { mode: 0o600 });
  return home;
}

const baseOpts = (home, extra = {}) => ({
  home, env: {}, platform: 'linux', knownHostsFiles: [path.join(home, '.ssh', 'known_hosts')], ...extra,
});

test('resolveTarget: alias do config, usuario@host:porta, ProxyJump recusado', () => {
  const hosts = [
    { host: 'prod', hostName: '10.0.0.5', user: 'deploy', port: 2222, identityFile: '~/.ssh/k' },
    { host: 'pulo', hostName: 'x', proxy: true },
  ];
  const a = resolveTarget('prod', { hosts });
  assert.deepEqual(a, { alias: 'prod', host: '10.0.0.5', port: 2222, user: 'deploy', identityFiles: ['~/.ssh/k'], authority: 'prod', label: 'prod' });
  const b = resolveTarget('ana@srv.io:2200', { hosts });
  assert.equal(b.authority, 'ana@srv.io:2200');
  assert.equal(b.port, 2200);
  const c = resolveTarget({ user: 'ana', host: '::1', port: 22 }, { hosts });
  assert.equal(c.authority, 'ana@[::1]:22');
  assert.throws(() => resolveTarget('pulo', { hosts }), /ProxyJump/);
  assert.throws(() => resolveTarget('-oProxyCommand=x', { hosts }), /inválido/);
  assert.throws(() => resolveTarget('a@b;rm', { hosts }), /inválido/);
});

test('conecta com chave do ~/.ssh (host conhecido)', async () => {
  const home = freshHome({ key: true });
  let asked = 0;
  const { client } = await openConnection(resolveTarget(`deploy@127.0.0.1:${server.port}`), baseOpts(home, {
    askSecret: async () => { asked++; return null; },
    askHostKey: async () => { throw new Error('não deveria perguntar'); },
  }));
  assert.equal(asked, 0);
  client.end();
});

test('conecta com senha e "Lembrar" grava no cofre', async () => {
  const home = freshHome();
  const vault = new Map();
  const secretStore = { isAvailable: () => true, get: (k) => vault.get(k) ?? null, set: (k, v) => vault.set(k, v), delete: (k) => vault.delete(k) };
  const { client } = await openConnection(resolveTarget(`ana@127.0.0.1:${server.port}`), baseOpts(home, {
    secretStore,
    askSecret: async (req) => (req.kind === 'password' ? { value: 'abc', remember: true } : null),
  }));
  assert.equal(vault.get(`ssh.ana@127.0.0.1:${server.port}`), 'abc');
  client.end();
});

test('host desconhecido pergunta com fingerprint; confiar grava no known_hosts', async () => {
  const home = freshHome({ trusted: false, key: true });
  let info = null;
  const { client } = await openConnection(resolveTarget(`deploy@127.0.0.1:${server.port}`), baseOpts(home, {
    askHostKey: async (i) => { info = i; return true; },
  }));
  client.end();
  assert.equal(info.fingerprint, kh.fingerprint(server.hostPublic));
  assert.equal(info.keyType, 'ssh-ed25519');
  const file = path.join(home, '.ssh', 'known_hosts');
  const entries = kh.parseKnownHosts(fs.readFileSync(file, 'utf8'));
  assert.equal(kh.checkHostKey(entries, '127.0.0.1', server.port, server.hostPublic), 'match');
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('host desconhecido recusado → erro HOSTKEY_REJECTED', async () => {
  const home = freshHome({ trusted: false, key: true });
  await assert.rejects(
    openConnection(resolveTarget(`deploy@127.0.0.1:${server.port}`), baseOpts(home, { askHostKey: async () => false })),
    (err) => err.code === 'HOSTKEY_REJECTED',
  );
  assert.equal(fs.existsSync(path.join(home, '.ssh', 'known_hosts')), false);
});

test('host key divergente bloqueia sem perguntar (nem senha nem confiança)', async () => {
  const home = freshHome({ trusted: false, key: true });
  const other = require('../fixtures/ssh-server').publicBlob(generateKey().private);
  fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', server.port, other));
  let asked = 0;
  await assert.rejects(
    openConnection(resolveTarget(`deploy@127.0.0.1:${server.port}`), baseOpts(home, {
      askHostKey: async () => { asked++; return true; },
      askSecret: async () => { asked++; return { value: 's3nha' }; },
    })),
    (err) => err.code === 'HOSTKEY_MISMATCH' && /ataque/.test(err.message),
  );
  assert.equal(asked, 0);
});

test('senha errada esgota e falha com AUTH_FAILED; cancelar → CANCELLED', async () => {
  const home = freshHome();
  await assert.rejects(
    openConnection(resolveTarget(`ana@127.0.0.1:${server.port}`), baseOpts(home, { askSecret: async () => ({ value: 'errada' }) })),
    (err) => err.code === 'AUTH_FAILED',
  );
  await assert.rejects(
    openConnection(resolveTarget(`ana@127.0.0.1:${server.port}`), baseOpts(home, { askSecret: async () => null })),
    (err) => err.code === 'CANCELLED',
  );
});

test('manager: uma conexão por host por janela, SFTP compartilhado e reconexão após queda', async () => {
  const home = freshHome({ key: true });
  const states = [];
  const manager = createRemoteManager({
    connectionOptions: () => baseOpts(home),
    retryDelays: [50, 50, 50],
    onState: (owner, s) => states.push([owner, s.state]),
  });
  const target = `deploy@127.0.0.1:${server.port}`;
  const [a, b] = await Promise.all([manager.connect(1, target), manager.connect(1, target)]);
  assert.equal(a.authority, b.authority);
  const before = server.clientCount();
  await manager.connect(2, target); // outra janela: conexão própria
  assert.equal(server.clientCount(), before + 1);
  const s1 = await manager.sftp(1, a.authority);
  const s2 = await manager.sftp(1, a.authority);
  assert.equal(s1, s2);

  server.dropAll();
  await new Promise((r) => setTimeout(r, 400));
  const entry = await manager.ensure(1, a.authority);
  assert.ok(entry.client);
  assert.ok(states.some(([o, s]) => o === 1 && s === 'lost'));
  assert.ok(states.some(([o, s]) => o === 1 && s === 'reconnecting'));
  assert.equal(states.filter(([o]) => o === 1).at(-1)[1], 'connected');
  manager.disposeAll();
});

test('manager: servidor fora do ar → 3 tentativas e estado failed; reconnect manual volta', async () => {
  const srvRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-remote2-'));
  const srv = createSshServer({ root: srvRoot, users: { deploy: { publicKeys: [userKey.public] } } });
  const port = await srv.listen();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-remote-home-'));
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', port, srv.hostPublic));
  fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), userKey.private, { mode: 0o600 });
  const states = [];
  const manager = createRemoteManager({
    connectionOptions: () => baseOpts(home),
    retryDelays: [20, 20, 20],
    onState: (_o, s) => states.push(s),
  });
  const info = await manager.connect(7, `deploy@127.0.0.1:${port}`);
  srv.dropAll();
  await srv.stopListening();
  for (let i = 0; i < 50 && states.at(-1)?.state !== 'failed'; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(states.at(-1).state, 'failed');
  assert.equal(states.filter((s) => s.state === 'reconnecting').length, 3);
  await assert.rejects(manager.ensure(7, info.authority), (e) => e.code === 'REMOTE_LOST');
  await srv.listen(port);
  await manager.reconnect(7, info.authority);
  assert.ok((await manager.ensure(7, info.authority)).client);
  manager.disposeAll();
  await srv.close();
});
