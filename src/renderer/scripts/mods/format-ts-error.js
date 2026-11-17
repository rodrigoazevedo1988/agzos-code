/**
 * Agzos Erros Claros — parte pura (sem Monaco/DOM, testada em test/unit/format-ts-error.test.js).
 *
 * formatTsMessage(text) → { blocks: [{ indent, parts: [{ type: 'text'|'type', text, multiline? }] }] }
 *   Uma linha da mensagem do TypeScript por bloco (indent = nível na cadeia de mensagens).
 *   Trechos entre aspas simples ('string', '{ a: number; }') viram partes 'type';
 *   tipos longos são quebrados e indentados (multiline: true).
 * prettyType(src, { minLength }) → tipo com objetos quebrados em linhas.
 * tsErrorCode(code) → { label: 'TS2322', url } | null
 * tsErrorMarkdown(message, code) → markdown para o hover do Monaco.
 */

const DOCS_URL = 'https://typescript.tv/errors/#ts';
const MULTILINE_MIN = 40;

const isWord = (ch) => ch !== undefined && /[\w$]/.test(ch);

/** Quebra objetos de tipo em linhas: "{ a: x; b: { c: y; }; }" → linhas indentadas. */
export function prettyType(src, { minLength = MULTILINE_MIN } = {}) {
  const text = String(src || '');
  if (text.length < minLength || !text.includes('{')) return text;
  let out = '';
  let depth = 0;
  let quote = null;
  const nl = () => `\n${'  '.repeat(Math.max(0, depth))}`;
  const skipSpaces = (i) => {
    let j = i;
    while (j + 1 < text.length && text[j + 1] === ' ') j++;
    return j;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) out += text[++i];
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
    } else if (ch === '{') {
      const j = skipSpaces(i);
      if (text[j + 1] === '}') {
        out += '{}';
        i = j + 1;
        continue;
      }
      depth++;
      out += `{${nl()}`;
      i = j;
    } else if (ch === '}') {
      out = out.replace(/\s+$/, '');
      depth--;
      out += `${nl()}}`;
    } else if (ch === ';' && depth > 0) {
      out += ';';
      i = skipSpaces(i);
      if (text[i + 1] !== '}') out += nl();
    } else {
      out += ch;
    }
  }
  return out;
}

/** Divide uma linha em texto e trechos entre aspas simples. */
function splitLine(line) {
  const parts = [];
  let buf = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" && !isWord(line[i - 1])) {
      // Fecha na próxima aspa que não esteja colada numa palavra à direita.
      let j = i + 1;
      while (j < line.length && !(line[j] === "'" && !isWord(line[j + 1]))) j++;
      if (j < line.length && j > i + 1) {
        if (buf) parts.push({ type: 'text', text: buf });
        buf = '';
        const raw = line.slice(i + 1, j);
        const pretty = prettyType(raw);
        parts.push(pretty.includes('\n') ? { type: 'type', text: pretty, multiline: true } : { type: 'type', text: raw });
        i = j + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  if (buf) parts.push({ type: 'text', text: buf });
  return parts;
}

export function formatTsMessage(text) {
  const blocks = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const lead = raw.match(/^\s*/)[0].replace(/\t/g, '  ').length;
    blocks.push({ indent: Math.floor(lead / 2), parts: splitLine(raw.trim()) });
  }
  return { blocks };
}

export function tsErrorCode(code) {
  const value = code && typeof code === 'object' ? code.value : code;
  const digits = String(value ?? '').trim();
  if (!/^\d{3,5}$/.test(digits)) return null;
  return { label: `TS${digits}`, url: `${DOCS_URL}${digits}` };
}

function escapeMarkdown(text) {
  return String(text).replace(/[\\`*_[\]<>|~]/g, '\\$&').replace(/^([#+-])/, '\\$1');
}

function inlineCode(text) {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

export function tsErrorMarkdown(message, code) {
  const out = [];
  const ref = tsErrorCode(code);
  if (ref) out.push(`[${ref.label}](${ref.url})`);
  for (const block of formatTsMessage(message).blocks) {
    const prefix = block.indent > 0 ? `${'\u2003'.repeat(block.indent - 1)}↳ ` : '';
    let line = prefix;
    for (const part of block.parts) {
      if (part.type === 'type' && part.multiline) {
        if (line.trim()) out.push(line);
        out.push(`\`\`\`typescript\n${part.text}\n\`\`\``);
        line = '';
      } else if (part.type === 'type') {
        line += inlineCode(part.text);
      } else {
        line += escapeMarkdown(part.text);
      }
    }
    if (line.trim()) out.push(line);
  }
  return out.join('\n\n');
}
