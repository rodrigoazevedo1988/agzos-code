/**
 * Funções puras dos Snippets no renderer (testadas em test/unit/snippets-utils.test.js).
 *
 * buildPreviewDoc: documento do srcdoc das miniaturas/prévia. O iframe é `sandbox="allow-scripts"`
 * SEM allow-same-origin (origem opaca: nada alcança o app) e a CSP do documento só deixa rodar o
 * script com o nonce (o Tailwind embutido): script e handlers do snippet não rodam, nada é
 * carregado da rede (default-src 'none'), formulários não enviam e não há <base>.
 * O corpo já chega sanitizado (DOMPurify) — a CSP é a segunda barreira.
 */

const NONCE_RE = /^[A-Za-z0-9_-]{16,}$/;
const SAFE_COLOR_RE = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\))$/;

export function makeNonce() {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildPreviewDoc({ body = '', tailwind = '', nonce, background = '' } = {}) {
  if (typeof nonce !== 'string' || !NONCE_RE.test(nonce)) throw new Error('buildPreviewDoc: nonce inválido');
  const bg = typeof background === 'string' && SAFE_COLOR_RE.test(background.trim()) ? background.trim() : 'transparent';
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${nonce}'`,
    'img-src data:',
    'font-src data:',
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  // `</script` no Tailwind já vem escapado pelo main (snippets:tailwind).
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + `<style>html,body{margin:0}body{min-height:100vh;display:flex;flex-direction:column;justify-content:safe center;background:${bg}}body>*{width:100%;box-sizing:border-box;margin-left:auto;margin-right:auto}</style>`
    + `<script nonce="${nonce}">${tailwind}</script>`
    + `</head><body>${body}</body></html>`;
}

/** Indenta da 2ª linha em diante (inserção no meio de um bloco já indentado). */
export function indentFollowingLines(text, indent) {
  if (!indent) return text;
  return String(text).replace(/(\r?\n)([^\r\n])/g, `$1${indent}$2`);
}

export function isJsxPath(p) {
  return typeof p === 'string' && /\.(jsx|tsx)$/i.test(p);
}

/** Linguagem de um snippet criado a partir de um arquivo. */
export function snippetLanguageForPath(p) {
  if (typeof p !== 'string') return 'html';
  if (/\.(css|scss|sass|less)$/i.test(p)) return 'css';
  if (isJsxPath(p)) return 'jsx';
  return 'html';
}

export function isPreviewable(language) {
  return language === 'html' || language === 'tailwind';
}
