const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ssh = require('../../src/main/ipc/ssh');
const { createPathGuard } = require('../../src/main/lib/path-guard');

function setup(initialConfig) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ssh-'));
  if (initialConfig != null) {
    fs.mkdirSync(path.join(home, '.ssh'), { mode: 0o700 });
    fs.writeFileSync(path.join(home, '.ssh', 'config'), initialConfig);
  }
  const handlers = new Map();
  const guard = createPathGuard();
  ssh.register({ handle: (ch, fn) => handlers.set(ch, fn) }, { guard, home: () => home });
  const call = (ch, ...args) => handlers.get(ch)({ sender: {} }, ...args);
  return { home, guard, call, cfg: path.join(home, '.ssh', 'config') };
}

test('ssh:hosts lista hosts seguros do config (com Include)', async () => {
  const { home, call, cfg } = setup('Include conf.d/*\nHost prod\n  HostName 10.0.0.5\n  User deploy\n  Port 2222\nHost "bad name" ok-*\n');
  fs.mkdirSync(path.join(home, '.ssh', 'conf.d'));
  fs.writeFileSync(path.join(home, '.ssh', 'conf.d', 'x'), 'Host extra\n  HostName e.io\n');
  const res = await call('ssh:hosts');
  assert.equal(res.configPath, cfg);
  assert.deepEqual(res.hosts.map((h) => h.host), ['extra', 'prod']);
  assert.deepEqual(res.hosts[1], { host: 'prod', hostName: '10.0.0.5', user: 'deploy', port: 2222 });
  assert.equal(typeof res.sshAvailable, 'boolean');
});

test('ssh:hosts sem ~/.ssh → lista vazia', async () => {
  const { call } = setup(null);
  const res = await call('ssh:hosts');
  assert.deepEqual(res.hosts, []);
});

test('ssh:addHost cria ~/.ssh (700) e config (600) quando não existem', { skip: process.platform === 'win32' }, async () => {
  const { home, call, cfg } = setup(null);
  const res = await call('ssh:addHost', { target: 'deploy@srv.example.com:2200', alias: 'srv' });
  assert.deepEqual(res, { ok: true, alias: 'srv', configPath: cfg });
  assert.equal(fs.readFileSync(cfg, 'utf8'), 'Host srv\n  HostName srv.example.com\n  User deploy\n  Port 2200\n');
  assert.equal(fs.statSync(path.join(home, '.ssh')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(cfg).mode & 0o777, 0o600);
});

test('ssh:addHost acrescenta sem reescrever o resto e não muda permissões existentes', { skip: process.platform === 'win32' }, async () => {
  const before = '# meu\r\nHost a\r\n  User x\r\n';
  const { call, cfg } = setup(before);
  fs.chmodSync(cfg, 0o644);
  const res = await call('ssh:addHost', { target: 'b.example.com', alias: 'b' });
  assert.equal(res.ok, true);
  const after = fs.readFileSync(cfg, 'utf8');
  assert.ok(after.startsWith(before));
  assert.equal(after.slice(before.length), '\r\nHost b\r\n  HostName b.example.com\r\n');
  assert.equal(fs.statSync(cfg).mode & 0o777, 0o644);
});

test('ssh:addHost rejeita alvo/apelido inválidos e duplicados sem tocar no arquivo', async () => {
  const before = 'Host a\n';
  const { call, cfg } = setup(before);
  for (const input of [
    { target: '-oProxyCommand=x', alias: 'z' },
    { target: 'u@h;id', alias: 'z' },
    { target: 'u@h', alias: '-z' },
    { target: 'u@h', alias: 'a' },
    null,
  ]) {
    const res = await call('ssh:addHost', input);
    assert.equal(res.ok, false, JSON.stringify(input));
    assert.ok(res.error);
  }
  assert.equal(fs.readFileSync(cfg, 'utf8'), before);
});

test('ssh:configPath cria o arquivo e libera só ele no guard', { skip: process.platform === 'win32' }, async () => {
  const { home, call, guard, cfg } = setup(null);
  const p = await call('ssh:configPath');
  assert.equal(p, cfg);
  assert.ok(fs.existsSync(cfg));
  assert.equal(fs.statSync(cfg).mode & 0o777, 0o600);
  assert.equal(guard.isAllowed(cfg), true);
  assert.equal(guard.isAllowed(path.join(home, '.ssh', 'id_rsa')), false);
  assert.equal(guard.isAllowed(path.join(home, '.ssh')), false);
});

test('ssh:parseTarget expõe a validação ao renderer', async () => {
  const { call } = setup(null);
  assert.deepEqual(await call('ssh:parseTarget', 'u@h:22'), { user: 'u', host: 'h', port: 22 });
  assert.equal(await call('ssh:parseTarget', '-oX@h'), null);
});
