/**
 * Poda do histórico local (pura, sem I/O).
 *
 * planPrune(files, { maxPerFile, maxDays, maxTotalBytes, now }) → [{ key, id }] a apagar.
 *   files = [{ key, entries: [{ id, ts, size }] }]
 * Ordem: por arquivo (mantém as `maxPerFile` mais recentes), idade (> maxDays) e,
 * por fim, o total de todos os arquivos (apaga as mais antigas até caber).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function planPrune(files, { maxPerFile, maxDays, maxTotalBytes, now }) {
  const out = [];
  const kept = [];
  const minTs = now - maxDays * DAY_MS;
  for (const file of files || []) {
    const sorted = [...(file.entries || [])].sort((a, b) => b.ts - a.ts);
    sorted.forEach((e, i) => {
      if (i >= maxPerFile || e.ts < minTs) out.push({ key: file.key, id: e.id });
      else kept.push({ key: file.key, ...e });
    });
  }
  let total = kept.reduce((sum, e) => sum + (e.size || 0), 0);
  kept.sort((a, b) => a.ts - b.ts);
  for (const e of kept) {
    if (total <= maxTotalBytes) break;
    out.push({ key: e.key, id: e.id });
    total -= e.size || 0;
  }
  return out;
}

module.exports = { planPrune, DAY_MS };
