/**
 * Helpers puros da UI (sem DOM/window), testáveis em Node.
 */

/**
 * Converte o valor bruto de um input numérico. Retorna null se vazio ou
 * não-finito; caso contrário, limita a [min, max] quando definidos.
 */
export function clampNumber(raw, min, max) {
  if (raw == null) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  let out = n;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

/**
 * Quick Open: resultado assíncrono só pode ser renderizado se nenhuma busca
 * mais nova começou, o modo ainda é 'files' e o texto não mudou.
 */
export function isQuickOpenResultCurrent({ seq, currentSeq, mode, value, currentValue, visible = true }) {
  return visible && seq === currentSeq && mode === 'files' && value === currentValue;
}

/**
 * Quick Open: o que o Enter faz com o item ativo no modo atual.
 * 'run' só para comando (tem run()) em modo comandos; 'open' só para arquivo em modo arquivos.
 */
export function quickOpenEnterAction(mode, item) {
  if (!item) return null;
  if (mode === 'commands') return typeof item.run === 'function' && !item.path ? 'run' : null;
  if (mode === 'files') return typeof item.path === 'string' && item.path ? 'open' : null;
  return null;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * "Restaurar Todas": restaura só as chaves que o modal de settings controla
 * (as chaves de `defaults`). Objetos são mesclados com os padrões por cima,
 * preservando subchaves desconhecidas. Demais chaves (ai, github, welcomeSeen,
 * onboarding*, recentFolders…) ficam intactas.
 */
export function resetModalOwnedSettings(settings, defaults) {
  const out = { ...(settings || {}) };
  for (const [key, def] of Object.entries(defaults)) {
    if (isPlainObject(def)) {
      const current = isPlainObject(out[key]) ? out[key] : {};
      out[key] = { ...current, ...structuredClone(def) };
    } else {
      out[key] = structuredClone(def);
    }
  }
  return out;
}
