/**
 * Agzos Marca-texto — parte pura (sem Monaco/DOM, testada em test/unit/highlight-tags.test.js).
 *
 * Marcadores vêm das Configurações como "marcador=#cor" (ex.: "TODO=#FF9800").
 * parseTags(list) → [{ tag, color, strike }]  (o marcador "//" é sempre riscado)
 * findTaggedComments(text, languageId, tags) → [{ startLine, startColumn, endLine, endColumn, tag, color, strike }]
 *   Posições do Monaco (1-based, endColumn exclusivo). Reconhece //, #, --, /* *\/ e <!-- -->
 *   conforme a linguagem, ignorando aberturas dentro de strings.
 */

export const DEFAULT_TAGS = ['!=#FF5252', '?=#4FC3F7', 'TODO=#FF9800', 'FIXME=#FF9800', '*=#98C379', '//=#7A7A7A'];

const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const STRIKE_TAG = '//';

export function parseTags(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    const at = raw.lastIndexOf('=');
    if (at <= 0) continue;
    const tag = raw.slice(0, at).trim();
    const color = raw.slice(at + 1).trim();
    if (!tag || tag.length > 20 || /\s/.test(tag) || !COLOR_RE.test(color)) continue;
    out.push({ tag, color, strike: tag === STRIKE_TAG });
  }
  return out;
}

const C_LIKE = { line: ['//'], block: [['/*', '*/']], quotes: ['"', "'", '`'] };
const HASH = { line: ['#'], hashNeedsSpace: true, block: [], quotes: ['"', "'"] };
const MARKUP = { line: [], block: [['<!--', '-->']], quotes: [] };
const SYNTAX = {
  javascript: C_LIKE, typescript: C_LIKE, java: C_LIKE, c: C_LIKE, cpp: C_LIKE, csharp: C_LIKE,
  go: C_LIKE, rust: C_LIKE, kotlin: C_LIKE, swift: C_LIKE, dart: C_LIKE, scss: C_LIKE, less: C_LIKE,
  json: C_LIKE, php: { ...C_LIKE, line: ['//', '#'], hashNeedsSpace: true },
  css: { line: [], block: [['/*', '*/']], quotes: ['"', "'"] },
  python: { ...HASH, triple: true }, shell: HASH, ruby: HASH, yaml: HASH, perl: HASH, r: HASH,
  dockerfile: HASH, powershell: HASH, ini: { ...HASH, line: ['#', ';'] }, makefile: HASH,
  sql: { line: ['--'], block: [['/*', '*/']], quotes: ["'", '"'] }, lua: { line: ['--'], block: [], quotes: ["'", '"'] },
  html: MARKUP, xml: MARKUP, markdown: MARKUP,
};

const isWordChar = (ch) => ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);

/** Marcador no início de `content` (já sem espaços à esquerda) ou null. */
function matchTag(content, tags) {
  for (const t of tags) {
    const head = content.slice(0, t.tag.length);
    const wordTag = isWordChar(t.tag[t.tag.length - 1]);
    if (wordTag ? head.toLowerCase() !== t.tag.toLowerCase() : head !== t.tag) continue;
    if (wordTag && isWordChar(content[t.tag.length])) continue;
    return t;
  }
  return null;
}

function lineStartsOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function toPos(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

export function findTaggedComments(text, languageId, tagList) {
  const syntax = SYNTAX[languageId];
  const tags = parseTags(tagList).sort((a, b) => b.tag.length - a.tag.length);
  const src = String(text || '');
  if (!syntax || !tags.length || !src) return [];
  const starts = lineStartsOf(src);
  const found = []; // [startOffset, endOffset, tag]

  const trimEnd = (end) => (end > 0 && src[end - 1] === '\r' ? end - 1 : end);

  const onLine = (start, end, openLen) => {
    const tag = matchTag(src.slice(start + openLen, end).trimStart(), tags);
    if (tag) found.push([start, trimEnd(end), tag]);
  };

  const onBlock = (start, end, open, closed, closeLen) => {
    const innerStart = start + open.length;
    const innerEnd = closed ? end - closeLen : end;
    let inner = src.slice(innerStart, innerEnd);
    // "/**" (JSDoc): o segundo * faz parte da abertura.
    let firstLine = inner.split('\n')[0];
    if (open === '/*' && firstLine.startsWith('*')) firstLine = firstLine.slice(1);
    const head = matchTag(firstLine.trimStart(), tags);
    if (head) {
      found.push([start, end, head]);
      return;
    }
    // Linhas internas: "  * ! texto" → do marcador até o fim da linha.
    let offset = innerStart + inner.indexOf('\n') + 1;
    if (inner.indexOf('\n') === -1) return;
    inner = src.slice(offset, innerEnd);
    for (const line of inner.split('\n')) {
      const lead = line.match(/^\s*(?:\*\s*)?/)[0].length;
      const tag = matchTag(line.slice(lead), tags);
      if (tag) found.push([offset + lead, trimEnd(offset + line.length), tag]);
      offset += line.length + 1;
    }
  };

  let i = 0;
  const n = src.length;
  outer: while (i < n) {
    const ch = src[i];
    for (const [open, close] of syntax.block) {
      if (src.startsWith(open, i)) {
        const at = src.indexOf(close, i + open.length);
        const end = at === -1 ? n : at + close.length;
        onBlock(i, end, open, at !== -1, close.length);
        i = end;
        continue outer;
      }
    }
    for (const op of syntax.line) {
      if (!src.startsWith(op, i)) continue;
      if (op === '#' && syntax.hashNeedsSpace && i > 0 && !/\s/.test(src[i - 1])) continue;
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? n : nl;
      onLine(i, end, op.length);
      i = end;
      continue outer;
    }
    if (syntax.quotes.includes(ch)) {
      const triple = syntax.triple && src.startsWith(ch.repeat(3), i) ? ch.repeat(3) : null;
      let j = i + (triple ? 3 : 1);
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (triple ? src.startsWith(triple, j) : src[j] === ch) { j += triple ? 3 : 1; break; }
        if (!triple && ch !== '`' && src[j] === '\n') break;
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }

  return found.map(([s, e, tag]) => {
    const a = toPos(starts, s);
    const b = toPos(starts, e);
    return { startLine: a.line, startColumn: a.column, endLine: b.line, endColumn: b.column, tag: tag.tag, color: tag.color, strike: tag.strike };
  });
}
