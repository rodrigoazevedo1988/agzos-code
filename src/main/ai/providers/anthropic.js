const { parseSSE } = require('../sse');
const { friendlyError, request } = require('../errors');
const { markToolsUnsupported, parseToolInput } = require('../tool-calls');

/** Mensagens no formato neutro do agente → { system, messages } da Anthropic. */
function toAnthropicMessages(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const out = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: message.toolCallId, content: String(message.content ?? '') };
      if (message.isError) block.is_error = true;
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      const content = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls) content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input ?? {} });
      out.push({ role: 'assistant', content });
      continue;
    }
    out.push({ role: message.role, content: message.content });
  }
  return { system, messages: out };
}

/** Interpreta o stream SSE de /messages com tool_use (input_json_delta). */
async function* parseAnthropicToolStream(body) {
  const blocks = new Map();
  let reason = null;
  for await (const item of parseSSE(body)) {
    let json;
    try { json = JSON.parse(item.data); } catch { json = {}; }
    const type = item.event || json.type;
    if (type === 'error') {
      const error = new Error(json.error?.message || 'erro no stream');
      if (json.error?.type === 'invalid_request_error') error.status = 400;
      throw error;
    }
    if (type === 'message_stop') break;
    if (type === 'content_block_start') {
      const block = json.content_block || {};
      if (block.type === 'tool_use') blocks.set(json.index, { id: block.id, name: block.name, json: '' });
    } else if (type === 'content_block_delta') {
      const delta = json.delta || {};
      if (delta.type === 'input_json_delta') {
        const block = blocks.get(json.index);
        if (block) block.json += delta.partial_json || '';
      } else if (delta.text) {
        yield { type: 'text', delta: delta.text };
      }
    } else if (type === 'content_block_stop') {
      const block = blocks.get(json.index);
      if (block) {
        blocks.delete(json.index);
        yield { type: 'tool_call', id: block.id, name: block.name, input: parseToolInput(block.json) };
      }
    } else if (type === 'message_delta') {
      if (json.delta?.stop_reason) reason = json.delta.stop_reason;
    }
  }
  yield { type: 'stop', reason: reason || 'end_turn' };
}

function createAnthropicProvider({ baseUrl, apiKey, fetchImpl = fetch }) {
  const root = baseUrl.replace(/\/+$/, '');
  const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  async function listModels() {
    try {
      const response = await request(fetchImpl, `${root}/models`, { headers }, { baseUrl, apiKey });
      return (await response.json()).data.map((model) => model.id);
    } catch (err) { throw friendlyError(err, baseUrl, apiKey); }
  }
  async function* chat({ model, messages, signal }) {
    try {
      const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
      const body = { model, max_tokens: 8192, stream: true, system, messages: messages.filter((message) => message.role !== 'system') };
      const response = await request(fetchImpl, `${root}/messages`, { method: 'POST', headers, body: JSON.stringify(body) }, { baseUrl, apiKey, signal });
      for await (const item of parseSSE(response.body)) {
        if (item.event === 'message_stop') break;
        if (item.event !== 'content_block_delta') continue;
        const text = JSON.parse(item.data).delta?.text;
        if (text) yield text;
      }
    } catch (err) { throw friendlyError(err, baseUrl, apiKey); }
  }
  // Tool calling (agente). O chat de texto acima continua igual.
  async function* chatTools({ model, messages, tools, signal }) {
    try {
      const converted = toAnthropicMessages(messages);
      const body = {
        model, max_tokens: 8192, stream: true, system: converted.system, messages: converted.messages,
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
      };
      const response = await request(fetchImpl, `${root}/messages`, { method: 'POST', headers, body: JSON.stringify(body) }, { baseUrl, apiKey, signal });
      yield* parseAnthropicToolStream(response.body);
    } catch (err) { throw markToolsUnsupported(friendlyError(err, baseUrl, apiKey)); }
  }
  async function testConnection() {
    try { return { ok: true, models: (await listModels()).length }; }
    catch (err) { return { ok: false, error: friendlyError(err, baseUrl, apiKey).message }; }
  }
  return { listModels, chat, chatTools, testConnection };
}
module.exports = { createAnthropicProvider, parseAnthropicToolStream, toAnthropicMessages };
