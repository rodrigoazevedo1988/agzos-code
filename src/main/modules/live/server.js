/**
 * Agzos Ao Vivo — servidor HTTP local com recarga automática (sem Electron).
 *
 * createLiveServer({ root, isAllowed, startPort = 5500, source = localSource }) →
 *   { start() → { port, url }, stop(), reload(changedPath?) → nº de navegadores avisados,
 *     clientCount(), host, root, port, url }
 *
 * Segurança:
 *  - escuta só em 127.0.0.1; Host precisa ser 127.0.0.1:<porta> ou localhost:<porta> (DNS rebinding);
 *  - só GET/HEAD; caminho com `..`, `%2e`, `%2f`, `%5c`, `%00`, `\` ou encoding inválido → 400/403;
 *  - o caminho real (symlinks resolvidos) precisa ficar dentro da raiz E ser liberado por
 *    `isAllowed` (guard da janela que iniciou); nomes ocultos (`.env`, `.git`…) → 404;
 *  - sem CORS (nenhum Access-Control-*), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
 * HTML recebe `<script src="/__agzos_live__/reload.js">` antes de `</body>`; o script ouve
 * `/__agzos_live__/events` (SSE) e recarrega a página em `data: reload`.
 *
 * Ponto de troca para pasta remota: `source` = { realpath(p), stat(p) → { isFile, isDirectory, size } | null,
 * readFile(p) → Buffer, createReadStream(p), readDir(p) → [{ name, isDirectory }] }.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const HOST = '127.0.0.1';
const PREFIX = '/__agzos_live__/';
const RELOAD_PATH = `${PREFIX}reload.js`;
const EVENTS_PATH = `${PREFIX}events`;
const PORT_TRIES = 100;
const KEEPALIVE_MS = 25_000;

const RELOAD_SCRIPT = `(() => {
  const es = new EventSource('${EVENTS_PATH}');
  es.onmessage = (e) => { if (e.data === 'reload') location.reload(); };
})();
`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf', '.wasm': 'application/wasm',
};

function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

const localSource = {
  realpath: (p) => fs.promises.realpath(p),
  async stat(p) {
    try {
      const st = await fs.promises.stat(p);
      return { isFile: st.isFile(), isDirectory: st.isDirectory(), size: st.size };
    } catch {
      return null;
    }
  },
  readFile: (p) => fs.promises.readFile(p),
  createReadStream: (p) => fs.createReadStream(p),
  async readDir(p) {
    const list = await fs.promises.readdir(p, { withFileTypes: true });
    return list.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
  },
};

/** Script de recarga antes do último </body>; sem </body>, no fim. */
function injectReload(html) {
  const tag = `<script src="${RELOAD_PATH}"></script>`;
  const idx = html.toLowerCase().lastIndexOf('</body>');
  return idx === -1 ? html + tag : html.slice(0, idx) + tag + html.slice(idx);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function within(root, target) {
  const r = root.replace(/[\\/]+$/, '');
  return target === r || target.startsWith(r + path.sep);
}

/** URL → segmentos decodificados, ou { status } quando recusado. */
function parseUrlPath(rawUrl) {
  const raw = String(rawUrl || '/').split(/[?#]/)[0];
  if (!raw.startsWith('/') || raw.includes('\\') || /%(?:2e|2f|5c|00)/i.test(raw)) return { status: 400 };
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return { status: 400 }; }
  if (decoded.includes('\0') || decoded.includes('\\')) return { status: 400 };
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s === '.')) return { status: 403 };
  return { segments, trailingSlash: decoded.endsWith('/') };
}

