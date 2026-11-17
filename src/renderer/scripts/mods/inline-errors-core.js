/**
 * Agzos Erros na Linha — parte pura (sem Monaco/DOM, testada em test/unit/inline-errors.test.js).
 *
 * inlineErrorItems(markers, { severities, onlyCursorLine, cursorLine, maxLength })
 *   → [{ line, severity: 'error'|'warning'|'info', message, text }] (uma por linha, ordenado)
 * `message` é a mensagem inteira (hover); `text` é a versão de uma linha, truncada com "…".
 */

// MarkerSeverity do Monaco: Hint 1, Info 2, Warning 4, Error 8.
const SEVERITY_NAME = { 8: 'error', 4: 'warning', 2: 'info' };

export const DEFAULT_MAX_LENGTH = 120;

export function severityName(value) {
  return SEVERITY_NAME[value] || null;
}

/** Mensagem em uma linha (espaços colapsados), cortada em maxLength com reticências. */
export function oneLine(message, maxLength = DEFAULT_MAX_LENGTH) {
  const flat = String(message || '').replace(/\s+/g, ' ').trim();
  const max = Math.max(2, Number(maxLength) || DEFAULT_MAX_LENGTH);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function inlineErrorItems(markers, { severities = ['error', 'warning'], onlyCursorLine = false, cursorLine = null, maxLength = DEFAULT_MAX_LENGTH } = {}) {
  const allowed = new Set(Array.isArray(severities) ? severities : []);
  const byLine = new Map(); // linha → marcador mais grave (o primeiro em empate)
  for (const marker of Array.isArray(markers) ? markers : []) {
    const name = severityName(marker && marker.severity);
    if (!name || !allowed.has(name)) continue;
    const line = marker.startLineNumber;
    if (!Number.isInteger(line) || line < 1) continue;
    if (onlyCursorLine && line !== cursorLine) continue;
    const prev = byLine.get(line);
    if (!prev || marker.severity > prev.severity) byLine.set(line, marker);
  }
  return [...byLine.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([line, marker]) => ({
      line,
      severity: severityName(marker.severity),
      message: String(marker.message || ''),
      text: oneLine(marker.message, maxLength),
    }));
}
