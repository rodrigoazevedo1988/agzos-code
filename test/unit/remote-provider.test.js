const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createRemoteManager } = require('../../src/main/remote/manager');
const kh = require('../../src/main/remote/known-hosts');
const { providerFor, setRemoteManager } = require('../../src/main/workspace/provider-for');
const { createWindowGuards } = require('../../src/main/lib/window-guards');
const fsIpc = require('../../src/main/ipc/fs');
const workspaceIpc = require('../../src/main/ipc/workspace');
const fileProtocol = require('../../src/main/lib/file-protocol');
const remoteSearch = require('../../src/main/remote/search');
const { createSshServer, generateKey } = require('../fixtures/ssh-server');

const NASTY = "a b'$(touch PWNED);`id`.txt";
const userKey = generateKey();
let server;
let root;
let manager;
let authority;
let rootUri;
const sender = { id: 501, once() {}, isDestroyed: () => false };
const handlers = new Map();
let guards;

before(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-prov-')));
  fs.mkdirSync(path.join(root, 'proj', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'proj', 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'proj', 'src', 'app.js'), 'const alvo = 1;\n// procurar aqui\n');
  fs.writeFileSync(path.join(root, 'proj', 'node_modules', 'x', 'i.js'), 'procurar aqui');
  fs.writeFileSync(path.join(root, 'proj', '.env'), 'A=1');
  fs.writeFileSync(path.join(root, 'proj', '.oculto'), 'x');
  fs.writeFileSync(path.join(root, 'proj', NASTY), 'conteúdo perigoso');
  fs.writeFileSync(path.join(root, 'proj', 'img.bin'), Buffer.from([1, 2, 0, 3, 4, 5, 6, 7, 8, 9]));
  fs.writeFileSync(path.join(root, 'fora.txt'), 'fora');
  server = createSshServer({ root, users: { deploy: { publicKeys: [userKey.public] } } });
  await server.listen();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-prov-home-'));
  fs.mkdirSync(path.join(home, '.ssh'));
  fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), kh.formatEntry('127.0.0.1', server.port, server.hostPublic));
  fs.writeFileSync(path.join(home, '.ssh', 'id_ed25519'), userKey.private, { mode: 0o600 });
  manager = createRemoteManager({ connectionOptions: () => ({ home, env: {}, platform: 'linux', knownHostsFiles: [path.join(home, '.ssh', 'known_hosts')] }) });
  setRemoteManager(manager);
  ({ authority } = await manager.connect(sender.id, `deploy@127.0.0.1:${server.port}`));
  rootUri = `ssh://${authority}${root}/proj`;
  guards = createWindowGuards();
  fsIpc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, { guardFor: guards.guardFor, shell: {} });
  workspaceIpc.register({ handle: (ch, fn) => handlers.set(ch, fn) }, {
    guardFor: guards.guardFor, getRecentFolders: () => [], addRecentFolder: () => {},
  });
});

after(async () => {
  manager.disposeAll();
  setRemoteManager(null);
  await server.close();
});

const call = (ch, ...args) => handlers.get(ch)({ sender }, ...args);

test('workspace:open remoto: exige conexão desta janela e pasta existente', async () => {
  assert.equal(await handlers.get('workspace:open')({ sender: { id: 999, once() {} } }, rootUri), false);
  assert.equal(await call('workspace:open', `ssh://${authority}${root}/proj/src/app.js`), false);
  assert.equal(await call('workspace:open', `ssh://${authority}${root}/nao-existe`), false);
  assert.equal(await call('workspace:open', `${rootUri}/`), true);
  assert.equal(guards.guardFor(sender).isAllowed(`${rootUri}/src/app.js`), true);
  assert.equal(guards.guardFor(sender).isAllowed(`ssh://${authority}${root}/fora.txt`), false);
});

test('fs:readDir/readFile/stat/exists via SFTP, com guard', async () => {
  const list = await call('fs:readDir', rootUri);
  const names = list.map((e) => e.name).sort();
  assert.ok(names.includes('src') && names.includes(NASTY));
  assert.ok(names.includes('.oculto')); // arquivos com ponto aparecem (files.exclude)
  const src = list.find((e) => e.name === 'src');
  assert.equal(src.isDirectory, true);
  assert.equal(src.path, `${rootUri}/src`);
  const f = await call('fs:readFile', `${rootUri}/src/app.js`, { detectBinary: true });
  assert.equal(f.binary, false);
  assert.match(f.content, /alvo/);
  assert.ok(f.mtime > 0);
  const bin = await call('fs:readFile', `${rootUri}/img.bin`, { detectBinary: true });
  assert.equal(bin.binary, true);
  const st = await call('fs:stat', `${rootUri}/src/app.js`);
  assert.equal(st.isFile, true);
  assert.equal(await call('fs:exists', `${rootUri}/src/app.js`), true);
  assert.equal(await call('fs:exists', `${rootUri}/zzz`), false);
  // Fora do guard: negado (inclusive stat/exists remotos).
  await assert.rejects(call('fs:readFile', `ssh://${authority}${root}/fora.txt`), /Acesso negado/);
  await assert.rejects(call('fs:readFile', `${rootUri}/../fora.txt`), /Acesso negado/);
  await assert.rejects(call('fs:readFile', `${rootUri}/%2e%2e/fora.txt`), /Acesso negado/);
  assert.equal(await call('fs:stat', `ssh://${authority}${root}/fora.txt`), null);
  assert.equal(await call('fs:exists', `ssh://${authority}${root}/fora.txt`), false);
  const bytes = await call('fs:readBinary', `${rootUri}/img.bin`);
  assert.deepEqual([...bytes], [1, 2, 0, 3, 4, 5, 6, 7, 8, 9]);
});

