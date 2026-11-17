/**
 * Aplica as edições da Vassoura sobre o texto original (função pura).
 *
 * Edit = { start, end, keepStart?, keepEnd? }: remove [start, end), exceto o trecho
 * [keepStart, keepEnd) quando presente (ex.: `if (false) {…} else {…}` mantém o else).
 * Edições sobrepostas: fica a de maior intervalo; as demais são ignoradas.
 */

/** Trechos efetivamente removidos por uma edição. */
function pieces(edit) {
  const { start, end, keepStart, keepEnd } = edit;
  if (Number.isInteger(keepStart) && Number.isInteger(keepEnd) && keepStart >= start && keepEnd <= end && keepStart <= keepEnd) {
    return [[start, keepStart], [keepEnd, end]].filter(([s, e]) => e > s);
  }
  return end > start ? [[start, end]] : [];
}

const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

function applyEdits(text, edits) {
  const valid = (Array.isArray(edits) ? edits : []).filter((e) => e
    && Number.isInteger(e.start) && Number.isInteger(e.end)
    && e.start >= 0 && e.end <= text.length && e.start <= e.end);
  // Maior intervalo primeiro; descarta quem sobrepõe algo já aceito.
  const bySize = [...valid].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  for (const edit of bySize) {
    const own = pieces(edit);
    if (own.some((p) => accepted.some((q) => overlaps(p, q)))) continue;
    accepted.push(...own);
  }
  accepted.sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [s, e] of accepted) out = out.slice(0, s) + out.slice(e);
  return out;
}

module.exports = { applyEdits, pieces };
