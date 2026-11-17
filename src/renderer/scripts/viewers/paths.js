/**
 * Caminhos dos visualizadores — módulo puro, testável em Node.
 * Precisa casar com src/main/lib/file-protocol.js (urlToPath).
 */

const isWinPath = (p) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');

// Host = token desta janela (preload: window.agzos.fileHost). O main só serve
// caminhos liberados no guard da janela dona do token (ver lib/window-guards.js).
function currentHost() {
  const h = globalThis.window?.agzos?.fileHost;
  return typeof h === 'string' && /^[0-9a-f]+$/.test(h) ? h : 'local';
}

/** URL agzos-file:// para um caminho absoluto. `version` (mtime) fura o cache. */
export function toFileUrl(absPath, version, host = currentHost()) {
  const p = String(absPath || '');
  const segments = isWinPath(p) ? p.split(/[\\/]/) : p.split('/').slice(1);
  const url = `agzos-file://${host}/` + segments.map(encodeURIComponent).join('/');
  return version != null ? `${url}?v=${encodeURIComponent(version)}` : url;
}

function normalize(parts) {
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (out.length > 1 || (out.length === 1 && !/^[a-zA-Z]:$/.test(out[0]))) out.pop(); continue; }
    out.push(part);
  }
  return out;
}

function joinAbs(base, rel, win) {
  const baseParts = base.split(/[\\/]/);
  const relParts = rel.split(win ? /[\\/]/ : /\//);
  const parts = normalize([...baseParts, ...relParts]);
  if (win) return parts.join('\\');
  return '/' + parts.join('/');
}

/**
 * Resolve o alvo de um link/imagem do Markdown para um caminho absoluto.
 * null para URLs externas (http, data:, mailto:…) e âncoras.
 * `/x` é relativo à raiz do workspace (como no GitHub), se informada.
 */
export function resolveMarkdownPath(mdFilePath, href, workspaceRoot) {
  if (!href || typeof href !== 'string') return null;
  const h = href.trim();
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(h) && !/^[a-zA-Z]:[\\/]/.test(h);
  if (!h || h.startsWith('#') || hasScheme) return null;
  if (h.startsWith('//')) return null;
  let clean = h.replace(/[?#].*$/, '');
  try { clean = decodeURIComponent(clean); } catch { /* mantém cru */ }
  const md = String(mdFilePath || '');
  const win = isWinPath(md);
  if (win && /^[a-zA-Z]:[\\/]/.test(clean)) return joinAbs('', clean, true);
  if (clean.startsWith('/') || (win && clean.startsWith('\\'))) {
    const root = workspaceRoot || (win ? md.slice(0, 2) : '');
    return joinAbs(root, clean, win);
  }
  const dir = md.replace(/[\\/][^\\/]*$/, '');
  return joinAbs(dir, clean, win);
}
