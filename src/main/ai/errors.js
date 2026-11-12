function toUserError(err, { baseUrl }) {
  if (err.userMessage) return err.userMessage;
  if (err.name === 'AbortError') return 'Interrompido';
  const status = err.status;
  if (status === 401 || status === 403) return `Chave inválida ou sem permissão (${status})`;
  if (status === 404) return 'Endpoint ou modelo não encontrado (404)';
  if (status === 429) return 'Limite de uso atingido (429). Tente de novo em instantes.';
  if (status) return `Erro do provider (${status}): ${String(err.message || '').slice(0, 200)}`;
  return `Não foi possível conectar a ${baseUrl}`;
}

function friendlyError(err, baseUrl, apiKey) {
  let message = toUserError(err, { baseUrl });
  if (apiKey) message = message.split(apiKey).join('[redigido]');
  const safe = new Error(message);
  safe.userMessage = message;
  return safe;
}

async function request(fetchImpl, url, options, { baseUrl, apiKey, signal } = {}) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15000);
  try {
    const signals = [timeout.signal];
    if (signal) signals.push(signal);
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.any(signals) });
    clearTimeout(timer);
    if (!response.ok) {
      let body;
      try { body = await response.json(); } catch { body = {}; }
      const error = new Error(body?.error?.message || body?.message || '');
      error.status = response.status;
      throw error;
    }
    return response;
  } catch (err) {
    const failure = timeout.signal.aborted && !signal?.aborted ? new Error('timeout') : err;
    throw friendlyError(failure, baseUrl, apiKey);
  } finally {
    clearTimeout(timer);
  }
}
module.exports = { toUserError, friendlyError, request };
