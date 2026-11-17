/**
 * Utilitários de tool calling compartilhados pelos providers.
 *
 * Formato neutro usado pelo agente (src/main/agent):
 *   ferramenta: { name, description, parameters (JSON Schema) }
 *   mensagens:  { role: 'system'|'user'|'assistant', content }
 *               { role: 'assistant', content, toolCalls: [{ id, name, input }] }
 *               { role: 'tool', toolCallId, name, content }
 *   eventos de chatTools(): { type: 'text', delta } · { type: 'tool_call', id, name, input, raw? }
 *                           · { type: 'stop', reason }
 */

/** Modelo/endpoint sem suporte a tools → erro com code 'tools_unsupported'. */
function markToolsUnsupported(err) {
  const status = err?.status;
  const text = String(err?.message || err?.userMessage || '');
  if ((status === 400 || status === 404 || status === 422) && /tool|function/i.test(text)) {
    err.code = 'tools_unsupported';
  }
  return err;
}

/** Converte argumentos JSON (string ou objeto) em objeto; inválido → { __invalid: raw }. */
function parseToolInput(raw) {
  if (raw && typeof raw === 'object') return raw;
  const text = String(raw ?? '').trim();
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : { __invalid: text };
  } catch {
    return { __invalid: text };
  }
}

module.exports = { markToolsUnsupported, parseToolInput };
