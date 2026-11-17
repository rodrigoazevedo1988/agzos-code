const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateTree, createIgnoreMatcher, localSource } = require('../../src/main/modules/tree/generate');

function mkTree(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-tree-')));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    if (rel.endsWith('/')) { fs.mkdirSync(abs, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test('gera a árvore com ├── e └──, pastas primeiro e em ordem alfabética', async () => {
  const root = mkTree({ 'b.txt': '', 'a.txt': '', 'src/z.js': '', 'src/lib/x.js': '', 'docs/': '' });
  try {
    const r = await generateTree(root);
    const name = path.basename(root);
    assert.equal(r.text, [
      `${name}/`,
      '├── docs/',
      '├── src/',
      '│   ├── lib/',
      '│   │   └── x.js',
      '│   └── z.js',
      '├── a.txt',
      '└── b.txt',
    ].join('\n'));
    assert.equal(r.count, 7);
    assert.equal(r.truncated, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('profundidade limita os níveis abaixo da raiz', async () => {
  const root = mkTree({ 'src/lib/deep/x.js': '', 'a.txt': '' });
  try {
    const r = await generateTree(root, { depth: 1 });
    assert.deepEqual(r.text.split('\n').slice(1), ['├── src/', '└── a.txt']);
    const r2 = await generateTree(root, { depth: 2 });
    assert.deepEqual(r2.text.split('\n').slice(1), ['├── src/', '│   └── lib/', '└── a.txt']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('só pastas e ocultos', async () => {
  const root = mkTree({ 'src/a.js': '', '.env': '', '.config/x': '', 'r.md': '' });
  try {
    const dirs = await generateTree(root, { dirsOnly: true, gitignore: false });
    assert.deepEqual(dirs.text.split('\n').slice(1), ['└── src/']);
    const withHidden = await generateTree(root, { hidden: true, gitignore: false });
    assert.deepEqual(withHidden.text.split('\n').slice(1), [
      '├── .config/', '│   └── x', '├── src/', '│   └── a.js', '├── .env', '└── r.md',
    ]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('respeita .gitignore (globs, pasta com /, âncora e !negação) e .gitignore aninhado', async () => {
  const root = mkTree({
    '.gitignore': '# comentário\nnode_modules/\n*.log\n!keep.log\n/build\ndist/**\n',
    'node_modules/pkg/index.js': '',
    'a.log': '', 'keep.log': '', 'build/out.js': '', 'src/build/ok.js': '', 'dist/x/y.js': '',
    'src/app.js': '', 'src/.gitignore': 'secret.txt\n', 'src/secret.txt': '', 'secret.txt': '',
  });
  try {
    const r = await generateTree(root, { hidden: false });
    assert.deepEqual(r.text.split('\n').slice(1), [
      '├── dist/',
      '├── src/',
      '│   ├── build/',
      '│   │   └── ok.js',
      '│   └── app.js',
      '├── keep.log',
      '└── secret.txt',
    ]);
    const all = await generateTree(root, { gitignore: false, depth: 1 });
    assert.ok(all.text.includes('node_modules/'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('.git nunca aparece com gitignore ligado, mesmo com ocultos', async () => {
  const root = mkTree({ '.git/HEAD': '', 'a.js': '' });
  try {
    const r = await generateTree(root, { hidden: true });
    assert.deepEqual(r.text.split('\n').slice(1), ['└── a.js']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('limite de entradas trunca com aviso', async () => {
  const files = {};
  for (let i = 0; i < 30; i++) files[`f${String(i).padStart(2, '0')}.txt`] = '';
  const root = mkTree(files);
  try {
    const r = await generateTree(root, { max: 10 });
    assert.equal(r.truncated, true);
    assert.equal(r.count, 10);
    const lines = r.text.split('\n');
    assert.equal(lines.length, 1 + 10 + 1);
    assert.match(lines.at(-1), /limite de 10 entradas/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('opções inválidas voltam ao padrão (depth 1..20, max ≤ 5000)', async () => {
  const root = mkTree({ 'a/b/c/d/e.txt': '' });
  try {
    const r = await generateTree(root, { depth: 'x', max: -3 });
    assert.ok(r.text.includes('c/'));
    assert.ok(!r.text.includes('d/'));
    const r2 = await generateTree(root, { depth: 999, max: 10 ** 9 });
    assert.ok(r2.text.includes('e.txt'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('symlink de pasta não é seguido (evita laço)', async (t) => {
  const root = mkTree({ 'src/a.js': '' });
  try {
    try { fs.symlinkSync(root, path.join(root, 'src', 'loop')); } catch { t.skip('sem symlink'); return; }
    const r = await generateTree(root);
    assert.ok(r.text.includes('loop'));
    assert.ok(!r.text.includes('loop/'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('fonte de leitura é trocável (provider remoto)', async () => {
  const fake = {
    async readDir(dir) {
      if (dir === '/r') return [{ name: 'x', isDirectory: true }, { name: 'y.txt', isDirectory: false }];
      if (dir === '/r/x') return [{ name: 'z.txt', isDirectory: false }];
      return [];
    },
    async readFile() { return null; },
    join: (a, b) => `${a}/${b}`,
    basename: (p) => p.split('/').pop(),
  };
  const r = await generateTree('/r', {}, fake);
  assert.equal(r.text, ['r/', '├── x/', '│   └── z.txt', '└── y.txt'].join('\n'));
  assert.equal(typeof localSource.readDir, 'function');
});

test('createIgnoreMatcher: regras simples', () => {
  const m = createIgnoreMatcher('*.tmp\n/root.txt\nlogs/\n!logs/keep\na/**/b\n\\#hash\n');
  assert.equal(m('x.tmp', false), true);
  assert.equal(m('deep/x.tmp', false), true);
  assert.equal(m('root.txt', false), true);
  assert.equal(m('sub/root.txt', false), undefined);
  assert.equal(m('logs', true), true);
  assert.equal(m('logs', false), undefined);
  assert.equal(m('logs/keep', false), false);
  assert.equal(m('a/b', true), true);
  assert.equal(m('a/x/y/b', false), true);
  assert.equal(m('#hash', false), true);
  assert.equal(m('ok.js', false), undefined);
});

test('createIgnoreMatcher: casos comuns do .gitignore', () => {
  const m = createIgnoreMatcher('*.log\n!keep.log\n/dist\nbuild/\n**/node_modules\n[abc].c\n');
  assert.equal(m('x.log', false), true);
  assert.equal(m('deep/x.log', false), true);
  assert.equal(m('keep.log', false), false);
  assert.equal(m('dist', true), true);
  assert.equal(m('sub/dist', true), undefined);
  assert.equal(m('build', true), true);
  assert.equal(m('build', false), undefined);
  assert.equal(m('a/b/node_modules', true), true);
  assert.equal(m('b.c', false), true);
  assert.equal(m('d.c', false), undefined);
});

test('createIgnoreMatcher: regra patológica não congela (ReDoS)', () => {
  const m = createIgnoreMatcher('**a**a**a**a**a**a**a**b\n');
  const t0 = process.hrtime.bigint();
  assert.equal(m('a'.repeat(1000), false), undefined);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 50);
});

test('createIgnoreMatcher: classe inválida é ignorada com aviso, sem derrubar', () => {
  const warns = [];
  const m = createIgnoreMatcher('[z-a]\n*.tmp\n', { log: { warn: (...a) => warns.push(a.join(' ')) } });
  assert.equal(m('x.tmp', false), true);
  assert.equal(m('z', false), undefined);
  assert.equal(warns.length, 1);
});

test('createIgnoreMatcher: limite de regras', () => {
  const warns = [];
  const lines = Array.from({ length: 2100 }, (_, i) => `f${i}`).join('\n');
  const m = createIgnoreMatcher(lines, { log: { warn: (...a) => warns.push(a.join(' ')) } });
  assert.equal(m('f0', false), true);
  assert.equal(m('f2050', false), undefined);
  assert.ok(warns.some((w) => /2000/.test(w)));
});

test('generateTree: .gitignore com [z-a] não derruba a árvore', async () => {
  const root = mkTree({ '.gitignore': '[z-a]\n*.tmp\n', 'a.txt': 'x', 'b.tmp': 'x' });
  const r = await generateTree(root, {});
  assert.match(r.text, /a\.txt/);
  assert.doesNotMatch(r.text, /b\.tmp/);
});
