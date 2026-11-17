const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAgent, createSteerQueue, sanitizeHistory } = require('../../src/main/agent/loop');
const { createAgentSessions } = require('../../src/main/agent/session');
const { createCheckpointStore } = require('../../src/main/agent/checkpoints');
const { createToolbox } = require('../../src/main/agent/tools');

let root;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-steer-')));
  fs.writeFileSync(path.join(root, 'a.js'), 'a\n');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** Provider falso; `onCall(i)` roda antes de responder o turno i (para injetar steer no meio). */
function fakeProvider(turns, onCall = () => {}) {
  const seen = [];
  let i = 0;
  return {
    seen,
    async* chatTools({ messages }) {
      seen.push(structuredClone(messages));
      const index = i++;
      await onCall(index);
      const turn = turns[index] || { text: 'fim' };
      if (turn.text) yield { type: 'text', delta: turn.text };
      for (const [k, c] of (turn.calls || []).entries()) yield { type: 'tool_call', id: `c${index}_${k}`, name: c.name, input: c.input };
      yield { type: 'stop', reason: 'stop' };
    },
  };
}

function run(provider, steering, events) {
  const store = createCheckpointStore({});
  const checkpoint = store.create({ root });
  return runAgent({
    provider, model: 'm', history: [{ role: 'user', content: 'faça' }], mode: 'auto',
    toolbox: createToolbox({ root, checkpoint }), checkpoint, emit: (e) => events.push(e),
    signal: new AbortController().signal, systemPrompt: 'SYS', requestApproval: async () => 'allow', steering,
  });
}

test('steer entra entre passos, sem cancelar, na ordem', async () => {
  const events = [];
  const steering = createSteerQueue();
  const provider = fakeProvider([
    { calls: [{ name: 'list_dir', input: { path: '.' } }] },
    { calls: [{ name: 'read_file', input: { path: 'a.js' } }] },
    { text: 'feito' },
  ], (i) => {
    if (i === 0) { steering.push({ id: 's1', content: 'primeiro' }); steering.push({ id: 's2', content: 'segundo' }); }
  });
  const done = await run(provider, steering, events);
  assert.equal(done.type, 'done');
  // 2ª chamada ao modelo já vê as duas mensagens, depois do resultado da ferramenta.
  const second = provider.seen[1];
  const tail = second.slice(-3);
  assert.equal(tail[0].role, 'tool');
  assert.deepEqual(tail.slice(1).map((m) => [m.role, m.content]), [['user', 'primeiro'], ['user', 'segundo']]);
  const steers = events.filter((e) => e.type === 'user_steer');
  assert.deepEqual(steers.map((e) => [e.id, e.content]), [['s1', 'primeiro'], ['s2', 'segundo']]);
  // o evento vem depois do tool_end do passo em andamento e antes do próximo tool_start
  const idx = (pred) => events.findIndex(pred);
  assert.ok(idx((e) => e.type === 'tool_end') < idx((e) => e.type === 'user_steer'));
  assert.ok(idx((e) => e.type === 'user_steer') < idx((e) => e.type === 'tool_start' && e.tool === 'read_file'));
  assert.ok(!events.some((e) => e.type === 'error'));
});

test('steer durante a resposta final faz o modelo continuar', async () => {
  const events = [];
  const steering = createSteerQueue();
  const provider = fakeProvider([{ text: 'quase' }, { text: 'agora sim' }], (i) => {
    if (i === 0) steering.push({ id: 's1', content: 'mais uma coisa' });
  });
  await run(provider, steering, events);
  assert.equal(provider.seen.length, 2);
  assert.deepEqual(provider.seen[1].slice(-2).map((m) => m.role), ['assistant', 'user']);
  assert.equal(events.at(-1).type, 'done');
});

test('steer depois do término é recusado (vira próximo pedido na UI)', async () => {
  const steering = createSteerQueue();
  await run(fakeProvider([{ text: 'ok' }]), steering, []);
  assert.equal(steering.closed, true);
  assert.equal(steering.push({ id: 'x', content: 'tarde' }), false);
});

test('sessão: steer(requestId) só aceita pedido ativo', async () => {
  const sent = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const provider = fakeProvider([{ calls: [{ name: 'list_dir', input: { path: '.' } }] }, { text: 'fim' }], async (i) => { if (i === 0) await gate; });
  const sessions = createAgentSessions({
    getRoot: () => root, getProvider: () => ({ provider, model: 'm' }), checkpoints: createCheckpointStore({}),
    send: (id, evt) => sent.push(evt), getEnv: () => ({}),
  });
  assert.equal(sessions.run('r1', { messages: [{ role: 'user', content: 'oi' }], mode: 'auto' }), true);
  assert.equal(sessions.steer('nao-existe', { content: 'x' }), false);
  assert.equal(sessions.steer('r1', { content: '' }), false);
  const accepted = sessions.steer('r1', { content: 'ajuste', id: 'm1' });
  assert.equal(accepted, true);
  release();
  await sessions.wait('r1');
  assert.ok(sent.some((e) => e.type === 'user_steer' && e.content === 'ajuste' && e.id === 'm1'));
  assert.equal(sessions.steer('r1', { content: 'tarde' }), false);
});

test('histórico aceita conteúdo com imagem', () => {
  const content = [{ type: 'text', text: 'veja' }, { type: 'image', mediaType: 'image/png', data: 'AAA' }];
  assert.deepEqual(sanitizeHistory([{ role: 'user', content }]), [{ role: 'user', content }]);
});
