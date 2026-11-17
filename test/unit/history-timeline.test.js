const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  parseGitLog, mergeTimeline, createLru, gitLogArgs, buildTimeline, readVersion, parseVersionId,
} = require('../../src/main/modules/history/timeline');
const { createHistoryStore } = require('../../src/main/modules/history/store');
const { runGitFor, readFileFor } = require('../../src/main/modules/history/io');

const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const RS = '\x1e';
const US = '\x1f';

test('parseGitLog: commits com autor, data, mensagem e caminho (rename via --follow)', () => {
  const text = `${RS}${SHA2}${US}Maria Silva${US}1700000200${US}refactor: renomeia\n\nsrc/novo.js\n`
    + `${RS}${SHA1}${US}João${US}1700000100${US}feat: cria  arquivo  ção\n\nsrc/velho.js\n`;
  assert.deepEqual(parseGitLog(text), [
    { sha: SHA2, author: 'Maria Silva', ts: 1700000200000, message: 'refactor: renomeia', path: 'src/novo.js' },
    { sha: SHA1, author: 'João', ts: 1700000100000, message: 'feat: cria  arquivo  ção', path: 'src/velho.js' },
  ]);
});

test('parseGitLog: entrada vazia, lixo e sha inválido são ignorados', () => {
  assert.deepEqual(parseGitLog(''), []);
  assert.deepEqual(parseGitLog('fatal: bad\n'), []);
  assert.deepEqual(parseGitLog(`${RS}xyz${US}a${US}1${US}m\n\nf\n`), []);
});

test('gitLogArgs: --follow, limite, formato e caminho depois de --', () => {
  const args = gitLogArgs('src/a b.js', 200);
  assert.ok(args.includes('--follow'));
  assert.deepEqual(args.slice(-2), ['--', 'src/a b.js']);
  assert.ok(args.includes('200'));
  assert.ok(args.includes('core.quotePath=false'));
});

test('mergeTimeline: commits + local em ordem de tempo (mais antiga primeiro)', () => {
  const commits = [
    { sha: SHA2, author: 'B', ts: 3000, message: 'dois', path: 'a.js' },
    { sha: SHA1, author: 'A', ts: 1000, message: 'um', path: 'a.js' },
  ];
  const local = [{ id: '4000', ts: 4000, size: 3, origin: 'salvar' }, { id: '2000', ts: 2000, size: 2, origin: 'agente' }];
  const items = mergeTimeline(commits, local);
  assert.deepEqual(items.map((i) => i.versionId), [
    `git:${SHA1}:a.js`, 'local:2000', `git:${SHA2}:a.js`, 'local:4000',
  ]);
  assert.equal(items[0].kind, 'commit');
  assert.equal(items[0].author, 'A');
  assert.equal(items[1].kind, 'local');
  assert.equal(items[1].origin, 'agente');
});

test('parseVersionId: local e git; resto é inválido', () => {
  assert.deepEqual(parseVersionId('local:1700000000000'), { kind: 'local', id: '1700000000000' });
  assert.deepEqual(parseVersionId(`git:${SHA1}:src/a:b.js`), { kind: 'git', sha: SHA1, rel: 'src/a:b.js' });
  for (const bad of ['local:../x', 'git:xyz:a', `git:${SHA1}:`, 'outra:1', 42, null, `git:${SHA1}:../fora.js`, `git:${SHA1}:/abs.js`]) {
    assert.throws(() => parseVersionId(bad), /inválid/i, String(bad));
  }
});

test('LRU: respeita o limite em bytes e descarta o menos usado', () => {
  const lru = createLru({ maxBytes: 10 });
  lru.set('a', Buffer.alloc(4));
  lru.set('b', Buffer.alloc(4));
  assert.ok(lru.get('a'));
  lru.set('c', Buffer.alloc(4)); // estoura: sai b (menos usado)
  assert.equal(lru.get('b'), undefined);
  assert.ok(lru.get('a'));
  assert.ok(lru.get('c'));
  lru.set('grande', Buffer.alloc(11)); // maior que o limite: não entra
  assert.equal(lru.get('grande'), undefined);
  assert.ok(lru.bytes <= 10);
});

