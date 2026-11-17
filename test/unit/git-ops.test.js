const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runGit } = require('../../src/main/git/run');
const { getStatus } = require('../../src/main/git/status');
const ops = require('../../src/main/git/ops');

const ID = { GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 't@x.com', GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 't@x.com' };
Object.assign(process.env, ID);

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
const git = (cwd, ...args) => runGit(cwd, args).then((r) => r.stdout.trim());

async function repoWithCommit() {
  const dir = tmp('agzos-ops-');
  await ops.init(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'um\n');
  await ops.stage(dir, []);
  await ops.commit(dir, 'primeiro');
  return dir;
}

test('init cria repo na branch main; stage + commit + log', async () => {
  const dir = await repoWithCommit();
  assert.equal(await git(dir, 'symbolic-ref', '--short', 'HEAD'), 'main');
  fs.writeFileSync(path.join(dir, 'b c.txt'), 'novo');
  await ops.stage(dir, ['b c.txt']);
  let st = await getStatus(dir);
  assert.deepEqual(st.staged.map((f) => f.path), ['b c.txt']);
  await ops.unstage(dir, ['b c.txt']);
  st = await getStatus(dir);
  assert.equal(st.staged.length, 0);
  await ops.stage(dir, ['b c.txt']);
  const { hash } = await ops.commit(dir, 'segundo');
  assert.ok(hash);
  const history = await ops.log(dir, { limit: 10 });
  assert.deepEqual(history.map((c) => c.subject), ['segundo', 'primeiro']);
  assert.equal(history[0].author, 'Teste');
});

test('unstage antes do primeiro commit (sem HEAD)', async () => {
  const dir = tmp('agzos-ops-');
  await ops.init(dir);
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  await ops.stage(dir, ['x.txt']);
  await ops.unstage(dir, ['x.txt']);
  const st = await getStatus(dir);
  assert.equal(st.staged.length, 0);
  assert.equal(st.changes[0].status, 'U');
  assert.deepEqual(await ops.log(dir), []);
});

test('discard restaura rastreado e apaga não rastreado', async () => {
  const dir = await repoWithCommit();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'mudou\n');
  fs.writeFileSync(path.join(dir, 'lixo.txt'), 'x');
  await ops.discard(dir, ['a.txt', 'lixo.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf-8'), 'um\n');
  assert.equal(fs.existsSync(path.join(dir, 'lixo.txt')), false);
});

test('diffFile: HEAD ↔ working e HEAD ↔ índice', async () => {
  const dir = await repoWithCommit();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'dois\n');
  let d = await ops.diffFile(dir, 'a.txt');
  assert.deepEqual([d.original, d.modified], ['um\n', 'dois\n']);
  await ops.stage(dir, ['a.txt']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'tres\n');
  d = await ops.diffFile(dir, 'a.txt', { staged: true });
  assert.deepEqual([d.original, d.modified], ['um\n', 'dois\n']);
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2]));
  d = await ops.diffFile(dir, 'bin.dat');
  assert.equal(d.binary, true);
});

test('createBranch + checkout + branches', async () => {
  const dir = await repoWithCommit();
  await ops.createBranch(dir, 'feat/nova');
  let b = await ops.branches(dir);
  assert.equal(b.current, 'feat/nova');
  await ops.checkout(dir, 'main');
  b = await ops.branches(dir);
  assert.equal(b.current, 'main');
  assert.deepEqual(b.local.map((x) => x.name).sort(), ['feat/nova', 'main']);
  await assert.rejects(ops.createBranch(dir, 'nome inválido'), /inválido/);
  await assert.rejects(ops.createBranch(dir, '-x'), /inválido/);
});

test('push/pull/sync contra um remote bare local; clone', async () => {
  const bare = tmp('agzos-bare-');
  await runGit(bare, ['init', '--bare', '-q', '--initial-branch=main']);
  const a = await repoWithCommit();
  await ops.addRemote(a, 'origin', bare);
  await ops.push(a, {});
  let st = await getStatus(a);
  assert.equal(st.upstream, 'origin/main');

  const parent = tmp('agzos-clone-');
  const { path: b } = await ops.clone(bare, parent, { name: 'copia', onProgress: () => {} });
  assert.equal(b, path.join(parent, 'copia'));
  assert.equal(fs.readFileSync(path.join(b, 'a.txt'), 'utf-8'), 'um\n');

  fs.writeFileSync(path.join(a, 'a.txt'), 'de a\n');
  await ops.stage(a, []);
  await ops.commit(a, 'de a');
  st = await getStatus(a);
  assert.equal(st.ahead, 1);
  await ops.sync(a, {});
  st = await getStatus(a);
  assert.equal(st.ahead, 0);

  await ops.fetch(b, {});
  st = await getStatus(b);
  assert.equal(st.behind, 1);
  await ops.pull(b, {});
  assert.equal(fs.readFileSync(path.join(b, 'a.txt'), 'utf-8'), 'de a\n');

  // push rejeitado (non-fast-forward)
  fs.writeFileSync(path.join(b, 'c.txt'), 'b');
  await ops.stage(b, []); await ops.commit(b, 'de b'); await ops.push(b, {});
  fs.writeFileSync(path.join(a, 'd.txt'), 'a');
  await ops.stage(a, []); await ops.commit(a, 'outro de a');
  await assert.rejects(ops.push(a, {}), (e) => e.kind === 'rejected');
  await assert.rejects(ops.clone(bare, parent, { name: 'copia' }), (e) => e.kind === 'dest-exists');
});

test('checkCloneUrl, repoNameFromUrl e parseProgress', () => {
  assert.equal(ops.repoNameFromUrl('https://github.com/org/meu-repo.git'), 'meu-repo');
  assert.equal(ops.repoNameFromUrl('git@github.com:org/x.git'), 'x');
  assert.throws(() => ops.checkCloneUrl('--upload-pack=evil'), /inválida/);
  assert.throws(() => ops.checkCloneUrl('ftp x'), /inválida/);
  assert.ok(ops.checkCloneUrl('git@github.com:a/b.git'));
  const p = ops.parseProgress('Receiving objects:  50% (5/10)\r');
  assert.equal(p.phase, 'Receiving objects');
  assert.equal(p.percent, 45);
  assert.throws(() => ops.checkPaths(['../fora']), /inválido/);
  assert.throws(() => ops.checkPaths(['/abs']), /inválido/);
});
