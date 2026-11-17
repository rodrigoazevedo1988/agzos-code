const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const base = { welcomeSeen: true, onboardingCompleted: true };

async function setup({ settings = {} } = {}) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-live-e2e-')));
  fs.writeFileSync(path.join(workspace, 'index.html'), '<!doctype html><html><body><h1>Versão 1</h1></body></html>');
  fs.writeFileSync(path.join(workspace, 'style.css'), 'h1 { color: red; }');
  const startPort = 20000 + Math.floor(Math.random() * 20000);
  const launched = await launchApp({ settings: { ...base, modules: { liveServer: { startPort } }, ...settings } });
  const { app, page } = launched;
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), workspace);
  // Registra as URLs abertas "no navegador" em vez de abrir de verdade.
  await app.evaluate(({ shell }) => {
    global.__opened = [];
    shell.openExternal = async (url) => { global.__opened.push(url); };
  });
  await page.evaluate((d) => import('./scripts/file-tree.js').then((m) => m.openWorkspace(d)), workspace);
  const close = async () => { await app.close(); fs.rmSync(workspace, { recursive: true, force: true }); };
  return { ...launched, workspace, startPort, close };
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

/** Conecta no SSE como o navegador faria; resolve quando chega "data: reload". */
function listenReload(url) {
  let req;
  const ready = new Promise((resolveReady) => {
    const reloaded = new Promise((resolve) => {
      req = http.get(`${url}__agzos_live__/events`, (res) => {
        let buf = '';
        res.on('data', (c) => {
          buf += c;
          if (buf.includes('retry:')) resolveReady({ reloaded, close: () => req.destroy() });
          if (buf.includes('data: reload')) resolve(true);
        });
      });
      req.on('error', () => {});
    });
  });
  return ready;
}

test('Abrir com Agzos Ao Vivo: serve com recarga, status bar, PORTAS e recarrega ao salvar', async () => {
  const env = await setup();
  const { page, app, workspace, startPort } = env;
  try {
    await page.locator('.tree-row', { hasText: 'index.html' }).click({ button: 'right' });
    await page.locator('#context-menu li', { hasText: 'Abrir com Agzos Ao Vivo' }).click();
    const status = page.locator('#status-live');
    await expect(status).toBeVisible();
    await expect(status).toHaveText(/^Ao Vivo :\d+$/);
    const port = Number((await status.textContent()).split(':')[1]);
    expect(port).toBeGreaterThanOrEqual(startPort);
    const url = `http://127.0.0.1:${port}/`;
    await expect.poll(() => app.evaluate(() => global.__opened)).toEqual([`${url}index.html`]);

    const pageHtml = await fetchText(`${url}index.html`);
    expect(pageHtml.status).toBe(200);
    expect(pageHtml.body).toContain('<script src="/__agzos_live__/reload.js"></script></body>');
    expect((await fetchText(`${url}style.css`)).body).toBe('h1 { color: red; }');
    // Caminho cru (new URL normalizaria o %2e%2e).
    expect((await fetchText({ host: '127.0.0.1', port, path: '/%2e%2e/' })).status).toBe(400);

    // Aparece na aba PORTAS (lista de portas em escuta do sistema).
    await expect.poll(async () => (await page.evaluate(() => window.agzos.ports.list())).ports.map((p) => p.port), { timeout: 10000 })
      .toContain(port);

    const sse = await listenReload(url);
    await page.evaluate((p) => window.AgzosEditor.openFile(p), path.join(workspace, 'index.html'));
    await page.evaluate(() => import('./scripts/editor.js').then((m) => {
      const ed = m.getActiveEditor();
      ed.setValue(ed.getValue().replace('Versão 1', 'Versão 2'));
    }));
    await page.keyboard.press('Control+S');
    await expect.poll(() => fs.readFileSync(path.join(workspace, 'index.html'), 'utf8')).toContain('Versão 2');
    expect(await Promise.race([sse.reloaded, new Promise((r) => setTimeout(() => r(false), 5000))])).toBe(true);
    sse.close();

    // Clique na status bar → Parar.
    await status.click();
    await page.locator('#cmd-list li', { hasText: 'Parar Agzos Ao Vivo' }).click();
    await expect(status).toBeHidden();
    await expect.poll(() => fetchText(url).then(() => 'up', () => 'down')).toBe('down');
    expect(env.errors).toEqual([]);
  } finally { await env.close(); }
});

test('paleta: Abrir na pasta do projeto e Parar; fechar o app derruba o servidor', async () => {
  const env = await setup();
  const { page, app } = env;
  let url;
  try {
    await page.keyboard.press('Control+Shift+P');
    await page.locator('#cmd-input').fill('> Agzos Ao Vivo: Abrir');
    await expect(page.locator('#cmd-list')).toContainText('Agzos Ao Vivo: Abrir');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status-live')).toBeVisible();
    const port = Number((await page.locator('#status-live').textContent()).split(':')[1]);
    url = `http://127.0.0.1:${port}/`;
    await expect.poll(() => app.evaluate(() => global.__opened)).toEqual([url]);
    expect((await fetchText(url)).body).toContain('Versão 1');
  } finally { await env.close(); }
  await expect.poll(() => fetchText(url).then(() => 'up', () => 'down')).toBe('down');
});

test('Ao Vivo desabilitado: sem item no menu de contexto e sem comando de abrir', async () => {
  const env = await setup({ settings: { modules: { liveServer: { enabled: false } } } });
  const { page } = env;
  try {
    await page.locator('.tree-row', { hasText: 'index.html' }).click({ button: 'right' });
    await expect(page.locator('#context-menu')).toBeVisible();
    await expect(page.locator('#context-menu li', { hasText: 'Agzos Ao Vivo' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+P');
    await page.locator('#cmd-input').fill('> Agzos Ao Vivo: Abrir');
    await page.keyboard.press('Enter');
    await expect(page.locator('#toast-container')).toContainText('desabilitado');
    await expect(page.locator('#status-live')).toBeHidden();
  } finally { await env.close(); }
});
