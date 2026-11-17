function toUserError(err, { baseUrl }) {
  if (err.userMessage) return err.userMessage;
  if (err.name === 'AbortError') return 'Interrompido';
  const status = err.status;
  if (status === 401 || status === 403) return `Chave inválida ou sem permissão (${status})`;
  if (status === 404) return 'Endpoint ou modelo não encontrado (404)';
  const detail = String(err.message || '').slice(0, 200);
  if (status === 429) return `Limite de uso atingido (429). Tente de novo em instantes.${detail ? ` ${detail}` : ''}`;
  if (status === 503 || status === 502 || status === 504 || status === 529) {
    return `Provider sobrecarregado ou indisponível (${status}). Tente de novo em instantes ou troque de modelo.${detail ? ` ${detail}` : ''}`;
  }
  if (status) return `Erro do provider (${status}): ${detail}`;
  return `Não foi possível conectar a ${baseUrl}`;
}

function friendlyError(err, baseUrl, apiKey) {
  let message = toUserError(err, { baseUrl });
  if (apiKey) message = message.split(apiKey).join('[redigido]');
  const safe = new Error(message);
  safe.userMessage = message;
  if (err.status) safe.status = err.status;
  if (err.code) safe.code = err.code;
  if (err.retryAfterMs !== undefined) safe.retryAfterMs = err.retryAfterMs;
  return safe;
}

// Erros transitórios (sobrecarga/limite): tenta de novo antes de desistir.
const RETRY_STATUS = new Set([429, 502, 503, 504, 529]);
const DEFAULT_RETRY_DELAYS_MS = [1000, 2500];
const MAX_RETRY_AFTER_MS = 8000;

/** Mensagem do corpo de erro: OpenAI `{error:{message}}`, Gemini `[{error:{message}}]`, ou `{message}`. */
function errorMessageFromBody(body) {
  const item = Array.isArray(body) ? body[0] : body;
  return item?.error?.message || item?.message || '';
}

function waitMs(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('Interrompido'), { name: 'AbortError' })); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(Object.assign(new Error('Interrompido'), { name: 'AbortError' })); }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryAfterMs(response, fallback) {
  const raw = response.headers?.get?.('retry-after');
  const seconds = Number(raw);
  if (raw && Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return fallback;
}

async function request(fetchImpl, url, options, { baseUrl, apiKey, signal, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce(fetchImpl, url, options, { baseUrl, apiKey, signal });
    } catch (err) {
      const delay = retryDelaysMs[attempt];
      if (!RETRY_STATUS.has(err.status) || delay === undefined || signal?.aborted) throw err;
      try {
        await waitMs(err.retryAfterMs ?? delay, signal);
      } catch (abortErr) {
        throw friendlyError(abortErr, baseUrl, apiKey);
      }
    }
  }
}

async function requestOnce(fetchImpl, url, options, { baseUrl, apiKey, signal } = {}) {
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
      const error = new Error(errorMessageFromBody(body));
      error.status = response.status;
      if (RETRY_STATUS.has(response.status)) error.retryAfterMs = retryAfterMs(response, undefined);
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
