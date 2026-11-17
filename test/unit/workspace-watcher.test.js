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
  const w = createWorkspaceWatcher({ watchImpl, debounceMs: 10, send: (id, dirs) => sent.push([id, dirs]) });
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
  const w = createWorkspaceWatcher({ watchImpl, send: () => {}, log: { warn() {} } });
  w.watch(1, '/a');
  w.watch(1, '/b');
  assert.equal(made[0].closed, true);
  made[1].emit('error', new Error('EMFILE'));
  assert.equal(w.size(), 0);
  const bad = createWorkspaceWatcher({ watchImpl: () => { throw new Error('nope'); }, send: () => {}, log: { warn() {} } });
  assert.equal(bad.watch(1, '/x'), false);
});
