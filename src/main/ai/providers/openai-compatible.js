const { parseSSE } = require('../sse');
const { friendlyError, request } = require('../errors');

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
  async function testConnection() {
    try { return { ok: true, models: (await listModels()).length }; }
    catch (err) { return { ok: false, error: friendlyError(err, baseUrl, apiKey).message }; }
  }
  return { listModels, chat, testConnection };
}
module.exports = { createOpenAICompatibleProvider };