function createLiveServer({
  root, isAllowed = () => true, startPort = 5500, source = localSource,
} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Raiz inválida para o Agzos Ao Vivo');
  const clients = new Set();
  const sockets = new Set();
  let server = null;
  let port = null;
  let realRoot = null;
  let keepalive = null;

  const baseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

  function send(res, status, body = '', type = 'text/plain; charset=utf-8', extra = {}) {
    const buf = Buffer.from(body);
    res.writeHead(status, { ...baseHeaders, 'Content-Type': type, 'Content-Length': buf.length, ...extra });
    res.end(res.req.method === 'HEAD' ? undefined : buf);
  }

  function hostOk(req) {
    const h = String(req.headers.host || '').toLowerCase();
    return h === `${HOST}:${port}` || h === `localhost:${port}`;
  }

  function openEvents(req, res) {
    res.writeHead(200, { ...baseHeaders, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  async function serveDirectory(req, res, abs, urlPath) {
    const index = path.join(abs, 'index.html');
    const st = await source.stat(index);
    if (st?.isFile) return serveFile(req, res, index);
    const entries = (await source.readDir(abs))
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
    const items = entries.map((e) => {
      const href = encodeURIComponent(e.name) + (e.isDirectory ? '/' : '');
      return `<li><a href="${escapeHtml(href)}">${escapeHtml(e.name)}${e.isDirectory ? '/' : ''}</a></li>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title></head>`
      + `<body><h1>${escapeHtml(urlPath)}</h1><ul>${items}</ul></body></html>`;
    return send(res, 200, injectReload(html), MIME['.html']);
  }

  async function serveFile(req, res, abs) {
    const type = mimeFor(abs);
    if (type.startsWith('text/html')) {
      const html = injectReload((await source.readFile(abs)).toString('utf8'));
      return send(res, 200, html, type);
    }
    const st = await source.stat(abs);
    res.writeHead(200, { ...baseHeaders, 'Content-Type': type, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    const stream = source.createReadStream(abs);
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }

  async function handle(req, res) {
    if (!hostOk(req)) return send(res, 403, 'Host não permitido');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método não permitido', undefined, { Allow: 'GET, HEAD' });
    const url = String(req.url || '/').split(/[?#]/)[0];
    if (url === RELOAD_PATH) return send(res, 200, RELOAD_SCRIPT, MIME['.js']);
    if (url === EVENTS_PATH) return openEvents(req, res);

    const parsed = parseUrlPath(req.url);
    if (parsed.status) return send(res, parsed.status, parsed.status === 400 ? 'Pedido inválido' : 'Proibido');
    if (parsed.segments.some((s) => s.startsWith('.'))) return send(res, 404, 'Não encontrado');
    const abs = path.join(root, ...parsed.segments);
    let real;
    try { real = await source.realpath(abs); } catch { return send(res, 404, 'Não encontrado'); }
    if (!within(realRoot, real) || !isAllowed(real)) return send(res, 403, 'Proibido');
    const st = await source.stat(real);
    if (!st) return send(res, 404, 'Não encontrado');
    if (st.isDirectory) {
      if (!parsed.trailingSlash) {
        const location = `/${parsed.segments.map(encodeURIComponent).join('/')}/`;
        return send(res, 301, '', undefined, { Location: location });
      }
      return serveDirectory(req, res, real, `/${parsed.segments.join('/')}/`);
    }
    if (!st.isFile) return send(res, 404, 'Não encontrado');
    return serveFile(req, res, real);
  }

  function listen(p) {
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) send(res, 500, 'Erro interno');
          else res.destroy();
        });
      });
      s.on('connection', (sock) => {
        sockets.add(sock);
        sock.on('close', () => sockets.delete(sock));
      });
      s.once('error', reject);
      s.listen(p, HOST, () => {
        s.removeListener('error', reject);
        resolve(s);
      });
    });
  }

  const api = {
    host: HOST,
    root,
    get port() { return port; },
    get url() { return port ? `http://${HOST}:${port}/` : null; },
    clientCount: () => clients.size,

    async start() {
      if (server) return { port, url: api.url };
      realRoot = await source.realpath(root);
      const first = Number.isInteger(startPort) && startPort >= 1024 && startPort <= 65535 ? startPort : 5500;
      let lastErr = null;
      for (let p = first; p < Math.min(65536, first + PORT_TRIES); p++) {
        try {
          server = await listen(p);
          port = p;
          break;
        } catch (e) {
          lastErr = e;
          if (e.code !== 'EADDRINUSE' && e.code !== 'EACCES') throw e;
        }
      }
      if (!server) throw new Error(`Nenhuma porta livre a partir de ${first}${lastErr ? ` (${lastErr.code})` : ''}`);
      keepalive = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, KEEPALIVE_MS);
      keepalive.unref?.();
      return { port, url: api.url };
    },

    async stop() {
      clearInterval(keepalive);
      keepalive = null;
      for (const c of clients) c.end();
      clients.clear();
      const s = server;
      server = null;
      port = null;
      if (!s) return;
      await new Promise((resolve) => {
        s.close(() => resolve());
        for (const sock of sockets) sock.destroy();
      });
    },

    /** Avisa os navegadores; com caminho, só se ele estiver dentro da raiz servida. */
    reload(changedPath) {
      if (changedPath !== undefined) {
        if (typeof changedPath !== 'string' || !path.isAbsolute(changedPath)) return 0;
        const p = path.resolve(changedPath);
        if (!within(root, p) && !(realRoot && within(realRoot, p))) return 0;
      }
      for (const c of clients) c.write('data: reload\n\n');
      return clients.size;
    },
  };
  return api;
}

module.exports = {
  createLiveServer, injectReload, mimeFor, parseUrlPath, localSource, RELOAD_PATH, EVENTS_PATH, HOST,
};
