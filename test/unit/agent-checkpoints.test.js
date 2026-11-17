const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCheckpointStore } = require('../../src/main/agent/checkpoints');
const { createToolbox } = require('../../src/main/agent/tools');

function setup() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-cp-')));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-cpstore-'));
  fs.writeFileSync(path.join(root, 'keep.txt'), 'original\n');
  fs.mkdirSync(path.join(root, 'old'));
  fs.writeFileSync(path.join(root, 'old', 'x.txt'), 'x1\nx2\n');
  fs.writeFileSync(path.join(root, 'mv.txt'), 'mover\n');
  return { root, dir, cleanup: () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const run = (box, name, input) => box.prepare(name, input).execute({});

test('undo restaura criar, editar, apagar e mover (memória e disco)', async () => {
  const { root, dir, cleanup } = setup();
  try {
    const store = createCheckpointStore({ dir });
    const cp = store.create({ root });
    const box = createToolbox({ root, checkpoint: cp });
    await run(box, 'write_file', { path: 'novo/sub/a.txt', content: 'a\n' });
    await run(box, 'edit_file', { path: 'keep.txt', old_string: 'original', new_string: 'mudado' });
    await run(box, 'write_file', { path: 'keep.txt', content: 'mudado\nde novo\n' });
    await run(box, 'delete_path', { path: 'old' });
    await run(box, 'move_path', { from: 'mv.txt', to: 'movido/mv.txt' });
    await run(box, 'create_dir', { path: 'vazia' });

    const changes = cp.changes().map((c) => ({ ...c, path: path.relative(root, c.path) }));
    assert.deepEqual(changes, [
      { path: 'keep.txt', added: 2, removed: 1 },
      { path: 'movido/mv.txt', added: 1, removed: 0, created: true },
      { path: 'mv.txt', added: 0, removed: 1, deleted: true },
      { path: 'novo/sub/a.txt', added: 1, removed: 0, created: true },
      { path: 'old/x.txt', added: 0, removed: 2, deleted: true },
    ]);
    assert.equal(cp.finalize(), true);
    assert.ok(fs.existsSync(path.join(dir, `${cp.id}.json`)));

    // novo store (simula reinício do app): lê do disco
    const fresh = createCheckpointStore({ dir });
    const res = fresh.undo(cp.id);
    assert.deepEqual(res.errors, []);
    assert.ok(res.restored.length >= 5);
    assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'original\n');
    assert.equal(fs.readFileSync(path.join(root, 'old', 'x.txt'), 'utf8'), 'x1\nx2\n');
    assert.equal(fs.readFileSync(path.join(root, 'mv.txt'), 'utf8'), 'mover\n');
    for (const gone of ['novo', 'movido', 'vazia']) assert.ok(!fs.existsSync(path.join(root, gone)), gone);
    assert.ok(!fs.existsSync(path.join(dir, `${cp.id}.json`)));
    assert.match(fresh.undo(cp.id).errors[0].message, /não encontrado/);
  } finally { cleanup(); }
});

test('checkpoint sem mudanças não é salvo; id inválido é recusado', () => {
  const { root, dir, cleanup } = setup();
  try {
    const store = createCheckpointStore({ dir });
    const cp = store.create({ root });
    assert.equal(cp.finalize(), false);
    assert.deepEqual(fs.readdirSync(dir), []);
    assert.throws(() => store.undo('../../etc/passwd'), /inválido/);
  } finally { cleanup(); }
});

test('mantém no máximo N checkpoints no disco', () => {
  const { root, dir, cleanup } = setup();
  try {
    const store = createCheckpointStore({ dir, maxCount: 3 });
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const cp = store.create({ root });
      cp.record(path.join(root, `f${i}.txt`));
      cp.finalize();
      const file = path.join(dir, `${cp.id}.json`);
      fs.utimesSync(file, new Date(), new Date(Date.now() + i * 1000));
      ids.push(cp.id);
      store.prune();
    }
    assert.equal(fs.readdirSync(dir).length, 3);
    assert.ok(fs.existsSync(path.join(dir, `${ids[4]}.json`)));
  } finally { cleanup(); }
});
