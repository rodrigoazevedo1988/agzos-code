const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createOpenAICompatibleProvider, parseOpenAIToolStream, toOpenAIMessages } = require('../../src/main/ai/providers/openai-compatible');
const { createAnthropicProvider, parseAnthropicToolStream, toAnthropicMessages } = require('../../src/main/ai/providers/anthropic');
const { startFakeOpenAI } = require('../e2e/fake-openai');

const collect = async (it) => { const out = []; for await (const v of it) out.push(v); return out; };
const sse = (lines) => new Response(lines.join('')).body;
const data = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const ev = (name, obj) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...obj })}\n\n`;
const TOOLS = [{ name: 'read_file', description: 'lê', parameters: { type: 'object', properties: { path: { type: 'string' } } } }];

test('OpenAI: texto + duas tool calls com argumentos partidos', async () => {
  const body = sse([
    data({ choices: [{ delta: { role: 'assistant', content: 'Vou ' } }] }),
    data({ choices: [{ delta: { content: 'ler.' } }] }),
    data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"pa' } }] } }] }),
    data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.js"}' } }] } }] }),
    data({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'list_dir', arguments: '' } }] } }] }),
    data({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"path":"."}' } }] } }] }),
    data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    'data: [DONE]\n\n',
  ]);
  assert.deepEqual(await collect(parseOpenAIToolStream(body)), [
    { type: 'text', delta: 'Vou ' },
    { type: 'text', delta: 'ler.' },
    { type: 'tool_call', id: 'call_a', name: 'read_file', input: { path: 'a.js' } },
    { type: 'tool_call', id: 'call_b', name: 'list_dir', input: { path: '.' } },
    { type: 'stop', reason: 'tool_calls' },
  ]);
});

test('OpenAI: argumentos como objeto (Ollama) e JSON inválido', async () => {
  const body = sse([
    data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'list_dir', arguments: { path: 'src' } } }] } }] }),
    data({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'y', function: { name: 'read_file', arguments: '{quebrado' } }] } }] }),
    'data: [DONE]\n\n',
  ]);
  const out = await collect(parseOpenAIToolStream(body));
  assert.deepEqual(out[0].input, { path: 'src' });
  assert.deepEqual(out[1].input, { __invalid: '{quebrado' });
  assert.deepEqual(out[2], { type: 'stop', reason: 'tool_calls' });
});

test('OpenAI: converte histórico neutro', () => {
  assert.deepEqual(toOpenAIMessages([
    { role: 'system', content: 's' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'a' } }] },
    { role: 'tool', toolCallId: 'c1', name: 'read_file', content: 'conteúdo' },
  ]), [
    { role: 'system', content: 's' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'conteúdo' },
  ]);
});

test('OpenAI chatTools: corpo com tools/tool_choice e 400 de tools → tools_unsupported', async () => {
  let sent;
  const ok = createOpenAICompatibleProvider({ baseUrl: 'http://x/v1', fetchImpl: async (_u, opts) => { sent = JSON.parse(opts.body); return new Response('data: [DONE]\n\n'); } });
  await collect(ok.chatTools({ model: 'm', messages: [{ role: 'user', content: 'oi' }], tools: TOOLS }));
  assert.equal(sent.tool_choice, 'auto');
  assert.equal(sent.stream, true);
  assert.deepEqual(sent.tools, [{ type: 'function', function: TOOLS[0] }]);
  const bad = createOpenAICompatibleProvider({ baseUrl: 'http://x/v1', apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'model does not support tools' } }), { status: 400 }) });
  await assert.rejects(collect(bad.chatTools({ model: 'm', messages: [], tools: TOOLS })), (err) => err.code === 'tools_unsupported' && err.status === 400);
  const other = createOpenAICompatibleProvider({ baseUrl: 'http://x/v1', fetchImpl: async () => new Response('{}', { status: 401 }) });
  await assert.rejects(collect(other.chatTools({ model: 'm', messages: [], tools: TOOLS })), (err) => err.code !== 'tools_unsupported');
});

test('OpenAI chat de texto continua sem tools no corpo', async () => {
  let sent;
  const p = createOpenAICompatibleProvider({ baseUrl: 'http://x/v1', fetchImpl: async (_u, opts) => { sent = JSON.parse(opts.body); return new Response('data: [DONE]\n\n'); } });
  await collect(p.chat({ model: 'm', messages: [] }));
  assert.deepEqual(sent, { model: 'm', messages: [], stream: true });
});

test('Anthropic: texto + tool_use com input_json_delta', async () => {
  const body = sse([
    ev('message_start', { message: { id: 'm' } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Lendo' } }),
    ev('content_block_stop', { index: 0 }),
    ev('ping', {}),
    ev('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} } }),
    ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
    ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '"a.js"}' } }),
    ev('content_block_stop', { index: 1 }),
    ev('content_block_start', { index: 2, content_block: { type: 'tool_use', id: 'toolu_2', name: 'list_dir', input: {} } }),
    ev('content_block_stop', { index: 2 }),
    ev('message_delta', { delta: { stop_reason: 'tool_use' } }),
    ev('message_stop', {}),
  ]);
  assert.deepEqual(await collect(parseAnthropicToolStream(body)), [
    { type: 'text', delta: 'Lendo' },
    { type: 'tool_call', id: 'toolu_1', name: 'read_file', input: { path: 'a.js' } },
    { type: 'tool_call', id: 'toolu_2', name: 'list_dir', input: {} },
    { type: 'stop', reason: 'tool_use' },
  ]);
});

test('Anthropic: evento error no stream lança', async () => {
  const body = sse([ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } })]);
  await assert.rejects(collect(parseAnthropicToolStream(body)), /Overloaded/);
});

test('Anthropic: converte histórico (tool_result agrupado num user)', () => {
  assert.deepEqual(toAnthropicMessages([
    { role: 'system', content: 's' },
    { role: 'user', content: 'faça' },
    { role: 'assistant', content: 'ok', toolCalls: [{ id: 't1', name: 'a', input: {} }, { id: 't2', name: 'b', input: { x: 1 } }] },
    { role: 'tool', toolCallId: 't1', content: 'r1' },
    { role: 'tool', toolCallId: 't2', content: 'r2', isError: true },
  ]), {
    system: 's',
    messages: [
      { role: 'user', content: 'faça' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 't1', name: 'a', input: {} }, { type: 'tool_use', id: 't2', name: 'b', input: { x: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'r1' }, { type: 'tool_result', tool_use_id: 't2', content: 'r2', is_error: true }] },
    ],
  });
});

test('fake-openai roteirizado: OpenAI e Anthropic emitem as mesmas tool calls', async () => {
  const script = [
    { text: 'Criando.', toolCalls: [{ name: 'write_file', arguments: { path: 'a.txt', content: 'oi' } }] },
    { text: 'Pronto.' },
  ];
  const fake = await startFakeOpenAI({ script, delayMs: 1 });
  try {
    const openai = createOpenAICompatibleProvider({ baseUrl: `${fake.baseUrl}/v1` });
    const first = await collect(openai.chatTools({ model: 'fake-1', messages: [{ role: 'user', content: 'x' }], tools: TOOLS }));
    assert.equal(first.filter((e) => e.type === 'text').map((e) => e.delta).join(''), 'Criando.');
    assert.deepEqual(first.find((e) => e.type === 'tool_call'), { type: 'tool_call', id: 'call_0_0', name: 'write_file', input: { path: 'a.txt', content: 'oi' } });
    // chat normal (sem tools) não consome o roteiro
    assert.equal((await collect(openai.chat({ model: 'fake-1', messages: [] }))).join(''), 'Olá do fake');
    const second = await collect(openai.chatTools({ model: 'fake-1', messages: [], tools: TOOLS }));
    assert.deepEqual(second.at(-1), { type: 'stop', reason: 'stop' });
    assert.equal(fake.turns(), 2);

    fake.setScript(script);
    const anthropic = createAnthropicProvider({ baseUrl: `${fake.baseUrl}/v1`, apiKey: 'k' });
    const a1 = await collect(anthropic.chatTools({ model: 'c', messages: [{ role: 'user', content: 'x' }], tools: TOOLS }));
    assert.deepEqual(a1.find((e) => e.type === 'tool_call'), { type: 'tool_call', id: 'toolu_0_0', name: 'write_file', input: { path: 'a.txt', content: 'oi' } });
    assert.deepEqual(a1.at(-1), { type: 'stop', reason: 'tool_use' });
    assert.ok(Array.isArray(fake.requests.at(-1).body.tools));
  } finally { await fake.close(); }
});

test('fake-openai toolsStatus → tools_unsupported', async () => {
  const fake = await startFakeOpenAI({ toolsStatus: 400 });
  try {
    const openai = createOpenAICompatibleProvider({ baseUrl: `${fake.baseUrl}/v1` });
    await assert.rejects(collect(openai.chatTools({ model: 'm', messages: [], tools: TOOLS })), (err) => err.code === 'tools_unsupported');
  } finally { await fake.close(); }
});
