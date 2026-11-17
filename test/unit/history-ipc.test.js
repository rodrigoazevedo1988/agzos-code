const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const historyIpc = require('../../src/main/ipc/history');
const history = require('../../src/main/modules/history');

let root;
let outside;
let userData;
let h;
let settings;
const call = (name, ...args) => h[`history:${name}`]({}, ...args);
const p = (...parts) => path.join(root, ...parts);

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-histipc-')));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-histout-')));
  userData = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-histud-')));
  const guard = createPathGuard();
  guard.allow(root);
  h = {};
  settings = { modules: {} };
  historyIpc.register({ handle: (ch, fn) => { h[ch] = fn; } }, {
    guard, userDataDir: userData, settingsStore: { load: () => settings },
  });
});
afterEach(() => {
  history.resetHistory();
  for (const d of [root, outside, userData]) fs.rmSync(d, { recursive: true, force: true });
});

test('recordSave guarda a versão salva; list e read devolvem', async () => {
  fs.writeFileSync(p('a.txt'), 'um');
  const entry = await call('recordSave', p('a.txt'));
  assert.equal(entry.origin, 'salvar');
  const list = await call('list', p('a.txt'));
  assert.equal(list.length, 1);
  assert.equal(list[0].versionId, `local:${entry.id}`);
  const r = await call('read', p('a.txt'), list[0].versionId);
  assert.equal(r.content, 'um');
  assert.ok(fs.existsSync(path.join(userData, 'local-history')));
});

test('recordSave usa o texto enviado pelo renderer, não o disco (dois salvamentos seguidos)', async () => {
  fs.writeFileSync(p('b.txt'), '');
  await call('recordSave', p('b.txt'), 'versão 1\r\nção');
  const list = await call('list', p('b.txt'));
  const r = await call('read', p('b.txt'), list[0].versionId);
  assert.equal(r.content, 'versão 1\r\nção');
});

test('caminho fora da pasta da janela é negado', async () => {
  fs.writeFileSync(path.join(outside, 'x.txt'), 'x');
  await assert.rejects(call('recordSave', path.join(outside, 'x.txt')), /negado/i);
  await assert.rejects(call('list', path.join(outside, 'x.txt')), /negado/i);
});

test('módulo desabilitado: recordSave e recordBefore não gravam', async () => {
  settings.modules.localHistory = { enabled: false };
  fs.writeFileSync(p('a.txt'), 'um');
  assert.equal(await call('recordSave', p('a.txt')), null);
  assert.equal(history.recordBefore(p('a.txt'), 'agente'), null);
  assert.deepEqual(await call('list', p('a.txt')), []);
});

test('recordBefore (agente/vassoura/cofre) guarda o conteúdo antes da escrita e nunca lança', async () => {
  fs.writeFileSync(p('a.txt'), 'antes');
  const e = history.recordBefore(p('a.txt'), 'agente');
  assert.equal(e.origin, 'agente');
  fs.writeFileSync(p('a.txt'), 'depois');
  assert.equal((await call('read', p('a.txt'), `local:${e.id}`)).content, 'antes');
  assert.equal(history.recordBefore(p('nao-existe.txt'), 'agente'), null);
  assert.equal(history.recordBefore(null, 'agente'), null);
});

test('restore escreve a versão byte a byte, com checkpoint, e entra no histórico', async () => {
  const crlf = 'linha 1\r\nlinha 2 ção\r\n';
  fs.writeFileSync(p('ação.txt'), crlf);
  const v1 = await call('recordSave', p('ação.txt'));
  fs.writeFileSync(p('ação.txt'), 'novo');
  await call('recordSave', p('ação.txt'));
  const r = await call('restore', p('ação.txt'), `local:${v1.id}`);
  assert.ok(r.checkpointId);
  assert.ok(fs.readFileSync(p('ação.txt')).equals(Buffer.from(crlf)));
  const list = await call('list', p('ação.txt'));
  assert.equal(list[0].origin, 'restaurar');
  assert.equal(list.length, 3);
});

test('restore de arquivo vazio', async () => {
  fs.writeFileSync(p('vazio.txt'), '');
  const v = await call('recordSave', p('vazio.txt'));
  fs.writeFileSync(p('vazio.txt'), 'algo');
  await call('restore', p('vazio.txt'), `local:${v.id}`);
  assert.equal(fs.readFileSync(p('vazio.txt')).length, 0);
});

test('read/restore recusam versão inválida', async () => {
  fs.writeFileSync(p('a.txt'), 'x');
  await call('recordSave', p('a.txt'));
  await assert.rejects(call('read', p('a.txt'), 'local:../../x'), /inválid/i);
  await assert.rejects(call('read', p('a.txt'), 'outra:1'), /inválid/i);
  await assert.rejects(call('restore', p('a.txt'), 42), /inválid/i);
});

test('clear(path) apaga o histórico do arquivo', async () => {
  fs.writeFileSync(p('a.txt'), 'x');
  await call('recordSave', p('a.txt'));
  await call('clear', p('a.txt'));
  assert.deepEqual(await call('list', p('a.txt')), []);
});

test('timeline: commits do git + versões locais; read/restore de commit', async () => {
  const { execFileSync } = require('node:child_process');
  const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Ana', GIT_AUTHOR_EMAIL: 'a@a', GIT_COMMITTER_NAME: 'Ana', GIT_COMMITTER_EMAIL: 'a@a' };
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: ENV });
  git('init', '-q');
  fs.writeFileSync(p('a.txt'), 'commit 1\n');
  git('add', '.'); git('commit', '-qm', 'primeiro commit');
  fs.writeFileSync(p('a.txt'), 'salvo\n');
  await call('recordSave', p('a.txt'));
  const tl = await call('timeline', p('a.txt'));
  assert.equal(tl.git, true);
  assert.deepEqual(tl.items.map((i) => i.kind), ['commit', 'local']);
  assert.equal(tl.items[0].author, 'Ana');
  assert.equal(tl.items[0].message, 'primeiro commit');
  const r = await call('read', p('a.txt'), tl.items[0].versionId);
  assert.equal(r.content, 'commit 1\n');
  await call('restore', p('a.txt'), tl.items[0].versionId);
  assert.equal(fs.readFileSync(p('a.txt'), 'utf8'), 'commit 1\n');
});

test('timeline: módulo Git Slider desabilitado → sem commits', async () => {
  settings.modules.gitSlider = { enabled: false };
  fs.writeFileSync(p('a.txt'), 'x');
  await call('recordSave', p('a.txt'));
  const tl = await call('timeline', p('a.txt'));
  assert.equal(tl.git, false);
  assert.equal(tl.items.length, 1);
});
