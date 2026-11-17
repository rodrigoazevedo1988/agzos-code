/**
 * Comparação de um `.env*` com o `.env.example` (ou `.sample`/`.template`).
 * Trabalha só com chaves; nunca expõe valores.
 */

const path = require('node:path');

const EXAMPLE_NAMES = ['.env.example', '.env.sample', '.env.template'];

/** `{ missing, extra, empty }`: missing = no example e não no arquivo; extra = o inverso. */
function compareEnv(exampleEntries, entries) {
  const exampleKeys = new Set((exampleEntries || []).map((e) => e.key));
  const keys = new Set((entries || []).map((e) => e.key));
  const missing = [...exampleKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !exampleKeys.has(k));
  const emptySet = new Set();
  // Última ocorrência vence (como no dotenv).
  const last = new Map();
  for (const e of entries || []) last.set(e.key, e.value);
  for (const [k, v] of last) if (v === '') emptySet.add(k);
  return { missing, extra, empty: [...emptySet] };
}

/** Escolhe o arquivo de exemplo pela prioridade `.env.example` > `.env.sample` > `.env.template`. */
function findExampleFile(files) {
  for (const name of EXAMPLE_NAMES) {
    const hit = (files || []).find((f) => path.basename(f) === name);
    if (hit) return hit;
  }
  return null;
}

function isExampleFile(file) {
  return EXAMPLE_NAMES.includes(path.basename(file));
}

module.exports = { compareEnv, findExampleFile, isExampleFile, EXAMPLE_NAMES };
