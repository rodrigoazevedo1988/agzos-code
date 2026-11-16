const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/terminal-sessions.js')).href);

function mk(store, extra = {}, opts) {
  const id = store.nextId();
  return store.add({ id, title: id, ...extra }, opts);
}

test('add: cada sessão abre grupo próprio e vira ativa; split entra no grupo ativo após a ativa', async () => {
  const { createSessionStore } = await load();
  const s = createSessionStore();
  assert.equal(s.size, 0);
  assert.equal(s.active(), null);
  const a = mk(s);
  const b = mk(s);
  assert.equal(s.activeSessionId, b.id);
  assert.deepEqual(s.groups.map((g) => g.sessionIds), [[a.id], [b.id]]);
  s.activate(a.id);
  const c = mk(s, {}, { split: true });
  assert.deepEqual(s.groups.map((g) => g.sessionIds), [[a.id, c.id], [b.id]]);
  assert.equal(c.groupId, a.groupId);
  assert.equal(s.activeGroupId, a.groupId);
  assert.deepEqual(s.visible().map((x) => x.id), [a.id, c.id]);
  assert.deepEqual(s.ordered().map((x) => x.id), [a.id, c.id, b.id]);
  assert.throws(() => s.add({ id: a.id }));
});

test('split sem sessão ativa cria grupo novo', async () => {
  const { createSessionStore } = await load();
  const s = createSessionStore();
  const a = mk(s, {}, { split: true });
  assert.deepEqual(s.groups.map((g) => g.sessionIds), [[a.id]]);
});

test('remove: vizinha do mesmo grupo, senão grupo anterior/seguinte; último esvazia', async () => {
  const { createSessionStore } = await load();
  const s = createSessionStore();
  const a = mk(s);
  const b = mk(s, {}, { split: true }); // [a,b]
  const c = mk(s); // [a,b],[c]
  s.activate(b.id);
  assert.equal(s.remove(b.id).nextActiveId, a.id);
  assert.deepEqual(s.groups.map((g) => g.sessionIds), [[a.id], [c.id]]);
  s.activate(a.id);
  assert.equal(s.remove(a.id).nextActiveId, c.id); // sem anterior: vai para o seguinte
  assert.equal(s.groups.length, 1);
  const d = mk(s); // [c],[d]
  assert.equal(s.remove(d.id).nextActiveId, c.id); // grupo anterior
  // remover uma inativa não muda a ativa
  const e = mk(s);
  s.activate(c.id);
  assert.equal(s.remove(e.id).nextActiveId, c.id);
  const r = s.remove(c.id);
  assert.equal(r.removed.id, c.id);
  assert.equal(r.nextActiveId, null);
  assert.equal(s.size, 0);
  assert.deepEqual(s.groups, []);
  assert.equal(s.remove('nada').removed, null);
});

test('cycle percorre na ordem de exibição, circular', async () => {
  const { createSessionStore } = await load();
  const s = createSessionStore();
  assert.equal(s.cycle(1), null);
  const a = mk(s);
  const b = mk(s);
  s.activate(a.id);
  const c = mk(s, {}, { split: true }); // [a,c],[b]
  s.activate(a.id);
  assert.equal(s.cycle(1), c.id);
  assert.equal(s.cycle(1), b.id);
  assert.equal(s.cycle(1), a.id);
  assert.equal(s.cycle(-1), b.id);
  assert.equal(s.activeSessionId, b.id);
});

test('rename limpa espaços, limita tamanho e rejeita vazio', async () => {
  const { createSessionStore } = await load();
  const s = createSessionStore();
  const a = mk(s);
  assert.equal(s.rename(a.id, '   '), false);
  assert.equal(s.rename(a.id, '  meu   server  '), true);
  assert.equal(s.get(a.id).title, 'meu server');
  assert.equal(s.get(a.id).renamed, true);
  s.rename(a.id, 'x'.repeat(200));
  assert.equal(s.get(a.id).title.length, 60);
  assert.equal(s.rename('nada', 'x'), false);
});

test('rows: glifos de divisão e marca de ativa', async () => {
  const { createSessionStore, splitGlyph } = await load();
  const s = createSessionStore();
  const a = mk(s);
  mk(s, {}, { split: true });
  mk(s, {}, { split: true });
  mk(s);
  const rows = s.rows();
  assert.deepEqual(rows.map((r) => r.glyph), ['┌', '├', '└', '']);
  assert.deepEqual(rows.map((r) => r.active), [false, false, false, true]);
  assert.equal(rows[0].session.id, a.id);
  assert.equal(splitGlyph(0, 1), '');
  assert.equal(splitGlyph(1, 2), '└');
});

test('defaultTitle numera repetidos', async () => {
  const { defaultTitle } = await load();
  assert.equal(defaultTitle('bash', []), 'bash');
  assert.equal(defaultTitle('bash', ['bash']), 'bash (2)');
  assert.equal(defaultTitle('bash', ['bash', 'bash (2)']), 'bash (3)');
  assert.equal(defaultTitle('', []), 'Terminal');
});

test('resizeSplit preserva soma dos pesos e respeita mínimo', async () => {
  const { resizeSplit } = await load();
  const r = resizeSplit({ wa: 200, wb: 200, weightA: 1, weightB: 1, dx: 100 });
  assert.ok(Math.abs(r.weightA - 1.5) < 1e-9);
  assert.ok(Math.abs(r.weightB - 0.5) < 1e-9);
  const clamp = resizeSplit({ wa: 200, wb: 200, weightA: 1, weightB: 1, dx: 1000 });
  assert.ok(Math.abs(clamp.weightB - (2 * 80) / 400) < 1e-9);
  const zero = resizeSplit({ wa: 0, wb: 0, weightA: 1, weightB: 1, dx: 5 });
  assert.deepEqual(zero, { weightA: 1, weightB: 1 });
});

test('portas: url, rótulo de endereço e normalização', async () => {
  const { portUrl, portHostLabel, normalizePorts } = await load();
  assert.equal(portUrl(3000), 'http://localhost:3000');
  assert.equal(portHostLabel('0.0.0.0'), 'todas as interfaces');
  assert.equal(portHostLabel('::'), 'todas as interfaces');
  assert.equal(portHostLabel('127.0.0.1'), 'somente local');
  assert.equal(portHostLabel('192.168.0.5'), '192.168.0.5');
  const list = normalizePorts([
    { port: 8080, address: '::', pid: null, process: '' },
    { port: 5173, address: '127.0.0.1', pid: 10, process: 'node' },
    { port: 8080, address: '0.0.0.0', pid: 22, process: 'python3' },
    { port: 'x' }, { port: 70000 }, null,
  ]);
  assert.deepEqual(list.map((p) => p.port), [5173, 8080]);
  assert.equal(list[1].pid, 22);
  assert.equal(list[1].process, 'python3');
  assert.deepEqual(list[1].addresses, ['::', '0.0.0.0']);
  assert.deepEqual(normalizePorts(undefined), []);
});
