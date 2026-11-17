const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createWorkspaceWatcher, isIgnoredChange } = require('../../src/main/lib/workspace-watcher');

function fakeWatch() {
  const made = [];
  const watchImpl = (root, opts) => {
    const w = new EventEmitter();
    w.root = root; w.opts = opts; w.closed = false;
    w.close = () => { w.closed = true; };
    made.push(w);
    return w;
  };
  return { made, watchImpl };
}

test('agrupa mudanças e avisa os diretórios pais', async () => {
  const { made, watchImpl } = fakeWatch();
  const sent = [];
  const w = createWorkspaceWatcher({ watchImpl, platform: 'darwin', debounceMs: 10, send: (id, dirs) => sent.push([id, dirs]) });
  w.watch(1, '/p');
  assert.equal(made[0].opts.recursive, true);
  made[0].emit('change', 'rename', path.join('Global', 'video.mp4'));
  made[0].emit('change', 'rename', path.join('Global', 'b.mp4'));
  made[0].emit('change', 'rename', 'novo.txt');
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][1].sort(), [path.join('/p'), path.join('/p', 'Global')].sort());
});

test('ignora node_modules, .git e afins', () => {
  assert.equal(isIgnoredChange('node_modules/x/y.js'), true);
  assert.equal(isIgnoredChange(path.join('.git', 'index')), true);
  assert.equal(isIgnoredChange('src/app.js'), false);
});

test('trocar de pasta fecha o observador anterior; erro desliga sem quebrar', () => {
  const { made, watchImpl } = fakeWatch();
  const w = createWorkspaceWatcher({ watchImpl, platform: 'win32', send: () => {}, log: { warn() {} } });
  w.watch(1, '/a');
  w.watch(1, '/b');
  assert.equal(made[0].closed, true);
  made[1].emit('error', new Error('EMFILE'));
  assert.equal(w.size(), 0);
  const bad = createWorkspaceWatcher({ watchImpl: () => { throw new Error('nope'); }, platform: 'darwin', send: () => {}, log: { warn() {} } });
  assert.equal(bad.watch(1, '/x'), false);
});

const R = path.resolve('/proj');

test('Linux: não usa recursive; observa só a raiz e as pastas lidas pela árvore', async () => {
  const { made, watchImpl } = fakeWatch();
  const sent = [];
  const w = createWorkspaceWatcher({ watchImpl, platform: 'linux', debounceMs: 10, send: (id, dirs) => sent.push([id, dirs]) });
  assert.equal(w.watch(1, R), true);
  assert.equal(made.length, 1);
  assert.equal(made[0].root, R);
  assert.notEqual(made[0].opts.recursive, true);
  assert.equal(w.watchDir(1, path.join(R, 'src')), true);
  assert.equal(w.watchDir(1, path.join(R, 'src')), true); // repetido: não duplica
  assert.equal(made.length, 2);
  assert.notEqual(made[1].opts.recursive, true);
  // Fora da raiz, pastas pesadas e janela sem pasta: não observa.
  assert.equal(w.watchDir(1, path.resolve('/outra')), false);
  assert.equal(w.watchDir(1, path.join(R, 'node_modules')), false);
  assert.equal(w.watchDir(1, path.join(R, 'a', '.git', 'x')), false);
  assert.equal(w.watchDir(2, path.join(R, 'src')), false);
  assert.equal(made.length, 2);
  made[1].emit('change', 'rename', 'novo.txt');
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(sent, [[1, [path.join(R, 'src')]]]);
  assert.equal(w.dirCount(1), 2);
  // Trocar de pasta / fechar janela fecha todos.
  w.unwatch(1);
  assert.ok(made.every((m) => m.closed));
  assert.equal(w.dirCount(1), 0);
});

test('Linux: limite de pastas observadas', () => {
  const { made, watchImpl } = fakeWatch();
  const warns = [];
  const w = createWorkspaceWatcher({ watchImpl, platform: 'linux', maxDirs: 3, send: () => {}, log: { warn: (...a) => warns.push(a.join(' ')) } });
  w.watch(1, R);
  assert.equal(w.watchDir(1, path.join(R, 'a')), true);
  assert.equal(w.watchDir(1, path.join(R, 'b')), true);
  assert.equal(w.watchDir(1, path.join(R, 'c')), false);
  assert.equal(made.length, 3);
  assert.equal(warns.length, 1);
});

test('Linux: ENOSPC/EMFILE desliga o observador da janela com aviso, sem quebrar', () => {
  const warns = [];
  let n = 0;
  const made = [];
  const watchImpl = () => {
    n++;
    if (n === 3) { const e = new Error('ENOSPC: System limit for number of file watchers reached'); e.code = 'ENOSPC'; throw e; }
    const ee = new EventEmitter();
    ee.closed = false;
    ee.close = () => { ee.closed = true; };
    made.push(ee);
    return ee;
  };
  const w = createWorkspaceWatcher({ watchImpl, platform: 'linux', send: () => {}, log: { warn: (...a) => warns.push(a.join(' ')) } });
  w.watch(1, R);
  assert.equal(w.watchDir(1, path.join(R, 'a')), true);
  assert.equal(w.watchDir(1, path.join(R, 'b')), false);
  assert.equal(w.size(), 0);
  assert.ok(made.every((m) => m.closed));
  assert.ok(warns.some((x) => /ENOSPC/.test(x)));
  assert.equal(w.watchDir(1, path.join(R, 'c')), false);

  // Erro assíncrono EMFILE num observador também desliga a janela.
  const f = fakeWatch();
  const w2 = createWorkspaceWatcher({ watchImpl: f.watchImpl, platform: 'linux', send: () => {}, log: { warn() {} } });
  w2.watch(1, R);
  w2.watchDir(1, path.join(R, 'a'));
  const err = new Error('EMFILE'); err.code = 'EMFILE';
  f.made[1].emit('error', err);
  assert.equal(w2.size(), 0);
  assert.ok(f.made.every((m) => m.closed));
});

test('Linux: pasta observada que some só fecha aquele observador', () => {
  const f = fakeWatch();
  const w = createWorkspaceWatcher({ watchImpl: f.watchImpl, platform: 'linux', send: () => {}, log: { warn() {} } });
  w.watch(1, R);
  w.watchDir(1, path.join(R, 'a'));
  const err = new Error('ENOENT'); err.code = 'ENOENT';
  f.made[1].emit('error', err);
  assert.equal(f.made[1].closed, true);
  assert.equal(f.made[0].closed, false);
  assert.equal(w.dirCount(1), 1);
  assert.equal(w.size(), 1);
});

test('macOS/Windows: watchDir não cria observadores extras (recursive nativo)', () => {
  const f = fakeWatch();
  const w = createWorkspaceWatcher({ watchImpl: f.watchImpl, platform: 'darwin', send: () => {} });
  w.watch(1, R);
  assert.equal(w.watchDir(1, path.join(R, 'src')), true);
  assert.equal(f.made.length, 1);
});
