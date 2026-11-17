const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const childProcess = require('node:child_process');
const { createWorkerHost } = require('../../src/main/modules/worker-host');

const script = path.join(__dirname, 'fixtures', 'echo-worker.js');

// Adapta child_process.fork à interface de utilityProcess (postMessage → send).
let forks = 0;
function fork(file) {
  forks++;
  const child = childProcess.fork(file, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  return {
    postMessage: (msg) => child.connected && child.send(msg),
    on: (ev, fn) => child.on(ev, fn),
    kill: () => child.kill(),
  };
}

const hosts = [];
function make(opts = {}) {
  const h = createWorkerHost({ script, fork, ...opts });
  hosts.push(h);
  return h;
}
afterEach(() => {
  while (hosts.length) hosts.pop().dispose();
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('cria o processo só na primeira chamada', async () => {
  const before = forks;
  const h = make();
  assert.equal(h.isAlive(), false);
  assert.equal(forks, before);
  assert.equal(await h.call('echo', 1), 1);
  assert.equal(h.isAlive(), true);
  assert.deepEqual(await h.call('echo', { a: [2] }), { a: [2] });
  assert.equal(forks, before + 1);
});

test('encerra após idleMs sem pendências', async () => {
  const h = make({ idleMs: 50 });
  assert.equal(await h.call('echo', 1), 1);
  await wait(150);
  assert.equal(h.isAlive(), false);
  assert.equal(await h.call('echo', 2), 2);
  assert.equal(h.isAlive(), true);
});

test('não encerra por ociosidade enquanto há chamada pendente', async () => {
  const h = make({ idleMs: 30 });
  assert.equal(await h.call('sleep', 120), 'acordou');
  assert.equal(h.isAlive(), true);
});

test('cancelamento rejeita com AbortError e avisa o filho', async () => {
  const h = make();
  await h.call('echo', 0);
  const ac = new AbortController();
  const p = h.call('sleep', 1000, { signal: ac.signal });
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (err) => err.name === 'AbortError');
  assert.ok(Date.now() - t0 < 100, 'rejeita em < 100 ms');
  // o processo continua utilizável depois do cancelamento
  assert.equal(await h.call('echo', 5), 5);
});

test('signal já abortado rejeita sem enviar', async () => {
  const h = make();
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(h.call('echo', 1, { signal: ac.signal }), (err) => err.name === 'AbortError');
  assert.equal(h.isAlive(), false);
});

test('processo morto rejeita pendentes e recria', async () => {
  const h = make();
  await assert.rejects(h.call('crash'), /encerrou/);
  assert.equal(await h.call('echo', 2), 2);
});

test('erro do handler vira rejeição com message e code', async () => {
  const h = make();
  await assert.rejects(h.call('fail'), (err) => err.message === 'deu ruim' && err.code === 'E_TESTE');
  await assert.rejects(h.call('nao_existe'), /desconhecido/);
});

test('dispose encerra o processo e rejeita pendentes', async () => {
  const h = make();
  const p = h.call('sleep', 1000);
  await wait(20);
  h.dispose();
  await assert.rejects(p, /encerrad/);
  assert.equal(h.isAlive(), false);
});
