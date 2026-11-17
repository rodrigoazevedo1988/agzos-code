const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { createLiveServer, injectReload, mimeFor, RELOAD_PATH } = require('../../src/main/modules/live/server');
const { createPathGuard } = require('../../src/main/lib/path-guard');

const basePort = () => 20000 + Math.floor(Math.random() * 20000);

function mkSite() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-live-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-live-out-')));
  fs.writeFileSync(path.join(root, 'index.html'), '<html><body><h1>Oi</h1></body></html>');
  fs.mkdirSync(path.join(root, 'css'));
  fs.writeFileSync(path.join(root, 'css', 'app.css'), 'body{color:red}');
  fs.writeFileSync(path.join(root, 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, 'página com espaço.html'), '<p>acentos</p>');
  fs.writeFileSync(path.join(root, '.env'), 'SEGREDO=1');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'fora');
  try { fs.symlinkSync(outside, path.join(root, 'link-fora')); } catch { /* sem symlink */ }
  const guard = createPathGuard();
  guard.allow(root);
  return {
    root, outside, guard,
    cleanup: () => [root, outside].forEach((d) => fs.rmSync(d, { recursive: true, force: true })),
  };
}

function get(port, p, { host = `127.0.0.1:${port}`, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: host } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(fn, opts = {}) {
  const site = mkSite();
  const server = createLiveServer({ root: site.root, isAllowed: (p) => site.guard.isAllowed(p), startPort: basePort(), ...opts });
  try {
    const info = await server.start();
    await fn({ ...site, server, port: info.port, info });
  } finally {
    await server.stop();
    site.cleanup();
  }
}

test('injectReload insere o script antes de </body> (ou no fim)', () => {
  const tag = `<script src="${RELOAD_PATH}"></script>`;
  assert.equal(injectReload('<html><body>x</body></html>'), `<html><body>x${tag}</body></html>`);
  assert.equal(injectReload('<BODY>a</BODY><BODY>b</BODY>'), `<BODY>a</BODY><BODY>b${tag}</BODY>`);
  assert.equal(injectReload('<p>sem body</p>'), `<p>sem body</p>${tag}`);
});

test('mimeFor cobre os tipos comuns', () => {
  assert.equal(mimeFor('a.html'), 'text/html; charset=utf-8');
  assert.equal(mimeFor('a.CSS'), 'text/css; charset=utf-8');
  assert.equal(mimeFor('a.js'), 'text/javascript; charset=utf-8');
  assert.equal(mimeFor('a.svg'), 'image/svg+xml');
  assert.equal(mimeFor('a.png'), 'image/png');
  assert.equal(mimeFor('a.woff2'), 'font/woff2');
  assert.equal(mimeFor('a.xyz'), 'application/octet-stream');
});

test('escuta só em 127.0.0.1 com porta ≥ inicial e serve index.html com recarga injetada', async () => {
  await withServer(async ({ server, port, info }) => {
    assert.equal(server.host, '127.0.0.1');
    assert.equal(info.url, `http://127.0.0.1:${port}/`);
    const r = await get(port, '/');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
    assert.ok(r.body.includes(`<script src="${RELOAD_PATH}"></script></body>`));
    assert.equal(Number(r.headers['content-length']), Buffer.byteLength(r.body));
    assert.equal(r.headers['cache-control'], 'no-store');
    const css = await get(port, '/css/app.css');
    assert.equal(css.status, 200);
    assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
    assert.equal(css.body, 'body{color:red}');
    const acc = await get(port, `/${encodeURIComponent('página com espaço.html')}`);
    assert.equal(acc.status, 200);
    assert.ok(acc.body.startsWith('<p>acentos</p>'));
    const head = await get(port, '/app.js', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    const script = await get(port, RELOAD_PATH);
    assert.equal(script.status, 200);
    assert.match(script.body, /EventSource/);
  });
});

test('caminhos com .., encoding suspeito, ocultos e symlink para fora são negados', async () => {
  await withServer(async ({ port, root }) => {
    for (const p of ['/../secret.txt', '/css/../../x', '/%2e%2e/secret.txt', '/%2E%2e%2fx', '/css%2fapp.css', '/a%5c..%5cb', '/%00', '/%E0%A4%A']) {
      const r = await get(port, p);
      assert.ok([400, 403].includes(r.status), `${p} → ${r.status}`);
    }
    assert.equal((await get(port, '/.env')).status, 404);
    if (fs.existsSync(path.join(root, 'link-fora'))) {
      assert.equal((await get(port, '/link-fora/secret.txt')).status, 403);
    }
    assert.equal((await get(port, '/nao-existe.html')).status, 404);
  });
});

test('Host diferente de 127.0.0.1/localhost é recusado (DNS rebinding); só GET/HEAD', async () => {
  await withServer(async ({ port }) => {
    assert.equal((await get(port, '/', { host: 'evil.example:80' })).status, 403);
    assert.equal((await get(port, '/', { host: `localhost:${port}` })).status, 200);
    assert.equal((await get(port, '/', { method: 'POST' })).status, 405);
  });
});

test('fora do guard da janela (revogado) → 403', async () => {
  await withServer(async ({ port, guard, root }) => {
    guard.revoke(root);
    assert.equal((await get(port, '/index.html')).status, 403);
  });
});

test('pasta sem barra redireciona; pasta sem index lista os arquivos', async () => {
  await withServer(async ({ port }) => {
    const r = await get(port, '/css');
    assert.equal(r.status, 301);
    assert.equal(r.headers.location, '/css/');
    const list = await get(port, '/css/');
    assert.equal(list.status, 200);
    assert.ok(list.body.includes('href="app.css"'));
  });
});

test('SSE: reload(caminho) avisa os navegadores; caminho fora da raiz não avisa', async () => {
  await withServer(async ({ server, port, root, outside }) => {
    const got = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/__agzos_live__/events', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
        assert.equal(res.headers['content-type'], 'text/event-stream');
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          if (buf.includes('retry:') && server.clientCount() === 1 && !buf.includes('data:')) {
            assert.equal(server.reload(path.join(outside, 'secret.txt')), 0);
            assert.equal(server.reload(path.join(root, 'index.html')), 1);
          }
          if (buf.includes('data: reload')) { req.destroy(); resolve(buf); }
        });
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
      req.end();
    });
    assert.match(got, /data: reload\n\n/);
  });
});

