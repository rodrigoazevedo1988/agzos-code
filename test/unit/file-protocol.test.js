const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPathGuard } = require('../../src/main/lib/path-guard');
const {
  urlToPath, mimeForPath, parseRange, createFileProtocolHandler,
} = require('../../src/main/lib/file-protocol');

test('urlToPath decodifica caminhos POSIX', () => {
  assert.equal(urlToPath('agzos-file://local/home/a%20b/x.png', 'linux'), '/home/a b/x.png');
  assert.equal(urlToPath('agzos-file://local/tmp/x.png?v=123', 'linux'), '/tmp/x.png');
  assert.equal(urlToPath('agzos-file://local/tmp/%23hash%3F.png', 'linux'), '/tmp/#hash?.png');
});

test('urlToPath decodifica caminhos Windows', () => {
  assert.equal(urlToPath('agzos-file://local/C%3A/Users/x%20y/a.pdf', 'win32'), 'C:\\Users\\x y\\a.pdf');
  assert.equal(urlToPath('agzos-file://local/C:/a/b.png', 'win32'), 'C:\\a\\b.png');
});

test('urlToPath recusa host errado, NUL e codificação inválida', () => {
  assert.equal(urlToPath('agzos-file://other/tmp/x.png', 'linux'), null);
  assert.equal(urlToPath('agzos-file://local/tmp/a%00b', 'linux'), null);
  assert.equal(urlToPath('agzos-file://local/tmp/%E0%A4%A', 'linux'), null);
  assert.equal(urlToPath('https://local/tmp/x.png', 'linux'), null);
});

test('mimeForPath por extensão (maiúsculas inclusive)', () => {
  assert.equal(mimeForPath('/a/B.PNG'), 'image/png');
  assert.equal(mimeForPath('/a/x.svg'), 'image/svg+xml');
  assert.equal(mimeForPath('/a/x.pdf'), 'application/pdf');
  assert.equal(mimeForPath('/a/x.mp4'), 'video/mp4');
  assert.equal(mimeForPath('/a/x.webm'), 'video/webm');
  assert.equal(mimeForPath('/a/x.mp3'), 'audio/mpeg');
  assert.equal(mimeForPath('/a/semext'), 'application/octet-stream');
});

test('parseRange', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=0-5000', 1000), { start: 0, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'invalid');
  assert.equal(parseRange('bytes=5-2', 1000), 'invalid');
  assert.equal(parseRange(null, 1000), null);
  assert.equal(parseRange('items=0-1', 1000), null);
});

function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-proto-')));
  const ws = path.join(base, 'ws');
  fs.mkdirSync(ws);
  fs.writeFileSync(path.join(ws, 'a b.txt'), '0123456789');
  fs.writeFileSync(path.join(ws, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(base, 'secret.txt'), 'segredo');
  const guard = createPathGuard();
  guard.allow(ws);
  const handler = createFileProtocolHandler({ guard });
  const url = (p) => 'agzos-file://local' + p.split('/').map(encodeURIComponent).join('/');
  return { base, ws, handler, url };
}

const req = (url, headers = {}) => ({ url, method: 'GET', headers: new Headers(headers) });

test('handler serve arquivo dentro do guard com MIME', async () => {
  const { ws, handler, url, base } = setup();
  const res = await handler(req(url(path.join(ws, 'img.png'))));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(Buffer.from(await res.arrayBuffer()).length, 4);
  fs.rmSync(base, { recursive: true, force: true });
});

test('handler responde 403 fora do guard', async () => {
  const { handler, url, base } = setup();
  const res = await handler(req(url(path.join(base, 'secret.txt'))));
  assert.equal(res.status, 403);
  fs.rmSync(base, { recursive: true, force: true });
});

test('handler responde 403 para ".." e ".." codificado escapando do workspace', async () => {
  const { ws, handler, base } = setup();
  const raw = `agzos-file://local${ws}/../secret.txt`;
  assert.equal((await handler(req(raw))).status, 403);
  const enc = `agzos-file://local${ws}/%2e%2e/secret.txt`;
  assert.equal((await handler(req(enc))).status, 403);
  const slash = `agzos-file://local${ws}/..%2Fsecret.txt`;
  assert.equal((await handler(req(slash))).status, 403);
  fs.rmSync(base, { recursive: true, force: true });
});

test('handler aceita caminho codificado (espaço) e responde 404 se não existe', async () => {
  const { ws, handler, url, base } = setup();
  const ok = await handler(req(url(path.join(ws, 'a b.txt'))));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '0123456789');
  const missing = await handler(req(url(path.join(ws, 'nada.png'))));
  assert.equal(missing.status, 404);
  fs.rmSync(base, { recursive: true, force: true });
});

test('handler atende Range com 206 e 416', async () => {
  const { ws, handler, url, base } = setup();
  const res = await handler(req(url(path.join(ws, 'a b.txt')), { Range: 'bytes=2-5' }));
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(res.headers.get('content-length'), '4');
  assert.equal(await res.text(), '2345');
  const bad = await handler(req(url(path.join(ws, 'a b.txt')), { Range: 'bytes=50-' }));
  assert.equal(bad.status, 416);
  fs.rmSync(base, { recursive: true, force: true });
});

test('handler recusa diretório e host inválido', async () => {
  const { ws, handler, url, base } = setup();
  assert.equal((await handler(req(url(ws)))).status, 404);
  assert.equal((await handler(req('agzos-file://outro/x'))).status, 400);
  fs.rmSync(base, { recursive: true, force: true });
});
