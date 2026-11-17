const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { register, CHANNELS } = require('../../src/main/ipc/live');
const { createWindowGuards } = require('../../src/main/lib/window-guards');

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function mkSender(id) {
  const s = new EventEmitter();
  s.id = id;
  s.sent = [];
  s.isDestroyed = () => false;
  s.send = (ch, payload) => s.sent.push({ ch, payload });
  return s;
}

function setup(modules = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-live-ipc-')));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-live-ipc-out-')));
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site', 'index.html'), '<body>oi</body>');
  fs.writeFileSync(path.join(root, 'site', 'sobre nós.html'), '<body>sobre</body>');
  fs.writeFileSync(path.join(outside, 'x.html'), 'fora');
  const guards = createWindowGuards();
  const w1 = mkSender(1);
  const w2 = mkSender(2);
  guards.register(w1).allow(root);
  guards.register(w2);
  const startPort = 20000 + Math.floor(Math.random() * 20000);
  const opened = [];
  const handlers = {};
  const settings = { modules: { liveServer: { startPort }, ...modules } };
  const api = register({ handle: (ch, fn) => { handlers[ch] = fn; } }, {
    guardFor: guards.guardFor,
    getWindowRoot: (sender) => (sender.id === 1 ? root : null),
    settingsStore: { load: () => settings },
    openExternal: (url) => opened.push(url),
  });
  const call = (sender, name, ...args) => handlers[`live:${name}`]({ sender }, ...args);
  return {
    root, outside, w1, w2, call, opened, api, startPort,
    cleanup: async () => {
      await api.stopAll();
      [root, outside].forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
    },
  };
}

test('live:start numa pasta serve e abre no navegador; status e stop', async () => {
  const s = setup();
  try {
    assert.deepEqual(CHANNELS, ['start', 'stop', 'status', 'open', 'fileSaved']);
    const r = await s.call(s.w1, 'start', path.join(s.root, 'site'));
    assert.ok(r.port >= s.startPort);
    assert.equal(r.url, `http://127.0.0.1:${r.port}/`);
    assert.equal(r.openUrl, r.url);
    assert.deepEqual(s.opened, [r.url]);
    const page = await fetchText(r.url);
    assert.equal(page.status, 200);
    assert.match(page.body, /oi<script src="\/__agzos_live__\/reload.js">/);
    const st = await s.call(s.w1, 'status');
    assert.deepEqual(st, { running: true, port: r.port, url: r.url, root: path.join(s.root, 'site') });
    assert.equal(s.w1.sent.at(-1).ch, 'live:changed');
    await s.call(s.w1, 'stop');
    assert.deepEqual(await s.call(s.w1, 'status'), { running: false });
    await assert.rejects(() => fetchText(r.url), /ECONNREFUSED/);
  } finally { await s.cleanup(); }
});

test('live:start num .html serve a pasta do projeto e abre o arquivo', async () => {
  const s = setup();
  try {
    const r = await s.call(s.w1, 'start', path.join(s.root, 'site', 'sobre nós.html'), { open: false });
    assert.equal((await s.call(s.w1, 'status')).root, s.root);
    assert.equal(r.openUrl, `${r.url}site/sobre%20n%C3%B3s.html`);
    assert.deepEqual(s.opened, []);
    assert.equal((await fetchText(r.openUrl)).status, 200);
  } finally { await s.cleanup(); }
});

test('live:start nega caminho fora do guard, de outra janela e não-HTML', async () => {
  const s = setup();
  try {
    await assert.rejects(() => s.call(s.w1, 'start', path.join(s.outside, 'x.html')), /Acesso negado/);
    await assert.rejects(() => s.call(s.w2, 'start', path.join(s.root, 'site')), /Acesso negado/);
    fs.writeFileSync(path.join(s.root, 'a.js'), '');
    await assert.rejects(() => s.call(s.w1, 'start', path.join(s.root, 'a.js')), /\.html/);
    await assert.rejects(() => s.call(s.w1, 'start', 'relativo'), /Caminho inválido/);
  } finally { await s.cleanup(); }
});

test('módulo desabilitado recusa start', async () => {
  const s = setup({ liveServer: { enabled: false } });
  try {
    await assert.rejects(() => s.call(s.w1, 'start', s.root), /desabilitad/);
  } finally { await s.cleanup(); }
});

test('um servidor por janela; fechar a janela desliga o servidor', async () => {
  const s = setup();
  try {
    const a = await s.call(s.w1, 'start', path.join(s.root, 'site'), { open: false });
    const b = await s.call(s.w1, 'start', s.root, { open: false });
    // Raiz diferente: o anterior é parado.
    if (a.port !== b.port) await assert.rejects(() => fetchText(a.url), /ECONNREFUSED/);
    assert.equal((await s.call(s.w1, 'status')).root, s.root);
    s.w1.emit('destroyed');
    await new Promise((r) => setTimeout(r, 50));
    await assert.rejects(() => fetchText(b.url), /ECONNREFUSED/);
  } finally { await s.cleanup(); }
});

test('live:fileSaved recarrega os navegadores conectados', async () => {
  const s = setup();
  try {
    const r = await s.call(s.w1, 'start', path.join(s.root, 'site'), { open: false });
    const got = new Promise((resolve) => {
      const req = http.get(`${r.url}__agzos_live__/events`, (res) => {
        let buf = '';
        res.on('data', async (c) => {
          buf += c;
          if (buf.includes('retry:') && !buf.includes('data:')) {
            assert.equal(await s.call(s.w1, 'fileSaved', path.join(s.root, 'site', 'index.html')), 1);
          }
          if (buf.includes('data: reload')) { req.destroy(); resolve(true); }
        });
      });
      req.on('error', () => {});
    });
    assert.equal(await got, true);
    assert.equal(await s.call(s.w2, 'fileSaved', path.join(s.root, 'site', 'index.html')), 0);
  } finally { await s.cleanup(); }
});