test('porta ocupada → usa a próxima livre', async () => {
  const start = basePort();
  const blocker = net.createServer().listen(start, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  try {
    await withServer(async ({ port }) => {
      assert.ok(port > start);
    }, { startPort: start });
  } finally {
    blocker.close();
  }
});

test('stop fecha o servidor e as conexões SSE', async () => {
  const site = mkSite();
  const server = createLiveServer({ root: site.root, isAllowed: () => true, startPort: basePort() });
  try {
    const { port } = await server.start();
    const closed = new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port, path: '/__agzos_live__/events', headers: { Host: `127.0.0.1:${port}` } }, (res) => {
        res.on('data', () => {});
        res.on('close', resolve);
      });
    });
    await new Promise((r) => setTimeout(r, 100));
    await server.stop();
    await closed;
    await assert.rejects(() => get(port, '/'), /ECONNREFUSED/);
    assert.equal(server.port, null);
  } finally { site.cleanup(); }
});

test('symlink local para arquivo oculto (a.txt -> .env, pasta -> .git) não serve o oculto', async () => {
  await withServer(async ({ port, root }) => {
    try {
      fs.symlinkSync('.env', path.join(root, 'a.txt'));
      fs.mkdirSync(path.join(root, '.git'));
      fs.writeFileSync(path.join(root, '.git', 'config'), 'token');
      fs.symlinkSync('.git', path.join(root, 'g'));
      fs.mkdirSync(path.join(root, 'site'));
      fs.symlinkSync(path.join('..', '.env'), path.join(root, 'site', 'index.html'));
    } catch { return; /* sem symlink */ }
    for (const p of ['/a.txt', '/g/config', '/g/', '/site/']) {
      const r = await get(port, p);
      assert.ok([403, 404].includes(r.status), `${p} → ${r.status}`);
      assert.doesNotMatch(r.body, /SEGREDO|token/, p);
    }
    assert.equal((await get(port, '/app.js')).status, 200);
  });
});
