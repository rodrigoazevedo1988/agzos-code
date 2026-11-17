const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRemoteManager } = require('../../src/main/remote/manager');
const kh = require('../../src/main/remote/known-hosts');
const { providerFor, setRemoteManager, setRootsResolver } = require('../../src/main/workspace/provider-for');
const { createWindowGuards } = require('../../src/main/lib/window-guards');
const { createRemoteToolbox } = require('../../src/main/agent/remote-tools');
const { createLiveServer, providerSource } = require('../../src/main/modules/live/server');
const { createSshServer, generateKey } = require('../fixtures/ssh-server');

// Symlinks no host que apontam para fora da raiz remota (o servidor fixture serve
// a pasta temporária inteira; o projeto é uma subpasta dela).
const userKey = generateKey();
let server;
let root;
let proj;
let fora;
let manager;
let authority;
let rootUri;
let prov;
const sender = { id: 777, once() {}, isDestroyed: () => false };
let guards;
const U = (rel) => `${rootUri}/${rel}`;

before(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-symlink-')));
  proj = path.join(root, 'proj');
  fora = path.join(root, 'fora');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.mkdirSync(fora);
  fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'const a = 1;\n');
  fs.writeFileSync(path.join(proj, 'index.html'), '<p>ok</p>');
  fs.writeFileSync(path.join(fora, 'segredo.txt'), 'SEGREDO');
  fs.writeFileSync(path.join(fora, 'alvo.txt'), 'original');
  fs.symlinkSync(fora, path.join(proj, 'cfg')); // pasta para fora
  fs.symlinkSync(path.join(fora, 'alvo.txt'), path.join(proj, 'alvo-link.txt')); // arquivo para fora
  fs.symlinkSync(path.join(fora, 'nao-existe.txt'), path.join(proj, 'quebrado')); // link quebrado para fora
  fs.symlinkSync('src', path.join(proj, 'interno')); // link interno (relativo)
  fs.symlinkSync(proj, path.join(root, 'atalho')); // raiz aberta por um link
  server = createSshServer({ root, users: { deploy: { publicKeys: [userKey.public] } } });
  await server.listen();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-symlink-home-'));
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', server.port, server.hostPublic));
  fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), userKey.private, { mode: 0o600 });
  manager = createRemoteManager({ connectionOptions: () => ({ home, env: {}, platform: 'linux', knownHostsFiles: [path.join(home, '.ssh', 'known_hosts')] }) });
  setRemoteManager(manager);
  ({ authority } = await manager.connect(sender.id, `deploy@127.0.0.1:${server.port}`));
  rootUri = `ssh://${authority}${proj}`;
  guards = createWindowGuards();
  guards.guardFor(sender).allow(rootUri);
  setRootsResolver((id) => guards.guardFor(id).roots());
  prov = providerFor(rootUri, sender);
});

after(async () => {
  manager.disposeAll();
  setRootsResolver(null);
  setRemoteManager(null);
  await server.close();
});

const denied = (err) => err.code === 'EACCES' && /Acesso negado/.test(err.message);

test('provider SSH: ler, listar e consultar dentro de link para fora da raiz → negado', async () => {
  await assert.rejects(prov.readFile(U('cfg/segredo.txt')), denied);
  await assert.rejects(prov.readFile(U('alvo-link.txt')), denied);
  await assert.rejects(prov.readDir(U('cfg')), denied);
  await assert.rejects(prov.stat(U('cfg/segredo.txt')), denied);
  await assert.rejects(prov.createReadStream(U('cfg/segredo.txt')), denied);
  assert.equal(await prov.exists(U('cfg/segredo.txt')), false);
  // A listagem da raiz continua funcionando (o link aparece, mas não é seguido).
  const names = (await prov.readDir(rootUri)).map((e) => e.name).sort();
  assert.deepEqual(names, ['alvo-link.txt', 'cfg', 'index.html', 'interno', 'quebrado', 'src']);
});

