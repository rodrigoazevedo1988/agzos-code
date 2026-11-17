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
  // Pasta remota: agzos-file://<token>/~ssh/<authority>/<caminho> (main: lib/file-protocol.js).
  if (p.startsWith('ssh://')) {
    const rest = p.slice(6);
    const i = rest.indexOf('/');
    const authority = i === -1 ? rest : rest.slice(0, i);
    const segs = (i === -1 ? '' : rest.slice(i + 1)).split('/');
    const url = `agzos-file://${host}/~ssh/${encodeURIComponent(authority)}/` + segs.map(encodeURIComponent).join('/');
    return version != null ? `${url}?v=${encodeURIComponent(version)}` : url;
  }
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
  if (md.startsWith('ssh://')) {
    // Pasta remota: resolve só a parte POSIX e devolve com o mesmo ssh://authority.
    const authOf = (u) => { const r = u.slice(6); const i = r.indexOf('/'); return i === -1 ? [r, '/'] : [r.slice(0, i), r.slice(i)]; };
    const [authority, mdPath] = authOf(md);
    const rootPath = String(workspaceRoot || '').startsWith('ssh://') ? authOf(workspaceRoot)[1] : '';
    const base = clean.startsWith('/') ? rootPath : mdPath.replace(/\/[^/]*$/, '');
    return `ssh://${authority}${joinAbs(base, clean, false)}`;
  }
  const win = isWinPath(md);
  if (win && /^[a-zA-Z]:[\\/]/.test(clean)) return joinAbs('', clean, true);
  if (clean.startsWith('/') || (win && clean.startsWith('\\'))) {
    const root = workspaceRoot || (win ? md.slice(0, 2) : '');
    return joinAbs(root, clean, win);
  }
  const dir = md.replace(/[\\/][^\\/]*$/, '');
  return joinAbs(dir, clean, win);
}
