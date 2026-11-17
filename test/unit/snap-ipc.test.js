const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { register, CHANNELS } = require('../../src/main/ipc/snap');

const payload = { lines: [[{ t: 'const x = 1;', c: '#E8E8E8' }]], title: 'a.js' };
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function setup({ modules = {}, savePath = null } = {}) {
  const handlers = {};
  const calls = { capture: [], clipboard: [], dialog: [] };
  register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    settingsStore: { load: () => ({ modules }) },
    getWindowFor: () => ({ id: 'win' }),
    capture: async (html) => {
      calls.capture.push(html);
      return { toPNG: () => PNG, getSize: () => ({ width: 640, height: 200 }), isEmpty: () => false };
    },
    clipboard: { writeImage: (img) => calls.clipboard.push(img) },
    dialog: {
      showSaveDialog: async (win, opts) => {
        calls.dialog.push(opts);
        return savePath ? { canceled: false, filePath: savePath } : { canceled: true };
      },
    },
  });
  const call = (name, ...args) => handlers[`snap:${name}`]({ sender: { id: 1 } }, ...args);
  return { call, calls };
}

test('snap:html devolve a página da prévia (escapada)', async () => {
  const { call } = setup();
  assert.deepEqual(CHANNELS, ['html', 'export']);
  const r = await call('html', { lines: [[{ t: '<b>', c: '#fff' }]] });
  assert.ok(r.html.includes('&lt;b&gt;'));
});

test('snap:export save grava o PNG no caminho escolhido no diálogo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-snap-'));
  const out = path.join(dir, 'x.png');
  try {
    const { call, calls } = setup({ savePath: out });
    const r = await call('export', payload, 'save');
    assert.deepEqual(r, { ok: true, path: out, width: 640, height: 200 });
    assert.deepEqual(fs.readFileSync(out), PNG);
    assert.equal(calls.capture.length, 1);
    assert.match(calls.dialog[0].defaultPath, /\.png$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('snap:export save cancelado não grava nada', async () => {
  const { call } = setup();
  assert.deepEqual(await call('export', payload, 'save'), { ok: false, canceled: true });
});

test('snap:export copy põe a imagem na área de transferência', async () => {
  const { call, calls } = setup();
  const r = await call('export', payload, 'copy');
  assert.deepEqual(r, { ok: true, width: 640, height: 200 });
  assert.equal(calls.clipboard.length, 1);
});

test('snap: ação inválida, payload vazio e módulo desabilitado são recusados', async () => {
  const { call } = setup();
  await assert.rejects(() => call('export', payload, 'rm'), /Ação inválida/);
  await assert.rejects(() => call('export', { lines: [] }, 'copy'), /Nada para capturar/);
  const off = setup({ modules: { snap: { enabled: false } } });
  await assert.rejects(() => off.call('export', payload, 'copy'), /desabilitad/);
  await assert.rejects(() => off.call('html', payload), /desabilitad/);
});
