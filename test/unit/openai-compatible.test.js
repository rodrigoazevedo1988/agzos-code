const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAICompatibleProvider } = require('../../src/main/ai/providers/openai-compatible');
const { toUserError } = require('../../src/main/ai/errors');
const baseUrl = 'https://example.test/v1';
const collect = async (iterable) => { const values = []; for await (const value of iterable) values.push(value); return values; };
const response = (body, status = 200) => new Response(body, { status });

test('listModels ordena ids e sem chave não envia Authorization', async () => {
  const provider = createOpenAICompatibleProvider({ baseUrl, fetchImpl: async (url, opts) => {
    assert.equal(url, `${baseUrl}/models`); assert.equal(opts.headers.Authorization, undefined);
    return response(JSON.stringify({ data: [{ id: 'z' }, { id: 'a' }] }));
  } });
  assert.deepEqual(await provider.listModels(), ['a', 'z']);
});
test('chat produz deltas na ordem e para em DONE', async () => {
  const provider = createOpenAICompatibleProvider({ baseUrl, apiKey: 'key', extraHeaders: { 'X-Title': 'Agzos Code' }, fetchImpl: async (url, opts) => {
    assert.equal(url, `${baseUrl}/chat/completions`); assert.equal(opts.headers.Authorization, 'Bearer key');
    assert.deepEqual(JSON.parse(opts.body), { model: 'm', messages: [], stream: true });
    return response('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"c"}}]}\n\n');
  } });
  assert.deepEqual(await collect(provider.chat({ model: 'm', messages: [] })), ['a', 'b']);
});
test('401 amigável e erro de rede', async () => {
  const unauthorized = createOpenAICompatibleProvider({ baseUrl, fetchImpl: async () => response('{}', 401) });
  assert.deepEqual(await unauthorized.testConnection(), { ok: false, error: 'Chave inválida ou sem permissão (401)' });
  const offline = createOpenAICompatibleProvider({ baseUrl, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await offline.testConnection(), { ok: false, error: `Não foi possível conectar a ${baseUrl}` });
});
test('abort interrompe o gerador', async () => {
  const controller = new AbortController(); controller.abort();
  const provider = createOpenAICompatibleProvider({ baseUrl, fetchImpl: async (url, opts) => { opts.signal.throwIfAborted(); } });
  await assert.rejects(collect(provider.chat({ model: 'm', messages: [], signal: controller.signal })), /Interrompido/);
});
test('mensagem de erro nunca contém a chave', async () => {
  const apiKey = 'sk-SEGREDO';
  const provider = createOpenAICompatibleProvider({ baseUrl, apiKey, fetchImpl: async () => response(JSON.stringify({ error: { message: `erro ${apiKey}` } }), 500) });
  assert.equal((await provider.testConnection()).error.includes(apiKey), false);
  await assert.rejects(provider.listModels(), (err) => !err.message.includes(apiKey));
});
test('mapeia erros HTTP e limita mensagem', () => {
  assert.equal(toUserError({ status: 404 }, { baseUrl }), 'Endpoint ou modelo não encontrado (404)');
  assert.match(toUserError({ status: 429 }, { baseUrl }), /Limite de uso/);
  assert.equal(toUserError({ status: 500, message: 'x'.repeat(250) }, { baseUrl }).split(': ')[1].length, 200);
});

// Gemini (AI Studio, endpoint OpenAI-compatível) devolve o erro como array.
const geminiBusy = () => response(JSON.stringify([{ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }]), 503);

test('503 do Gemini mostra a mensagem do provider (corpo em array)', async () => {
  const { request } = require('../../src/main/ai/errors');
  await assert.rejects(
    request(async () => geminiBusy(), `${baseUrl}/x`, {}, { baseUrl, retryDelaysMs: [] }),
    (err) => /sobrecarregado/i.test(err.message) && /overloaded/.test(err.message) && err.status === 503,
  );
});

test('503/429 tentam de novo e seguem quando o provider volta', async () => {
  const { request } = require('../../src/main/ai/errors');
  let calls = 0;
  const res = await request(async () => (++calls < 3 ? geminiBusy() : response('ok')), `${baseUrl}/x`, {}, { baseUrl, retryDelaysMs: [1, 1] });
  assert.equal(calls, 3);
  assert.equal(res.status, 200);
});

test('400/401 não tentam de novo', async () => {
  const { request } = require('../../src/main/ai/errors');
  let calls = 0;
  await assert.rejects(request(async () => { calls++; return response('{}', 401); }, `${baseUrl}/x`, {}, { baseUrl, retryDelaysMs: [1, 1] }));
  assert.equal(calls, 1);
});

test('cancelar durante a espera do retry interrompe', async () => {
  const { request } = require('../../src/main/ai/errors');
  const controller = new AbortController();
  const p = request(async () => geminiBusy(), `${baseUrl}/x`, {}, { baseUrl, signal: controller.signal, retryDelaysMs: [5000] });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(p, /Interrompido/);
});
