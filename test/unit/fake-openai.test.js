const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startFakeOpenAI } = require('../e2e/fake-openai');
const { createOpenAICompatibleProvider } = require('../../src/main/ai/providers/openai-compatible');

test('provider recebe a resposta SSE do servidor falso em ordem', async () => {
  const fake = await startFakeOpenAI();
  try {
    const provider = createOpenAICompatibleProvider({ baseUrl: `${fake.baseUrl}/v1` });
    const chunks = [];
    for await (const chunk of provider.chat({ model: 'fake-1', messages: [] })) chunks.push(chunk);

    assert.equal(chunks.join(''), 'Olá do fake');
    assert.deepEqual(fake.requests.map(({ path }) => path), ['/v1/chat/completions']);
    assert.deepEqual(fake.requests[0].body, { model: 'fake-1', messages: [], stream: true });
  } finally {
    await fake.close();
  }
});

test('servidor falso retorna modelos compatíveis', async () => {
  const fake = await startFakeOpenAI();
  try {
    const provider = createOpenAICompatibleProvider({ baseUrl: `${fake.baseUrl}/v1` });
    assert.deepEqual(await provider.listModels(), ['fake-1', 'fake-2']);
    assert.equal(fake.requests[0].path, '/v1/models');
  } finally {
    await fake.close();
  }
});

test('servidor falso retorna o status HTTP configurado', async () => {
  const fake = await startFakeOpenAI({ status: 401 });
  try {
    const provider = createOpenAICompatibleProvider({ baseUrl: `${fake.baseUrl}/v1` });
    assert.deepEqual(await provider.testConnection(), {
      ok: false,
      error: 'Chave inválida ou sem permissão (401)'
    });
  } finally {
    await fake.close();
  }
});
