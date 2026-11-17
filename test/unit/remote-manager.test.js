const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { createRemoteManager } = require('../../src/main/remote/manager');

// Client falso: conta end() e permite simular a queda (close).
function fakeClient() {
  const c = new EventEmitter();
  c.ended = 0;
  c.end = () => { c.ended++; };
  return c;
}

const resolved = { authority: 'u@h:22', host: 'h', port: 22, user: 'u', label: 'h' };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('connect durante a reconexão automática espera por ela (sem segunda conexão em paralelo)', async () => {
  const opened = [];
  const pending = [];
  const manager = createRemoteManager({
    openConnection: () => {
      const d = deferred();
      pending.push(d);
      return d.promise.then((client) => { opened.push(client); return { client }; });
    },
    retryDelays: [0],
    sleep: () => Promise.resolve(),
  });
  const p0 = manager.connect(1, resolved);
  pending[0].resolve(fakeClient());
  await p0;
  // Queda: estado lost → reconexão automática começa (1 open pendente).
  opened[0].emit('close');
  await new Promise((r) => setImmediate(r));
  assert.equal(pending.length, 2);
  const again = manager.connect(1, resolved);
  await new Promise((r) => setImmediate(r));
  assert.equal(pending.length, 2, 'connect não abre outro client enquanto a reconexão corre');
  pending[1].resolve(fakeClient());
  const info = await again;
  assert.equal(info.state, 'connected');
  assert.equal(opened.length, 2);
  assert.equal((await manager.ensure(1, resolved.authority)).client, opened[1]);
  manager.disposeAll();
});

test('open fecha o client anterior ao substituir (sem conexão vazada)', async () => {
  const clients = [];
  const manager = createRemoteManager({
    openConnection: async () => { const c = fakeClient(); clients.push(c); return { client: c }; },
    retryDelays: [],
  });
  await manager.connect(1, resolved);
  const entry = manager.get(1, resolved.authority);
  // Força um estado em que há client e um reconnect manual abre outro.
  entry.state = 'failed';
  await manager.reconnect(1, resolved.authority);
  assert.equal(clients.length, 2);
  assert.equal(clients[0].ended, 1, 'client antigo recebeu end()');
  assert.equal(clients[1].ended, 0);
  // O close do antigo não derruba a entrada nova.
  clients[0].emit('close');
  assert.equal(manager.get(1, resolved.authority).client, clients[1]);
  assert.equal(manager.get(1, resolved.authority).state, 'connected');
  manager.disposeAll();
});

test('respostas de keyboard-interactive (OTP) não ficam na memória para a reconexão', async () => {
  const seen = [];
  let prompts;
  const manager = createRemoteManager({
    openConnection: async (_r, opts) => { prompts = opts; return { client: fakeClient() }; },
  });
  let n = 0;
  await manager.connect(1, resolved, { askSecret: async (req) => { seen.push(req.kind); return { value: `v${++n}` }; } });
  assert.deepEqual(await prompts.askSecret({ kind: 'keyboard-interactive', title: 'OTP' }), { value: 'v1' });
  assert.deepEqual(await prompts.askSecret({ kind: 'keyboard-interactive', title: 'OTP' }), { value: 'v2' });
  assert.equal(seen.length, 2);
  manager.disposeAll();
});
