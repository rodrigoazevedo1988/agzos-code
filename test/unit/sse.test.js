const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSSE } = require('../../src/main/ai/sse');

async function collect(chunks) { const events = []; for await (const event of parseSSE(chunks)) events.push(event); return events; }

test('evento simples e linhas data', async () => {
  assert.deepEqual(await collect(['data: olá\ndata: mundo\n\n']), [{ event: null, data: 'olá\nmundo' }]);
});
test('evento quebrado entre chunks e UTF-8 dividido', async () => {
  assert.deepEqual(await collect(['data: {"a"', ':1}\n\n']), [{ event: null, data: '{"a":1}' }]);
  const bytes = new TextEncoder().encode('data: olá\n\n');
  assert.deepEqual(await collect([bytes.slice(0, 9), bytes.slice(9)]), [{ event: null, data: 'olá' }]);
});
test('CRLF, comentário, campo event e múltiplos eventos', async () => {
  assert.deepEqual(await collect([': comentário\r\nevent: teste\r\ndata: um\r\n\r\ndata: dois\r\n\r\n']), [
    { event: 'teste', data: 'um' }, { event: null, data: 'dois' }
  ]);
});
test('[DONE] é entregue como data', async () => {
  assert.deepEqual(await collect(['data: [DONE]\n\n']), [{ event: null, data: '[DONE]' }]);
});
