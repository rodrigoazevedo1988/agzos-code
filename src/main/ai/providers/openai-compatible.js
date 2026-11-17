const { parseSSE } = require('../sse');
const { friendlyError, request } = require('../errors');
const { markToolsUnsupported, parseToolInput } = require('../tool-calls');

/** Mensagens no formato neutro do agente → formato OpenAI. */
function toOpenAIMessages(messages) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: String(message.content ?? '') };
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id, type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.input ?? {}) },
        })),
      };
    }
    return { role: message.role, content: message.content };
  });
}

function toOpenAITools(tools) {
  return tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
}

/**
 * Interpreta o stream SSE de /chat/completions com tools. Acumula
 * delta.tool_calls por índice e emite cada chamada completa no fim.
 */
async function* parseOpenAIToolStream(body) {
  const calls = [];
  let reason = null;
  for await (const item of parseSSE(body)) {
    if (item.data === '[DONE]') break;
    let json;
    try { json = JSON.parse(item.data); } catch { continue; }
    if (json.error) {
      const error = new Error(json.error.message || 'erro no stream');
      error.status = json.error.code === 400 || json.error.status === 400 ? 400 : undefined;
      throw error;
    }
    const choice = json.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta || {};
    if (delta.content) yield { type: 'text', delta: delta.content };
    for (const part of delta.tool_calls || []) {
      const index = Number.isInteger(part.index) ? part.index : calls.length;
      const call = calls[index] || (calls[index] = { id: null, name: '', args: '' });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name += part.function.name;
      const args = part.function?.arguments;
      if (args && typeof args === 'object') call.args = args;
      else if (args) call.args += args;
    }
    if (choice.finish_reason) reason = choice.finish_reason;
  }
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (!call || !call.name) continue;
    const input = parseToolInput(call.args);
    yield { type: 'tool_call', id: call.id || `call_${i}`, name: call.name, input };
  }
  yield { type: 'stop', reason: reason || (calls.length ? 'tool_calls' : 'stop') };
}

function createOpenAICompatibleProvider({ baseUrl, apiKey, fetchImpl = fetch, extraHeaders = {} }) {
  const root = baseUrl.replace(/\/+$/, '');
  const headers = { 'content-type': 'application/json', ...extraHeaders };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  async function listModels() {
    try {
      const response = await request(fetchImpl, `${root}/models`, { headers }, { baseUrl, apiKey });
      const body = await response.json();
      return body.data.map((model) => model.id).sort();
    } catch (err) { throw friendlyError(err, baseUrl, apiKey); }
  }
  async function* chat({ model, messages, signal }) {
    try {
      const response = await request(fetchImpl, `${root}/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify({ model, messages, stream: true })
      }, { baseUrl, apiKey, signal });
      for await (const item of parseSSE(response.body)) {
        if (item.data === '[DONE]') break;
        const content = JSON.parse(item.data).choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    } catch (err) { throw friendlyError(err, baseUrl, apiKey); }
  }
  // Tool calling (agente). O chat de texto acima continua igual.
  async function* chatTools({ model, messages, tools, signal }) {
    try {
      const body = { model, messages: toOpenAIMessages(messages), stream: true, tools: toOpenAITools(tools), tool_choice: 'auto' };
      const response = await request(fetchImpl, `${root}/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify(body),
      }, { baseUrl, apiKey, signal });
      yield* parseOpenAIToolStream(response.body);
    } catch (err) { throw markToolsUnsupported(friendlyError(err, baseUrl, apiKey)); }
  }
  async function testConnection() {
    try { return { ok: true, models: (await listModels()).length }; }
    catch (err) { return { ok: false, error: friendlyError(err, baseUrl, apiKey).message }; }
  }
  return { listModels, chat, chatTools, testConnection };
}
module.exports = { createOpenAICompatibleProvider, parseOpenAIToolStream, toOpenAIMessages };
