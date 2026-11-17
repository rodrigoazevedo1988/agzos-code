const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { register, CHANNELS } = require('../../src/main/ipc/tree');
const { createWindowGuards } = require('../../src/main/lib/window-guards');

function setup(modules = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-tree-ipc-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-tree-out-')));
  fs.writeFileSync(path.join(root, 'a.txt'), '');
  fs.writeFileSync(path.join(outside, 'b.txt'), '');
  const guards = createWindowGuards();
  const w1 = { id: 1 };
  const w2 = { id: 2 };
  guards.register(w1).allow(root);
  guards.register(w2);
  const handlers = {};
  register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    guardFor: guards.guardFor, settingsStore: { load: () => ({ modules }) },
  });
  const call = (sender, ...args) => handlers['tree:generate']({ sender }, ...args);
  return {
    root, outside, w1, w2, call,
    cleanup: () => [root, outside].forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
  };
}

test('tree:generate gera a árvore de pasta liberada na janela', async () => {
  const s = setup();
  try {
    assert.deepEqual(CHANNELS, ['generate']);
    const r = await s.call(s.w1, s.root, { depth: 2 });
    assert.equal(r.text, `${path.basename(s.root)}/\n└── a.txt`);
    assert.equal(r.count, 1);
  } finally { s.cleanup(); }
});

test('tree:generate nega pasta fora do guard e pasta de outra janela', async () => {
  const s = setup();
  try {
    await assert.rejects(() => s.call(s.w1, s.outside), /Acesso negado/);
    await assert.rejects(() => s.call(s.w2, s.root), /Acesso negado/);
    await assert.rejects(() => s.call(s.w1, path.join(s.root, '..', path.basename(s.outside))), /Acesso negado/);
    await assert.rejects(() => s.call(s.w1, 'rel/x'), /Caminho inválido/);
    await assert.rejects(() => s.call(s.w1, path.join(s.root, 'a.txt')), /não é uma pasta/);
  } finally { s.cleanup(); }
});

test('tree:generate recusa com o módulo desabilitado', async () => {
  const s = setup({ tree: { enabled: false } });
  try {
    await assert.rejects(() => s.call(s.w1, s.root), /desabilitad/);
  } finally { s.cleanup(); }
});
