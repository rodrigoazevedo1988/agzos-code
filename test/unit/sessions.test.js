const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatSessions } = require('../../src/main/ai/sessions');

const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(chat) {
  const events = [];
  const sessions = createChatSessions({ getProvider: () => ({ chat }), send: (...args) => events.push(args) });
  return { sessions, events };
}

test('envia chunks e done', async () => {
  const { sessions, events } = setup(async function* () { yield 'a'; await tick(); yield 'b'; });
  sessions.start('1', { model: 'm', messages: [] });
  await tick(); await tick();
  assert.deepEqual(events, [['ai:chunk', '1', 'a'], ['ai:chunk', '1', 'b'], ['ai:done', '1']]);
});

test('cancel aborta e envia error Interrompido', async () => {
  let signal;
  const { sessions, events } = setup(async function* (options) {
    signal = options.signal; yield 'a';
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
  });
  sessions.start('1', { messages: [] });
  await tick(); sessions.cancel('1'); await tick();
  assert.equal(signal.aborted, true);
  assert.deepEqual(events, [['ai:chunk', '1', 'a'], ['ai:error', '1', 'Interrompido']]);
});

test('erro do provider vira ai:error com texto amigável', async () => {
  const { sessions, events } = setup(async function* () { const e = new Error('falha'); e.userMessage = 'Erro amigável'; yield await Promise.reject(e); });
  sessions.start('1', { messages: [] }); await tick();
  assert.deepEqual(events, [['ai:error', '1', 'Erro amigável']]);
});

test('cancelAll aborta tudo', async () => {
  const signals = [];
  const { sessions, events } = setup(async function* ({ signal }) {
    signals.push(signal); await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true })); yield 'ignorado';
  });
  sessions.start('1', { messages: [] }); sessions.start('2', { messages: [] });
  await tick(); sessions.cancelAll(); await tick();
  assert.ok(signals.every((signal) => signal.aborted));
  assert.deepEqual(events, [['ai:error', '1', 'Interrompido'], ['ai:error', '2', 'Interrompido']]);
});
