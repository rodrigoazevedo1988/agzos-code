/**
 * Parser dotenv que preserva posição (Cofre .env).
 *
 * - `export KEY=v`, aspas simples/duplas/crase, multilinha entre aspas, `#` comentário.
 * - Sem aspas, `#` só abre comentário quando vem depois de espaço (`KEY=a#b` → `a#b`).
 * - Aspas duplas interpretam `\n`, `\r`, `\t`, `\"` e `\\`; simples e crase são literais.
 * - `setEntry`/`removeEntry` editam só as linhas da chave; o resto do texto fica byte a byte.
 *
 * Valores nunca são logados aqui (nem em mensagens de erro).
 */

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const HEAD_RE = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=/;
const QUOTES = new Set(['"', "'", '`']);

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function lineEnd(text, pos) {
  const nl = text.indexOf('\n', pos);
  return nl === -1 ? text.length : nl;
}

/** Fim da linha sem o `\r` final. */
function contentEnd(text, pos) {
  const e = lineEnd(text, pos);
  return e > pos && text[e - 1] === '\r' ? e - 1 : e;
}

function findClosing(text, from, q) {
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (q === '"' && c === '\\') { i++; continue; }
    if (c === q) return i;
  }
  return -1;
}

function unescapeDouble(raw) {
  const map = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };
  return raw.replace(/\\([\s\S])/g, (m, c) => (c in map ? map[c] : m));
}

/**
 * Varredura interna: entradas com offsets.
 * start = início da linha da chave; end = fim (sem quebra) da última linha da entrada;
 * head = texto até o `=` (inclusive); gap = espaços antes do valor; suffix = depois do valor.
 */
function scan(text) {
  const entries = [];
  let pos = 0;
  let lineNo = 1;
  while (pos <= text.length) {
    const ce = contentEnd(text, pos);
    const le = lineEnd(text, pos);
    const lineText = text.slice(pos, ce);
    const m = HEAD_RE.exec(lineText);
    let nextPos = le + 1;
    let linesUsed = 1;
    if (m) {
      const head = m[0];
      const rest = lineText.slice(head.length);
      const gap = /^[ \t]*/.exec(rest)[0];
      const after = rest.slice(gap.length);
      let entry = null;
      if (after && QUOTES.has(after[0])) {
        const q = after[0];
        const openAbs = pos + head.length + gap.length;
        const close = findClosing(text, openAbs + 1, q);
        if (close !== -1) {
          let raw = text.slice(openAbs + 1, close);
          const end = contentEnd(text, close);
          const extraLines = (raw.match(/\n/g) || []).length;
          raw = raw.replace(/\r\n/g, '\n');
          entry = {
            value: q === '"' ? unescapeDouble(raw) : raw,
            quoted: q,
            end,
            suffix: text.slice(close + 1, end),
          };
          linesUsed = 1 + extraLines;
          nextPos = lineEnd(text, close) + 1;
        }
      }
      if (!entry) {
        let before = rest;
        let comment = '';
        const hash = /\s#/.exec(rest);
        if (hash) {
          before = rest.slice(0, hash.index);
          comment = rest.slice(hash.index);
        }
        const value = before.trim();
        const g = /^\s*/.exec(before)[0];
        entry = {
          value,
          quoted: false,
          end: ce,
          suffix: before.slice(g.length + value.length) + comment,
          gapOverride: g,
        };
      }
      entries.push({
        key: m[3],
        value: entry.value,
        line: lineNo,
        quoted: entry.quoted,
        exported: Boolean(m[2]),
        start: pos,
        end: entry.end,
        head,
        gap: entry.gapOverride !== undefined ? entry.gapOverride : gap,
        suffix: entry.suffix,
      });
    }
    lineNo += linesUsed;
    if (le >= text.length) break;
    pos = nextPos;
  }
  return entries;
}

/** `{ entries: [{ key, value, line, quoted, exported }], eol }` */
function parseEnv(text) {
  const src = String(text ?? '');
  return {
    entries: scan(src).map(({ key, value, line, quoted, exported }) => ({ key, value, line, quoted, exported })),
    eol: detectEol(src),
  };
}

function escapeDouble(v) {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function formatValue(value, prevQuote = false) {
  const v = String(value ?? '');
  if (prevQuote === "'" && !/['\r\n]/.test(v)) return `'${v}'`;
  if (prevQuote === '`' && !/[`\r\n]/.test(v)) return `\`${v}\``;
  const needs = /[\s#"'`]/.test(v) || prevQuote === '"';
  if (!needs) return v;
  return `"${escapeDouble(v)}"`;
}

function assertKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new Error('Chave inválida (use letras, números, _ . -)');
}

/** Define `key=value`: altera só a(s) linha(s) da chave ou acrescenta no fim. */
function setEntry(text, key, value) {
  assertKey(key);
  const src = String(text ?? '');
  const all = scan(src).filter((e) => e.key === key);
  if (all.length) {
    const e = all[all.length - 1];
    const line = `${e.head}${e.gap}${formatValue(value, e.quoted)}${e.suffix}`;
    return src.slice(0, e.start) + line + src.slice(e.end);
  }
  const eol = detectEol(src);
  const sep = src && !src.endsWith('\n') ? eol : '';
  return `${src}${sep}${key}=${formatValue(value)}${eol}`;
}

/** Remove todas as ocorrências de `key` (com a quebra de linha). */
function removeEntry(text, key) {
  let src = String(text ?? '');
  const all = scan(src).filter((e) => e.key === key);
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i];
    let cut = e.end;
    if (src[cut] === '\r' && src[cut + 1] === '\n') cut += 2;
    else if (src[cut] === '\n') cut += 1;
    src = src.slice(0, e.start) + src.slice(cut);
  }
  return src;
}

module.exports = { parseEnv, setEntry, removeEntry, formatValue, isValidKey: (k) => typeof k === 'string' && KEY_RE.test(k), _scan: scan };
