/**
 * HTML → JSX para inserir snippets em arquivos .jsx/.tsx.
 *
 * Tokenizador simples (não é um parser HTML completo, nem precisa: os snippets são
 * marcação estática): `class`→`className`, `for`→`htmlFor`, atributos com hífen/minúsculos
 * conhecidos em camelCase (SVG e formulário), `style="a: b"` → `style={{ a: 'b' }}`,
 * tags vazias fechadas (`<br />`), comentários → `{/* … *\/}`, `{ } <` soltos no texto escapados.
 * Espaços e quebras de linha são preservados.
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const ATTR_MAP = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  readonly: 'readOnly',
  maxlength: 'maxLength',
  minlength: 'minLength',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  autoplay: 'autoPlay',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  crossorigin: 'crossOrigin',
  enctype: 'encType',
  novalidate: 'noValidate',
  inputmode: 'inputMode',
  contenteditable: 'contentEditable',
  spellcheck: 'spellCheck',
  srcset: 'srcSet',
  datetime: 'dateTime',
  'accept-charset': 'acceptCharset',
  'http-equiv': 'httpEquiv',
  'xlink:href': 'xlinkHref',
  'xml:space': 'xmlSpace',
  'xmlns:xlink': 'xmlnsXlink',
};

/** Atributos SVG com hífen que o React espera em camelCase. */
const SVG_HYPHEN = /^(stroke|fill|stop|font|text|clip|color|dominant|flood|lighting|marker|paint|pointer|shape|vector|word|letter|alignment|baseline|enable|glyph|image|overline|strikethrough|underline|unicode|writing)-/;

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function jsxAttrName(name) {
  const lower = name.toLowerCase();
  if (Object.hasOwn(ATTR_MAP, lower)) return ATTR_MAP[lower];
  if (lower.startsWith('aria-') || lower.startsWith('data-')) return name;
  if (/^on[a-z]+$/.test(lower)) return `on${lower[2].toUpperCase()}${lower.slice(3)}`;
  if (SVG_HYPHEN.test(lower)) return camel(lower);
  return name;
}

const jsString = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function styleToObject(css) {
  const parts = [];
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i === -1) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!prop) continue;
    const key = prop.startsWith('--') ? jsString(prop) : camel(prop.toLowerCase());
    parts.push(`${key}: ${jsString(value)}`);
  }
  return `{{ ${parts.join(', ')} }}`;
}

const unquote = (v) => v.replace(/"/g, '&quot;');

/** Converte o miolo de uma tag de abertura (`div class="x"`), devolve texto JSX. */
function convertOpenTag(inner) {
  let i = 0;
  const n = inner.length;
  const nameMatch = /^[A-Za-z][\w:.-]*/.exec(inner);
  const tag = nameMatch[0];
  i = tag.length;
  let out = `<${tag}`;
  let selfClosing = false;
  while (i < n) {
    const ws = /^\s*/.exec(inner.slice(i))[0];
    i += ws.length;
    if (i >= n) break;
    if (inner[i] === '/') { selfClosing = true; i++; continue; }
    const m = /^[^\s=/>]+/.exec(inner.slice(i));
    if (!m) { i++; continue; }
    const name = m[0];
    i += name.length;
    let value = null;
    const eq = /^\s*=\s*/.exec(inner.slice(i));
    if (eq) {
      i += eq[0].length;
      const q = inner[i];
      if (q === '"' || q === "'") {
        const end = inner.indexOf(q, i + 1);
        const stop = end === -1 ? n : end;
        value = inner.slice(i + 1, stop);
        i = stop + 1;
      } else {
        const u = /^[^\s>]*/.exec(inner.slice(i))[0];
        value = u;
        i += u.length;
      }
    }
    const jsxName = jsxAttrName(name);
    if (value === null) out += ` ${jsxName}`;
    else if (name.toLowerCase() === 'style') out += ` style=${styleToObject(value)}`;
    else out += ` ${jsxName}="${unquote(value)}"`;
  }
  if (selfClosing || VOID_TAGS.has(tag.toLowerCase())) out += ' />';
  else out += '>';
  return out;
}

/** Fim de uma tag começando em `start` (índice do `<`), respeitando aspas. -1 se não fecha. */
function tagEnd(html, start) {
  let quote = null;
  for (let i = start + 1; i < html.length; i++) {
    const c = html[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return -1;
}

function escapeText(text) {
  return text.replace(/[{}<]/g, (c) => `{'${c}'}`);
}

function htmlToJsx(html) {
  const src = String(html ?? '');
  let out = '';
  let text = '';
  const flush = () => { out += escapeText(text); text = ''; };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c !== '<') { text += c; i++; continue; }
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const body = src.slice(i + 4, end === -1 ? src.length : end);
      flush();
      out += `{/*${body.replace(/\*\//g, '* /')}*/}`;
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    const next = src[i + 1] || '';
    const isClose = next === '/' && /[A-Za-z]/.test(src[i + 2] || '');
    const isOpen = /[A-Za-z]/.test(next);
    const end = (isOpen || isClose) ? tagEnd(src, i) : -1;
    if (end === -1) { text += c; i++; continue; }
    flush();
    if (isClose) out += src.slice(i, end + 1).replace(/\s+>$/, '>');
    else out += convertOpenTag(src.slice(i + 1, end));
    i = end + 1;
  }
  flush();
  return out;
}

function isJsxPath(p) {
  return typeof p === 'string' && /\.(jsx|tsx)$/i.test(p);
}

module.exports = { htmlToJsx, isJsxPath };
