/**
 * Filtro de links externos: `shell.openExternal` só para https:, http: e mailto:.
 * Outros esquemas (file:, smb:, javascript:, protocolos de apps…) são negados e logados
 * só com esquema + host (sem credenciais, caminho ou query). Sem dependência do Electron.
 */

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function parse(url) {
  if (typeof url !== 'string' || !url) return null;
  try { return new URL(url); } catch { return null; }
}

function isSafeExternalUrl(url) {
  const u = parse(url);
  return !!u && ALLOWED_PROTOCOLS.has(u.protocol);
}

/** Esquema + host, nunca usuário/senha, caminho ou query. */
function describeUrlForLog(url) {
  const u = parse(url);
  if (!u) return '(URL inválida)';
  return `${u.protocol}//${u.host || ''}`;
}

/** Abre no navegador/cliente do SO se o esquema for permitido. → true se abriu. */
function openExternalSafe(shell, url, { log = console.warn } = {}) {
  if (!isSafeExternalUrl(url)) {
    try { log(`[seguranca] link externo negado: ${describeUrlForLog(url)}`); } catch { /* log opcional */ }
    return false;
  }
  Promise.resolve(shell.openExternal(url)).catch(() => {});
  return true;
}

module.exports = { isSafeExternalUrl, describeUrlForLog, openExternalSafe, ALLOWED_PROTOCOLS };
