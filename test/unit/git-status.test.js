const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseStatusV2, groupFiles, parseLog, parseBranches, parseTrack, parseRemotes } = require('../../src/main/git/status');

const z = (...entries) => entries.join('\0') + '\0';

test('parseStatusV2: branch, upstream e ahead/behind', () => {
  const out = parseStatusV2(z(
    '# branch.oid 1234567890abcdef',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -3',
  ));
  assert.equal(out.branch, 'main');
  assert.equal(out.oid, '1234567890abcdef');
  assert.equal(out.upstream, 'origin/main');
  assert.equal(out.ahead, 2);
  assert.equal(out.behind, 3);
  assert.equal(out.detached, false);
  assert.equal(out.initial, false);
  assert.deepEqual(out.files, []);
});

test('parseStatusV2: modificado, staged e nome com espaço e acento', () => {
  const out = parseStatusV2(z(
    '# branch.oid abc',
    '# branch.head dev',
    '1 .M N... 100644 100644 100644 aaa bbb src/app.js',
    '1 M. N... 100644 100644 100644 aaa bbb docs/ação com espaço.md',
    '1 A. N... 000000 100644 100644 000 bbb novo.txt',
    '1 D. N... 100644 000000 000000 aaa 000 velho.txt',
  ));
  assert.equal(out.files.length, 4);
  assert.deepEqual(out.files[0], { path: 'src/app.js', index: '.', worktree: 'M', untracked: false, conflicted: false, ignored: false, submodule: false });
  assert.equal(out.files[1].path, 'docs/ação com espaço.md');
  assert.equal(out.files[1].index, 'M');
  const g = groupFiles(out.files);
  assert.deepEqual(g.staged.map((f) => [f.path, f.status]), [['docs/ação com espaço.md', 'M'], ['novo.txt', 'A'], ['velho.txt', 'D']]);
  assert.deepEqual(g.changes.map((f) => [f.path, f.status]), [['src/app.js', 'M']]);
});

test('parseStatusV2: renomeado com origPath (-z)', () => {
  const out = parseStatusV2(z(
    '# branch.head main',
    '2 R. N... 100644 100644 100644 aaa aaa R100 novo nome.js',
    'antigo nome.js',
    '? solto.txt',
  ));
  assert.equal(out.files.length, 2);
  assert.equal(out.files[0].path, 'novo nome.js');
  assert.equal(out.files[0].origPath, 'antigo nome.js');
  assert.equal(out.files[0].index, 'R');
  assert.equal(out.files[1].path, 'solto.txt');
  assert.equal(out.files[1].untracked, true);
});

test('parseStatusV2: untracked, ignorado e conflito', () => {
  const out = parseStatusV2(z(
    '# branch.head main',
    '? dir/novo arquivo.txt',
    '! build/out.js',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflito.js',
  ));
  const g = groupFiles(out.files);
  assert.deepEqual(g.changes.map((f) => [f.path, f.status]), [['dir/novo arquivo.txt', 'U']]);
  assert.deepEqual(g.conflicts.map((f) => f.path), ['conflito.js']);
  assert.equal(out.files[1].ignored, true);
  assert.equal(g.staged.length, 0);
});

test('parseStatusV2: arquivo staged e modificado aparece nos dois grupos', () => {
  const g = groupFiles(parseStatusV2(z('1 MM N... 100644 100644 100644 a b x.js')).files);
  assert.equal(g.staged.length, 1);
  assert.equal(g.changes.length, 1);
});

test('parseStatusV2: HEAD destacado e repositório sem commits', () => {
  const det = parseStatusV2(z('# branch.oid abc', '# branch.head (detached)'));
  assert.equal(det.branch, null);
  assert.equal(det.detached, true);
  const ini = parseStatusV2(z('# branch.oid (initial)', '# branch.head main'));
  assert.equal(ini.initial, true);
  assert.equal(ini.oid, null);
  assert.equal(ini.branch, 'main');
});

test('parseLog: campos, refs e merge', () => {
  const rec = (...f) => f.join('\x1f') + '\x1e';
  const out = parseLog(
    rec('a'.repeat(40), 'aaaaaaa', 'Ana', 'ana@x.com', '1700000000', 'p1 p2', 'HEAD -> main, origin/main', 'Merge: assunto | com pipe')
    + '\n' + rec('b'.repeat(40), 'bbbbbbb', 'Bruno', 'b@x.com', '1690000000', '', '', ''),
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].short, 'aaaaaaa');
  assert.equal(out[0].author, 'Ana');
  assert.equal(out[0].date, 1700000000000);
  assert.deepEqual(out[0].parents, ['p1', 'p2']);
  assert.deepEqual(out[0].refs, ['HEAD -> main', 'origin/main']);
  assert.equal(out[0].subject, 'Merge: assunto | com pipe');
  assert.deepEqual(out[1].parents, []);
  assert.deepEqual(out[1].refs, []);
});

test('parseBranches: locais, atual, upstream e remotas sem HEAD', () => {
  const line = (...f) => f.join('\x1f');
  const out = parseBranches([
    line('refs/heads/main', 'main', '*', 'origin/main', '[ahead 1, behind 2]', '1700000000', 'abc1234'),
    line('refs/heads/feat/x', 'feat/x', ' ', '', '', '1690000000', 'def5678'),
    line('refs/heads/old', 'old', ' ', 'origin/old', '[gone]', '1600000000', '0000000'),
    line('refs/remotes/origin/HEAD', 'origin/HEAD', ' ', '', '', '0', ''),
    line('refs/remotes/origin/main', 'origin/main', ' ', '', '', '1700000000', 'abc1234'),
  ].join('\n'));
  assert.equal(out.current, 'main');
  assert.deepEqual(out.local.map((b) => b.name), ['main', 'feat/x', 'old']);
  assert.equal(out.local[0].ahead, 1);
  assert.equal(out.local[0].behind, 2);
  assert.equal(out.local[2].gone, true);
  assert.equal(out.local[1].upstream, null);
  assert.deepEqual(out.remote.map((b) => b.name), ['origin/main']);
});

test('parseTrack: ahead/behind', () => {
  assert.deepEqual(parseTrack('[ahead 3]'), { ahead: 3, behind: 0, gone: false });
  assert.deepEqual(parseTrack('[behind 4]'), { ahead: 0, behind: 4, gone: false });
  assert.deepEqual(parseTrack(''), { ahead: 0, behind: 0, gone: false });
});

test('parseRemotes: um por nome', () => {
  const out = parseRemotes('origin\thttps://github.com/a/b.git (fetch)\norigin\thttps://github.com/a/b.git (push)\nup\tgit@github.com:c/d.git (fetch)\n');
  assert.deepEqual(out, [{ name: 'origin', url: 'https://github.com/a/b.git' }, { name: 'up', url: 'git@github.com:c/d.git' }]);
});
