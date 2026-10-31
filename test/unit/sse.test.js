const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseSSE } = require('../../src/main/ai/sse');

/**
 * Cria um stream assíncrono a partir de uma lista de chunks.
 * Os chunks entram como Uint8Array (como chegam do fetch), a menos que o
 * teste peça strings explicitamente.
 */
async function* streamOf(chunks, { asString = false } = {}) {
  const encoder = new TextEncoder();
  for (const chunk of chunks) {
    yield asString ? chunk : encoder.encode(chunk);
  }
}

async function collect(chunks, opts) {
  const events = [];
  for await (const evt of parseSSE(streamOf(chunks, opts))) {
    events.push(evt);
  }
  return events;
}

/** Igual a streamOf, mas recebe Uint8Array já prontos (sem re-encodar). */
async function* streamOfRaw(chunks) {
  for (const chunk of chunks) yield chunk;
}

test('evento simples', async () => {
  const events = await collect(['data: oi\n\n']);
  assert.deepEqual(events, [{ event: null, data: 'oi' }]);
});

test('evento quebrado entre chunks', async () => {
  // O `:` do segundo chunk está no meio da linha, não é comentário.
  const events = await collect(['data: {"a"', ':1}\n\n']);
  assert.deepEqual(events, [{ event: null, data: '{"a":1}' }]);
});

test('aceita CRLF', async () => {
  const events = await collect(['data: oi\r\n\r\n']);
  assert.deepEqual(events, [{ event: null, data: 'oi' }]);
});

test('ignora linha de comentário', async () => {
  const events = await collect([': keep-alive\n\ndata: oi\n\n']);
  assert.deepEqual(events, [{ event: null, data: 'oi' }]);
});

test('campo event vem no resultado', async () => {
  const events = await collect(['event: ping\ndata: {}\n\n']);
  assert.deepEqual(events, [{ event: 'ping', data: '{}' }]);
});

test('múltiplos eventos num chunk', async () => {
  const events = await collect(['data: um\n\ndata: dois\n\n']);
  assert.deepEqual(events, [
    { event: null, data: 'um' },
    { event: null, data: 'dois' },
  ]);
});

test('linhas data: do mesmo evento são unidas com quebra de linha', async () => {
  const events = await collect(['data: linha 1\ndata: linha 2\n\n']);
  assert.deepEqual(events, [{ event: null, data: 'linha 1\nlinha 2' }]);
});

test('[DONE] é entregue como data (quem consome decide parar)', async () => {
  const events = await collect(['data: [DONE]\n\n']);
  assert.deepEqual(events, [{ event: null, data: '[DONE]' }]);
});

test('aceita chunks como string', async () => {
  const events = await collect(['data: texto\n\n'], { asString: true });
  assert.deepEqual(events, [{ event: null, data: 'texto' }]);
});

test('evento sem linha em branco no fim ainda é entregue', async () => {
  const events = await collect(['data: ultimo']);
  assert.deepEqual(events, [{ event: null, data: 'ultimo' }]);
});

test('evento só com comentário não é entregue', async () => {
  const events = await collect([': so comentario\n\n']);
  assert.deepEqual(events, []);
});

test('CRLF partido entre chunks não fecha o evento cedo demais', async () => {
  // O `\r` fica no fim do primeiro chunk; sem tratar, ele viraria uma linha
  // em branco falsa e o evento sairia truncado.
  const events = await collect(['data: oi\r', '\n\r\n']);
  assert.deepEqual(events, [{ event: null, data: 'oi' }]);
});

test('caractere UTF-8 partido entre chunks não vira U+FFFD', async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('data: ção\n\n');
  // Corta no meio do "ç" (2 bytes) para simular a rede entregando pela metade.
  const corte = 6; // "data: " + 1º byte do "ç"
  const chunks = [bytes.slice(0, corte), bytes.slice(corte)];

  const events = [];
  for await (const evt of parseSSE(streamOfRaw(chunks))) events.push(evt);

  assert.deepEqual(events, [{ event: null, data: 'ção' }]);
});

test('data: vazio é entregue como string vazia', async () => {
  const events = await collect(['data:\n\n']);
  assert.deepEqual(events, [{ event: null, data: '' }]);
});