test('provider SSH: escrever, criar pasta, remover e renomear via link para fora → negado (nada muda fora)', async () => {
  await assert.rejects(prov.writeFile(U('cfg/novo.txt'), 'x'), denied);
  await assert.rejects(prov.writeFile(U('alvo-link.txt'), 'trocado'), denied);
  await assert.rejects(prov.writeFile(U('quebrado'), 'criado fora'), denied);
  await assert.rejects(prov.mkdir(U('cfg/pasta')), denied);
  await assert.rejects(prov.remove(U('cfg/segredo.txt')), denied);
  await assert.rejects(prov.remove(U('alvo-link.txt')), denied);
  await assert.rejects(prov.rename(U('src/app.js'), U('cfg/app.js')), denied);
  await assert.rejects(prov.rename(U('cfg/segredo.txt'), U('src/s.txt')), denied);
  assert.equal(fs.existsSync(path.join(fora, 'novo.txt')), false);
  assert.equal(fs.existsSync(path.join(fora, 'nao-existe.txt')), false);
  assert.equal(fs.existsSync(path.join(fora, 'pasta')), false);
  assert.equal(fs.readFileSync(path.join(fora, 'alvo.txt'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(fora, 'segredo.txt'), 'utf8'), 'SEGREDO');
  assert.ok(fs.existsSync(path.join(proj, 'src', 'app.js')));
});

test('provider SSH: link interno à raiz e raiz aberta por link continuam funcionando', async () => {
  assert.equal(await prov.readFile(U('interno/app.js'), 'utf8'), 'const a = 1;\n');
  await prov.writeFile(U('interno/novo.js'), 'ok');
  assert.equal(fs.readFileSync(path.join(proj, 'src', 'novo.js'), 'utf8'), 'ok');
  await prov.mkdir(U('src/sub/dir'));
  await prov.rename(U('src/novo.js'), U('src/sub/novo.js'));
  await prov.remove(U('src/sub'));
  assert.equal(fs.existsSync(path.join(proj, 'src', 'sub')), false);
  assert.equal(await prov.realpath(U('interno/app.js')), U('src/app.js'));
  // Pasta com link para fora dentro: remover a pasta apaga o link, não o alvo.
  fs.mkdirSync(path.join(proj, 'tmpdir'));
  fs.symlinkSync(fora, path.join(proj, 'tmpdir', 'link'));
  await prov.remove(U('tmpdir'));
  assert.equal(fs.existsSync(path.join(proj, 'tmpdir')), false);
  assert.equal(fs.readFileSync(path.join(fora, 'segredo.txt'), 'utf8'), 'SEGREDO');

  // Raiz liberada pelo caminho do link (atalho → proj).
  const g2 = createWindowGuards();
  const other = { id: 778, once() {}, isDestroyed: () => false };
  await manager.connect(other.id, `deploy@127.0.0.1:${server.port}`);
  const atalho = `ssh://${authority}${root}/atalho`;
  g2.guardFor(other).allow(atalho);
  setRootsResolver((id) => (id === other.id ? g2.guardFor(id).roots() : guards.guardFor(id).roots()));
  try {
    const p2 = providerFor(atalho, other);
    assert.equal(await p2.readFile(`${atalho}/src/app.js`, 'utf8'), 'const a = 1;\n');
    await assert.rejects(p2.readFile(`${atalho}/cfg/segredo.txt`), denied);
  } finally {
    setRootsResolver((id) => guards.guardFor(id).roots());
  }
});

test('agente remoto: read_file/write_file via link para fora → acesso negado', async () => {
  const tb = createRemoteToolbox({ root: rootUri, provider: prov, checkpoint: null });
  await assert.rejects(tb.prepare('read_file', { path: 'cfg/segredo.txt' }), /Acesso negado/);
  await assert.rejects(tb.prepare('write_file', { path: 'cfg/.bashrc', content: 'x' }), /Acesso negado/);
  await assert.rejects(tb.prepare('list_dir', { path: 'cfg' }), /Acesso negado/);
  assert.equal(fs.existsSync(path.join(fora, '.bashrc')), false);
});

test('Ao Vivo remoto: realpath do provider; link para fora não é servido', async () => {
  const live = createLiveServer({ root: rootUri, isAllowed: () => true, source: providerSource(prov), startPort: 47100 });
  const { url } = await live.start();
  try {
    const ok = await fetch(`${url}index.html`);
    assert.equal(ok.status, 200);
    const out = await fetch(`${url}cfg/segredo.txt`);
    assert.notEqual(out.status, 200);
    assert.ok(!(await out.text()).includes('SEGREDO'));
    const viaInterno = await fetch(`${url}interno/app.js`);
    assert.equal(viaInterno.status, 200);
  } finally {
    await live.stop();
  }
});