test('fs:writeFile/mkdir/rename/delete no host (nome com aspas e $())', async () => {
  await call('fs:mkdir', `${rootUri}/novo/a/b`);
  assert.ok(fs.statSync(path.join(root, 'proj', 'novo', 'a', 'b')).isDirectory());
  await call('fs:writeFile', `${rootUri}/novo/a/b/${NASTY}`, 'olá ✓');
  assert.equal(fs.readFileSync(path.join(root, 'proj', 'novo', 'a', 'b', NASTY), 'utf8'), 'olá ✓');
  await call('fs:rename', `${rootUri}/novo/a/b/${NASTY}`, `${rootUri}/novo/renomeado.txt`);
  assert.ok(fs.existsSync(path.join(root, 'proj', 'novo', 'renomeado.txt')));
  await call('fs:delete', `${rootUri}/novo`);
  assert.equal(fs.existsSync(path.join(root, 'proj', 'novo')), false);
  assert.equal(fs.existsSync(path.join(root, 'PWNED')), false);
  assert.equal(fs.existsSync(path.join(root, 'proj', 'PWNED')), false);
});

test('provider.exec: argumentos com aspas, $() e ; chegam literais', async () => {
  const prov = providerFor(rootUri, sender);
  const res = await prov.exec('cat', [NASTY], { cwd: rootUri });
  assert.equal(res.code, 0);
  assert.equal(res.stdout, 'conteúdo perigoso');
  const echo = await prov.exec('printf', ['%s', '$(id); `id` | x'], { cwd: `${rootUri}/src`, env: { LC_ALL: 'C' } });
  assert.equal(echo.stdout, '$(id); `id` | x');
  assert.equal(fs.existsSync(path.join(root, 'proj', 'PWNED')), false);
  const last = server.execLog.at(-1);
  assert.match(last, /^cd '.*\/proj\/src' && env LC_ALL='C' 'printf' '%s' '\$\(id\); `id` \| x'$/);
  const fail = await prov.exec('sh', ['-c', 'exit 3']);
  assert.equal(fail.code, 3);
  const slow = await prov.exec('sleep', ['5'], { timeoutMs: 200 });
  assert.equal(slow.timedOut, true);
});

test('fs:findFiles remoto (rg/find) com exclusões e fs:searchText', async () => {
  const files = await call('fs:findFiles', rootUri, 1000);
  const rels = files.map((f) => f.relativePath).sort();
  assert.ok(rels.includes('src/app.js'));
  assert.ok(rels.includes('.env'));
  assert.ok(!rels.some((r) => r.startsWith('node_modules')));
  assert.ok(rels.includes('.oculto'));
  assert.equal(files.find((f) => f.relativePath === 'src/app.js').path, `${rootUri}/src/app.js`);
  const res = await call('fs:searchText', rootUri, 'procurar aqui');
  assert.deepEqual(res.hits.map((h) => [h.file, h.line]), [[`${rootUri}/src/app.js`, 2]]);
  const nasty = await call('fs:searchText', rootUri, "'$(touch PWNED)'");
  assert.deepEqual(nasty.hits, []);
  assert.equal(fs.existsSync(path.join(root, 'proj', 'PWNED')), false);
  assert.deepEqual(await call('fs:searchText', `ssh://${authority}${root}`, 'xx').catch((e) => e.message), 'Acesso negado: ' + `ssh://${authority}${root}`);
});

test('parsers da busca: rg --json e grep', () => {
  const rg = ['__AGZOS_RG__',
    JSON.stringify({ type: 'begin', data: { path: { text: './a.js' } } }),
    JSON.stringify({ type: 'match', data: { path: { text: './a.js' }, lines: { text: '  x = 1\n' }, line_number: 3 } }),
  ].join('\n');
  assert.deepEqual(remoteSearch.parseSearchOutput(rg), [{ rel: 'a.js', line: 3, text: 'x = 1' }]);
  const grep = '__AGZOS_GREP__\n./src/b c.js:10:  y\nlixo\n';
  assert.deepEqual(remoteSearch.parseSearchOutput(grep), [{ rel: 'src/b c.js', line: 10, text: 'y' }]);
  assert.deepEqual(remoteSearch.parseSearchOutput('outra coisa\nx:1:y'), []);
});

test('protocolo agzos-file serve arquivo remoto por stream SFTP com Range', async () => {
  const token = guards.tokenFor(sender);
  const handle = fileProtocol.createFileProtocolHandler({
    guardForHost: guards.guardForToken,
    providerForHost: (host, p) => providerFor(p, guards.ownerForToken(host)),
  });
  const url = `agzos-file://${token}/~ssh/${encodeURIComponent(authority)}${root.split('/').map(encodeURIComponent).join('/')}/proj/img.bin`;
  const full = await handle({ url, method: 'GET', headers: new Headers() });
  assert.equal(full.status, 200);
  assert.deepEqual([...new Uint8Array(await full.arrayBuffer())], [1, 2, 0, 3, 4, 5, 6, 7, 8, 9]);
  const part = await handle({ url, method: 'GET', headers: new Headers({ range: 'bytes=2-4' }) });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-4/10');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [0, 3, 4]);
  const outside = await handle({ url: `agzos-file://${token}/~ssh/${encodeURIComponent(authority)}${root}/fora.txt`, method: 'GET', headers: new Headers() });
  assert.equal(outside.status, 403);
  const traversal = await handle({ url: `agzos-file://${token}/~ssh/${encodeURIComponent(authority)}${root}/proj/%2e%2e/fora.txt`, method: 'GET', headers: new Headers() });
  assert.notEqual(traversal.status, 200);
});
