const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeContent, contentText, toOpenAIContent, toAnthropicContent, markVisionUnsupported,
} = require('../../src/main/ai/content');
const { createOpenAICompatibleProvider, toOpenAIMessages } = require('../../src/main/ai/providers/openai-compatible');
const { createAnthropicProvider, toAnthropicMessages } = require('../../src/main/ai/providers/anthropic');

const PNG = 'iVBORw0KGgo=';
const withImage = [{ type: 'text', text: 'O que tem aqui?' }, { type: 'image', mediaType: 'image/png', data: PNG }];
const collect = async (it) => { const out = []; for await (const v of it) out.push(v); return out; };

test('normalizeContent: string passa, partes inválidas caem, só texto vira string', () => {
  assert.equal(normalizeContent('oi'), 'oi');
  assert.equal(normalizeContent([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\n\nb');
  assert.deepEqual(normalizeContent([...withImage, { type: 'image', mediaType: 'image/tiff', data: 'x' }, null]), withImage);
  assert.equal(contentText(withImage), 'O que tem aqui?');
});

test('fixture OpenAI: imagem vira image_url com data URL', () => {
  assert.deepEqual(toOpenAIContent(withImage), [
    { type: 'text', text: 'O que tem aqui?' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
  ]);
  const msgs = toOpenAIMessages([{ role: 'user', content: withImage }]);
  assert.equal(msgs[0].content[1].type, 'image_url');
});

test('fixture Anthropic: imagem vira bloco base64', () => {
  assert.deepEqual(toAnthropicContent(withImage), [
    { type: 'text', text: 'O que tem aqui?' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
  ]);
  const { messages } = toAnthropicMessages([{ role: 'system', content: 'S' }, { role: 'user', content: withImage }]);
  assert.equal(messages[0].content[1].type, 'image');
});

test('Anthropic: mensagem do usuário depois de tool_result entra no mesmo turno', () => {
  const { messages } = toAnthropicMessages([
    { role: 'user', content: 'faça' },
    { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'list_dir', input: {} }] },
    { role: 'tool', toolCallId: 't1', name: 'list_dir', content: 'a.js' },
    { role: 'user', content: 'e também o b' },
  ]);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[2].content.map((b) => b.type), ['tool_result', 'text']);
  assert.equal(messages[2].content[1].text, 'e também o b');
});

test('chat de texto OpenAI envia imagem no corpo', async () => {
  let body;
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', fetchImpl: async (_url, opts) => {
    body = JSON.parse(opts.body);
    return new Response('data: [DONE]\n\n');
  } });
  await collect(provider.chat({ model: 'm', messages: [{ role: 'user', content: withImage }] }));
  assert.equal(body.messages[0].content[1].image_url.url, `data:image/png;base64,${PNG}`);
});

test('chat Anthropic envia bloco de imagem', async () => {
  let body;
  const provider = createAnthropicProvider({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetchImpl: async (_url, opts) => {
    body = JSON.parse(opts.body);
    return new Response('event: message_stop\ndata: {}\n\n');
  } });
  await collect(provider.chat({ model: 'm', messages: [{ role: 'user', content: withImage }] }));
  assert.equal(body.messages[0].content[1].source.media_type, 'image/png');
});

test('modelo sem visão: erro claro com code vision_unsupported', async () => {
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://x.test/v1', fetchImpl: async () => new Response(
    JSON.stringify({ error: { message: 'Invalid content type. image_url is only supported by certain models.' } }), { status: 400 },
  ) });
  await assert.rejects(collect(provider.chat({ model: 'm', messages: [{ role: 'user', content: withImage }] })), (err) => {
    assert.equal(err.code, 'vision_unsupported');
    assert.match(err.userMessage, /não aceita imagens/);
    return true;
  });
  const plain = markVisionUnsupported(Object.assign(new Error('image bad'), { status: 400 }), { hadImages: false });
  assert.equal(plain.code, undefined);
});
