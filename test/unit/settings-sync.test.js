/**
 * settings:save entre janelas: merge de 3 vias (só campos que a janela mudou) e
 * aviso settings:changed às outras janelas.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');

function setup(initial = {}) {
  const { register } = require('../../src/main/ipc/settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-settings-sync-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(initial));
  const handlers = {};
  const windows = [];
  const wc = (id) => {
    const s = new EventEmitter();
    s.id = id;
    s.sent = [];
    s.isDestroyed = () => false;
    s.send = (ch, payload) => s.sent.push({ ch, payload });
    windows.push(s);
    return s;
  };
  register({ handle: (name, fn) => { handlers[name] = fn; } }, {
    app: { getPath: () => dir },
    listWebContents: () => windows,
  });
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  return { handlers, wc, read };
}

test('salvar na janela A avisa a janela B com settings:changed', async () => {
  const { handlers, wc } = setup({ theme: 'agzos-dark' });
  const a = wc(1);
  const b = wc(2);
  const sa = await handlers['settings:load']({ sender: a });
  await handlers['settings:load']({ sender: b });
  await handlers['settings:save']({ sender: a }, { ...sa, theme: 'monokai' });
  const msg = b.sent.find((m) => m.ch === 'settings:changed');
  assert.ok(msg, 'B recebeu settings:changed');
  assert.equal(msg.payload.theme, 'monokai');
  assert.equal(a.sent.some((m) => m.ch === 'settings:changed'), false, 'A não recebe o próprio eco');
});

test('cópia velha de B não desfaz o que A mudou (merge por campo)', async () => {
  const { handlers, wc, read } = setup({ theme: 'agzos-dark', fontSize: 14 });
  const a = wc(1);
  const b = wc(2);
  const sa = await handlers['settings:load']({ sender: a });
  const sb = await handlers['settings:load']({ sender: b });
  await handlers['settings:save']({ sender: a }, { ...sa, theme: 'monokai' });
  // B ainda com a cópia antiga (theme agzos-dark), muda só fontSize
  await handlers['settings:save']({ sender: b }, { ...sb, fontSize: 18 });
  const disk = read();
  assert.equal(disk.theme, 'monokai');
  assert.equal(disk.fontSize, 18);
});

test('merge em profundidade: seções aninhadas mudadas por janelas diferentes', async () => {
  const { handlers, wc, read } = setup({});
  const a = wc(1);
  const b = wc(2);
  const sa = await handlers['settings:load']({ sender: a });
  const sb = await handlers['settings:load']({ sender: b });
  await handlers['settings:save']({ sender: a }, { ...sa, editor: { ...sa.editor, tabSize: 4 } });
  await handlers['settings:save']({ sender: b }, { ...sb, editor: { ...sb.editor, minimap: false } });
  const disk = read();
  assert.equal(disk.editor.tabSize, 4);
  assert.equal(disk.editor.minimap, false);
});

test('salvar sem mudança não avisa ninguém (sem ping-pong entre janelas)', async () => {
  const { handlers, wc } = setup({ theme: 'monokai' });
  const a = wc(1);
  const b = wc(2);
  const sa = await handlers['settings:load']({ sender: a });
  await handlers['settings:load']({ sender: b });
  await handlers['settings:save']({ sender: a }, sa);
  assert.equal(b.sent.length, 0);
});

test('depois do ack do aviso, voltar um campo ao valor antigo vale (não é confundido com cópia velha)', async () => {
  const { handlers, wc, read, acks } = setupWithAck({ theme: 'agzos-dark' });
  const a = wc(1);
  const b = wc(2);
  const sa = await handlers['settings:load']({ sender: a });
  await handlers['settings:load']({ sender: b });
  await handlers['settings:save']({ sender: a }, { ...sa, theme: 'monokai' });
  const msg = b.sent.find((m) => m.ch === 'settings:changed');
  // B aplica o aviso e confirma
  acks['settings:ack']({ sender: b }, msg.seq);
  await handlers['settings:save']({ sender: b }, { ...msg.payload, theme: 'agzos-dark' });
  assert.equal(read().theme, 'agzos-dark');
});

function setupWithAck(initial) {
  const { register } = require('../../src/main/ipc/settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-settings-ack-'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(initial));
  const handlers = {};
  const acks = {};
  const windows = [];
  const wc = (id) => {
    const s = new EventEmitter();
    s.id = id;
    s.sent = [];
    s.isDestroyed = () => false;
    s.send = (ch, payload, seq) => s.sent.push({ ch, payload, seq });
    windows.push(s);
    return s;
  };
  register({ handle: (n, fn) => { handlers[n] = fn; }, on: (n, fn) => { acks[n] = fn; } }, {
    app: { getPath: () => dir },
    listWebContents: () => windows,
  });
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  return { handlers, wc, read, acks };
}