// ---------------------------------------------------------- com git real
let repo;
let ud;
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 't@t' };
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: ENV });

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-tl-')));
  ud = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-tlud-')));
});
afterEach(() => {
  for (const d of [repo, ud]) fs.rmSync(d, { recursive: true, force: true });
});

test('buildTimeline + readVersion: commits (com rename) e versões locais', async () => {
  git('init', '-q');
  fs.mkdirSync(path.join(repo, 'pasta ç'));
  const old = path.join(repo, 'pasta ç', 'velho.txt');
  const BODY = Array.from({ length: 20 }, (_, i) => `linha ${i}\r\n`).join('');
  fs.writeFileSync(old, BODY);
  git('add', '.'); git('commit', '-qm', 'primeiro');
  const file = path.join(repo, 'pasta ç', 'novo.txt');
  git('mv', path.join('pasta ç', 'velho.txt'), path.join('pasta ç', 'novo.txt'));
  fs.writeFileSync(file, `${BODY}fim\r\n`);
  git('add', '.'); git('commit', '-qm', 'segundo');
  const store = createHistoryStore({ dir: path.join(ud, 'h') });
  fs.writeFileSync(file, 'local\n');
  store.record(file, 'salvar');

  const tl = await buildTimeline(file, { store, runGitFor, maxCommits: 200 });
  assert.equal(tl.git, true);
  assert.equal(tl.truncated, false);
  const kinds = tl.items.map((i) => i.kind);
  assert.deepEqual(kinds, ['commit', 'commit', 'local']);
  assert.equal(tl.items[1].message, 'segundo');

  const cache = createLru({ maxBytes: 1024 });
  const first = await readVersion(file, tl.items[0].versionId, { store, runGitFor, cache });
  assert.ok(first.equals(Buffer.from(BODY)));
  const second = await readVersion(file, tl.items[1].versionId, { store, runGitFor, cache });
  assert.equal(second.toString(), `${BODY}fim\r\n`);
  assert.ok(cache.get(tl.items[1].versionId));
  const local = await readVersion(file, tl.items[2].versionId, { store, runGitFor, cache });
  assert.equal(local.toString(), 'local\n');
});

test('buildTimeline: maxCommits limita e marca truncated', async () => {
  git('init', '-q');
  const file = path.join(repo, 'a.txt');
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(file, `v${i}\n`);
    git('add', '.'); git('commit', '-qm', `c${i}`);
  }
  const tl = await buildTimeline(file, { store: null, runGitFor, maxCommits: 3 });
  assert.equal(tl.items.length, 3);
  assert.equal(tl.truncated, true);
  assert.deepEqual(tl.items.map((i) => i.message), ['c1', 'c2', 'c3']);
});

test('buildTimeline: fora de repositório → só local, git: false', async () => {
  const file = path.join(repo, 'a.txt');
  fs.writeFileSync(file, 'x');
  const store = createHistoryStore({ dir: path.join(ud, 'h') });
  store.record(file, 'salvar');
  const tl = await buildTimeline(file, { store, runGitFor, maxCommits: 200 });
  assert.equal(tl.git, false);
  assert.equal(tl.items.length, 1);
  assert.equal(readFileFor.length, 1);
});

test('readVersion: versão git de OUTRO arquivo do repositório é recusada', async () => {
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
  fs.writeFileSync(path.join(repo, 'segredo.txt'), 's');
  git('add', '.'); git('commit', '-qm', 'c');
  const sha = git('rev-parse', 'HEAD').trim();
  await assert.rejects(
    readVersion(path.join(repo, 'a.txt'), `git:${sha}:segredo.txt`, { runGitFor, known: new Map() }),
    /não encontrada/i,
  );
  const ok = await readVersion(path.join(repo, 'a.txt'), `git:${sha}:a.txt`, { runGitFor, known: new Map() });
  assert.equal(ok.toString(), 'a');
});
