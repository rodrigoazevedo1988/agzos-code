const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAnthropicProvider } = require('../../src/main/ai/providers/anthropic');
const baseUrl = 'https://anthropic.test/v1';
const collect = async (iterable) => { const values = []; for await (const value of iterable) values.push(value); return values; };

test('system vai para o campo system, produz delta, ignora ping e para', async () => {
  const provider = createAnthropicProvider({ baseUrl, apiKey: 'secret', fetchImpl: async (url, opts) => {
    assert.equal(url, `${baseUrl}/messages`);
    assert.equal(opts.headers['x-api-key'], 'secret');
    assert.equal(opts.headers['anthropic-version'], '2023-06-01');
    assert.deepEqual(JSON.parse(opts.body), { model: 'm', max_tokens: 8192, stream: true, system: 'primeiro\n\nsegundo', messages: [{ role: 'user', content: 'olá' }] });
    return new Response('event: ping\ndata: {}\n\nevent: content_block_delta\ndata: {"delta":{"text":"oi"}}\n\nevent: message_stop\ndata: {}\n\nevent: content_block_delta\ndata: {"delta":{"text":"ignorar"}}\n\n');
  } });
  const messages = [{ role: 'system', content: 'primeiro' }, { role: 'user', content: 'olá' }, { role: 'system', content: 'segundo' }];
  assert.deepEqual(await collect(provider.chat({ model: 'm', messages })), ['oi']);
});
test('401 amigável e lista modelos', async () => {
  const provider = createAnthropicProvider({ baseUrl, apiKey: 'secret', fetchImpl: async () => new Response('{}', { status: 401 }) });
  assert.deepEqual(await provider.testConnection(), { ok: false, error: 'Chave inválida ou sem permissão (401)' });
  const success = createAnthropicProvider({ baseUrl, apiKey: 'secret', fetchImpl: async () => new Response('{"data":[{"id":"z"},{"id":"a"}]}') });
  assert.deepEqual(await success.listModels(), ['z', 'a']);
});
