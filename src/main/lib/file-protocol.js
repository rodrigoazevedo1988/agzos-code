/**
 * Protocolo agzos-file:// — serve arquivos locais ao renderer (imagens, vídeo,
 * áudio, PDF) só quando o caminho está liberado no path-guard do workspace.
 *
 * Formato: agzos-file://local/<caminho absoluto, cada segmento com encodeURIComponent>
 *   POSIX:   agzos-file://local/home/u/a%20b.png
 *   Windows: agzos-file://local/C%3A/Users/u/a.png
 * A query (?v=mtime) é ignorada (só serve para furar cache).
 *
 * Várias janelas: o host é o token da janela (lib/window-guards.js, entregue só a
 * ela pelo preload) e o handler usa o guard daquela janela (guardForHost). Token
 * desconhecido ou de outra janela → 403. `guard` + host `local` = modo antigo (testes).
 *
 * Arquivo remoto (pasta SSH, 1.2.0): agzos-file://<token>/~ssh/<authority codificada>/<caminho>
 * → URI ssh://<authority>/<caminho>; o guard da janela confere e o conteúdo vem por
 * stream SFTP com Range (providerForHost(host, uri) → provider SSH da janela).
 *
 * Sem dependência do Electron: o handler recebe { url, method, headers } e
 * devolve um Response (global do Node 18+/Electron).
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { isRemote, parseRemoteUri, toRemoteUri } = require('../workspace/remote-uri');

const REMOTE_PREFIX = '/~ssh/';

const SCHEME = 'agzos-file';
const HOST = 'local';

const MIME = {
  png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  ico: 'image/x-icon', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac',
  m4a: 'audio/mp4', aac: 'audio/aac', opus: 'audio/ogg', weba: 'audio/webm',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8',
};

function mimeForPath(p) {
  const base = String(p || '').split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return 'application/octet-stream';
  return MIME[base.slice(dot + 1).toLowerCase()] || 'application/octet-stream';
}

/** { host, path } da URL, ou null se não é válida. */
function parseFileUrl(url, platform = process.platform) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${SCHEME}:` || !u.hostname) return null;
  const p = pathFromUrl(u, platform);
  return p ? { host: u.hostname, path: p } : null;
}

/** Caminho absoluto do arquivo pedido (host `local`), ou null se a URL não é válida. */
function urlToPath(url, platform = process.platform) {
  const parsed = parseFileUrl(url, platform);
  return parsed && parsed.host === HOST ? parsed.path : null;
}

function pathFromUrl(u, platform) {
  let decoded;
  try { decoded = decodeURIComponent(u.pathname); } catch { return null; }
  if (!decoded || decoded.includes('\0')) return null;
  if (decoded.startsWith(REMOTE_PREFIX)) {
    const r = parseRemoteUri(`ssh://${decoded.slice(REMOTE_PREFIX.length)}`);
    return r ? toRemoteUri(r.authority, r.path) : null;
  }
  if (platform === 'win32') {
    const win = decoded.replace(/^\/+/, '').replace(/\//g, '\\');
    if (!/^[a-zA-Z]:\\/.test(win) && !win.startsWith('\\\\')) return null;
    return path.win32.normalize(win);
  }
  return path.posix.normalize(decoded);
}

/**
 * Interpreta o header Range (um único intervalo de bytes).
 * null = sem range (ou formato ignorado); 'invalid' = 416.
 */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null;
  const [, a, b] = m;
  let start;
  let end;
  if (a === '' && b === '') return 'invalid';
  if (a === '') {
    const n = Number(b);
    if (n <= 0) return 'invalid';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}

const text = (status, body) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

function createFileProtocolHandler({ guard: fallbackGuard, guardForHost, providerForHost, platform = process.platform, fsImpl = fs }) {
  return async function handle(request) {
    const parsed = parseFileUrl(request.url, platform);
    if (!parsed) return text(400, 'URL inválida');
    const filePath = parsed.path;
    const guard = typeof guardForHost === 'function'
      ? guardForHost(parsed.host)
      : (parsed.host === HOST ? fallbackGuard : null);
    if (!guard) return text(403, 'Acesso negado');
    let real;
    try {
      if (!guard.isAllowed(filePath)) return text(403, 'Acesso negado');
      real = guard.assertAllowed(filePath);
    } catch {
      return text(403, 'Acesso negado');
    }
    let remote = null;
    if (isRemote(real)) {
      try { remote = typeof providerForHost === 'function' ? providerForHost(parsed.host, real) : null; } catch { remote = null; }
      if (!remote) return text(403, 'Acesso negado');
    }
    let stat;
    try {
      if (remote) {
        const st = await remote.stat(real);
        stat = { size: st.size, isFile: () => !!st.isFile };
      } else {
        stat = await fsImpl.promises.stat(real);
      }
    } catch { return text(404, 'Não encontrado'); }
    if (!stat.isFile()) return text(404, 'Não encontrado');

    const size = stat.size;
    const headers = {
      'content-type': mimeForPath(real),
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    };
    const range = parseRange(request.headers?.get?.('range'), size);
    if (range === 'invalid') {
      return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
    }
    const method = String(request.method || 'GET').toUpperCase();
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const length = size === 0 ? 0 : end - start + 1;
    headers['content-length'] = String(length);
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    const status = range ? 206 : 200;
    if (method === 'HEAD' || length === 0) return new Response(null, { status, headers });
    const source = remote ? await remote.createReadStream(real, { start, end }) : fsImpl.createReadStream(real, { start, end });
    const stream = Readable.toWeb(source);
    return new Response(stream, { status, headers });
  };
}

module.exports = { SCHEME, HOST, urlToPath, parseFileUrl, mimeForPath, parseRange, createFileProtocolHandler };
