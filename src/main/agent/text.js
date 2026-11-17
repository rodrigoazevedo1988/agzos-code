/**
 * Utilitários de texto do agente: contagem de linhas alteradas, truncamento,
 * remoção de ANSI e redação de segredos.
 */

function splitLines(text) {
  if (text == null || text === '') return [];
  const lines = String(text).split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Linhas adicionadas/removidas entre dois textos (null = inexistente). */
function lineStats(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (!midA.length || !midB.length || midA.length * midB.length > 4_000_000) {
    return { added: midB.length, removed: midA.length };
  }
  // LCS (O(n*m) com duas linhas de memória).
  let prev = new Uint32Array(midB.length + 1);
  let cur = new Uint32Array(midB.length + 1);
  for (let i = 1; i <= midA.length; i++) {
    for (let j = 1; j <= midB.length; j++) {
      cur[j] = midA[i - 1] === midB[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  const common = prev[midB.length];
  return { added: midB.length - common, removed: midA.length - common };
}

/** Mantém início + fim quando o texto passa de `max` caracteres. */
function truncateMiddle(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  const omitted = s.length - head - tail;
  return `${s.slice(0, head)}\n\n[... ${omitted} caracteres omitidos ...]\n\n${s.slice(s.length - tail)}`;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
function stripAnsi(text) {
  return String(text ?? '').replace(ANSI, '');
}

const SECRET_NAME = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL/i;

/** Valores de variáveis com nome sensível (≥ 8 chars), para redigir saídas. */
function secretValues(env = {}, extra = []) {
  const values = [];
  for (const [name, value] of Object.entries(env)) {
    if (SECRET_NAME.test(name) && typeof value === 'string' && value.length >= 8) values.push(value);
  }
  for (const value of extra) if (typeof value === 'string' && value.length >= 8) values.push(value);
  return values.sort((x, y) => y.length - x.length);
}

function redact(text, secrets) {
  let out = String(text ?? '');
  for (const secret of secrets || []) out = out.split(secret).join('[redigido]');
  return out;
}

module.exports = { splitLines, lineStats, truncateMiddle, stripAnsi, secretValues, redact, SECRET_NAME };
