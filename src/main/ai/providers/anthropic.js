const { parseSSE } = require('../sse');
const { friendlyError, request } = require('../errors');

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
  async function testConnection() {
    try { return { ok: true, models: (await listModels()).length }; }
    catch (err) { return { ok: false, error: friendlyError(err, baseUrl, apiKey).message }; }
  }
  return { listModels, chat, testConnection };
}
module.exports = { createAnthropicProvider };
