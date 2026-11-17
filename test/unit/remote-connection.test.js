const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const net = require('net');
const { resolveTarget, openConnection, createPausableTimer } = require('../../src/main/remote/connection');
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

test('chave do host de outro tipo que a registrada → HOSTKEY_MISMATCH (handshake restrito aos tipos conhecidos)', async () => {
  const srvRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-remote-rsa-'));
  const rsaKey = generateKey('rsa', { bits: 2048 }).private;
  const srv = createSshServer({ root: srvRoot, hostKey: rsaKey, users: { deploy: { publicKeys: [userKey.public] } } });
  const port = await srv.listen();
  try {
    const home = freshHome({ trusted: false, key: true });
    // known_hosts tem ed25519 para o host; o servidor só apresenta ssh-rsa.
    const ed = require('../fixtures/ssh-server').publicBlob(generateKey().private);
    fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', port, ed));
    let asked = 0;
    await assert.rejects(
      openConnection(resolveTarget(`deploy@127.0.0.1:${port}`), baseOpts(home, {
        askHostKey: async () => { asked++; return true; },
        askSecret: async () => { asked++; return null; },
      })),
      (err) => err.code === 'HOSTKEY_MISMATCH' && /ataque/.test(err.message),
    );
    assert.equal(asked, 0);

    // Servidor com ed25519 e rsa; só a rsa registrada → negocia rsa e conecta.
    const both = createSshServer({ root: srvRoot, hostKey: rsaKey, extraHostKeys: [generateKey().private], users: { deploy: { publicKeys: [userKey.public] } } });
    const port2 = await both.listen();
    try {
      const home2 = freshHome({ trusted: false, key: true });
      fs.writeFileSync(path.join(home2, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', port2, srv.hostPublic));
      const { client } = await openConnection(resolveTarget(`deploy@127.0.0.1:${port2}`), baseOpts(home2, {
        askHostKey: async () => { throw new Error('não deveria perguntar'); },
      }));
      client.end();
    } finally {
      await both.close();
    }
  } finally {
    await srv.close();
  }
});

test('createPausableTimer: pausa durante o diálogo e retoma com o tempo que faltava', () => {
  let now = 0;
  const timers = new Map();
  let seq = 0;
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const advance = (ms) => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  let fired = 0;
  const t = createPausableTimer(20_000, () => { fired++; }, clock);
  advance(15_000);
  t.pause();
  advance(25_000); // usuário pensando no diálogo
  assert.equal(fired, 0);
  t.resume();
  advance(4_999);
  assert.equal(fired, 0);
  advance(1);
  assert.equal(fired, 1);
  // Pausas aninhadas: só retoma quando todas terminam; clear cancela.
  const t2 = createPausableTimer(1000, () => { fired++; }, clock);
  t2.pause(); t2.pause(); t2.resume();
  advance(5000);
  assert.equal(fired, 1);
  t2.resume();
  t2.clear();
  advance(5000);
  assert.equal(fired, 1);
});

test('readyTimeout não corre enquanto o diálogo espera o usuário; servidor mudo ainda expira', async () => {
  const home = freshHome({ trusted: false, key: true });
  const { client } = await openConnection(resolveTarget(`deploy@127.0.0.1:${server.port}`), baseOpts(home, {
    readyTimeout: 300,
    askHostKey: () => new Promise((r) => setTimeout(() => r(true), 900)),
  }));
  client.end();

  const home2 = freshHome();
  const { client: c2 } = await openConnection(resolveTarget(`ana@127.0.0.1:${server.port}`), baseOpts(home2, {
    readyTimeout: 300,
    askSecret: () => new Promise((r) => setTimeout(() => r({ value: 'abc', remember: false }), 900)),
  }));
  c2.end();

  const socks = new Set();
  const mute = net.createServer((sock) => socks.add(sock)); // aceita e nunca responde
  await new Promise((r) => mute.listen(0, '127.0.0.1', r));
  try {
    const t0 = Date.now();
    await assert.rejects(
      openConnection(resolveTarget(`deploy@127.0.0.1:${mute.address().port}`), baseOpts(freshHome(), { readyTimeout: 300 })),
      (err) => err.code === 'CONNECT_FAILED' && /Timed out/i.test(err.message),
    );
    assert.ok(Date.now() - t0 < 5000);
  } finally {
    for (const sock of socks) sock.destroy();
    mute.close();
  }
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
