/**
 * Várias janelas: permissões de arquivo por janela (como no VS Code) e
 * settings sincronizadas entre janelas.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');

const SETTINGS = { welcomeSeen: true, onboardingCompleted: true };
const FIX = path.join(__dirname, 'fixtures', 'viewers');

function tmpDir(prefix, files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

const wcIds = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => w.webContents.getURL().endsWith('renderer/index.html'))
  .map((w) => w.webContents.id));

async function openIn(app, page, id, dir) {
  await app.evaluate((_e, [d, wid]) => global.__agzosAllowRoot(d, wid), [dir, id]);
  await page.evaluate(async (d) => {
    const mod = await import('./scripts/file-tree.js');
    await mod.openWorkspace(d);
  }, dir);
}

async function secondWindow(app, page) {
  const before = await wcIds(app);
  const mains = () => app.windows().filter((w) => w.url().endsWith('renderer/index.html'));
  await page.evaluate(() => window.agzos.window.newWindow());
  await expect.poll(() => mains().length, { timeout: 15000 }).toBe(2);
  const page2 = mains().find((w) => w !== page);
  await page2.waitForFunction(() => !!window.AgzosEditor, null, { timeout: 15000 });
  const after = await wcIds(app);
  const id2 = after.find((id) => !before.includes(id));
  return { page2, idA: before[0], idB: id2 };
}

test('janela B não lê arquivo nem imagem (protocolo) da pasta da janela A', async () => {
  const { app, page, errors } = await launchApp({ settings: SETTINGS });
  try {
    const dirA = tmpDir('agzos-win-a-', { 'a.txt': 'segredo A' });
    fs.copyFileSync(path.join(FIX, 'tiny.png'), path.join(dirA, 'img.png'));
    const dirB = tmpDir('agzos-win-b-', { 'b.txt': 'B' });
    const { page2, idA, idB } = await secondWindow(app, page);
    await openIn(app, page, idA, dirA);
    await openIn(app, page2, idB, dirB);

    // A lê o próprio arquivo; B é negada
    expect(await page.evaluate((p) => window.agzos.fs.readFile(p).then((r) => r.content), path.join(dirA, 'a.txt'))).toBe('segredo A');
    const denied = await page2.evaluate((p) => window.agzos.fs.readFile(p).then(() => 'leu', (e) => e.message), path.join(dirA, 'a.txt'));
    expect(denied).toContain('Acesso negado');
    const deniedList = await page2.evaluate((p) => window.agzos.fs.readDir(p).then(() => 'listou', (e) => e.message), dirA);
    expect(deniedList).toContain('Acesso negado');

    // Tokens diferentes por janela
    const hostA = await page.evaluate(() => window.agzos.fileHost);
    const hostB = await page2.evaluate(() => window.agzos.fileHost);
    expect(hostA).toMatch(/^[0-9a-f]{32}$/);
    expect(hostB).toMatch(/^[0-9a-f]{32}$/);
    expect(hostA).not.toBe(hostB);

    // Imagem de A: carrega em A, não carrega em B (nem com o caminho, nem com o token de B)
    const loadImg = (p, file) => p.evaluate(async (f) => {
      const { toFileUrl } = await import('./scripts/viewers/paths.js');
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth);
        img.onerror = () => resolve('erro');
        img.src = toFileUrl(f, Date.now());
      });
    }, file);
    expect(await loadImg(page, path.join(dirA, 'img.png'))).toBe(32);
    expect(await loadImg(page2, path.join(dirA, 'img.png'))).toBe('erro');
    const status = (u) => app.evaluate(async ({ net }, target) => (await net.fetch(target)).status, u);
    const url = (h, p) => `agzos-file://${h}` + p.split('/').map(encodeURIComponent).join('/');
    expect(await status(url(hostA, path.join(dirA, 'img.png')))).toBe(200);
    expect(await status(url(hostB, path.join(dirA, 'img.png')))).toBe(403);

    // Fechar a janela B: o token dela deixa de valer
    await page2.evaluate(() => window.agzos.window.close());
    await expect.poll(async () => (await wcIds(app)).length).toBe(1);
    expect(await status(url(hostB, path.join(dirB, 'b.txt')))).toBe(403);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('trocar de pasta numa janela revoga a pasta antiga nela', async () => {
  const { app, page } = await launchApp({ settings: SETTINGS });
  try {
    const dir1 = tmpDir('agzos-sw1-', { 'a.txt': 'A' });
    const dir2 = tmpDir('agzos-sw2-', { 'b.txt': 'B' });
    const [id] = await wcIds(app);
    await openIn(app, page, id, dir1);
    await openIn(app, page, id, dir2);
    const read = (p) => page.evaluate((f) => window.agzos.fs.readFile(f).then((r) => r.content, (e) => e.message), p);
    expect(await read(path.join(dir2, 'b.txt'))).toBe('B');
    expect(await read(path.join(dir1, 'a.txt'))).toContain('Acesso negado');
    // Recente reabre pelo fluxo de abrir
    expect(await page.evaluate((d) => window.agzos.workspace.open(d), dir1)).toBe(true);
    expect(await read(path.join(dir1, 'a.txt'))).toBe('A');
  } finally {
    await app.close();
  }
});

test('mudar o tema na janela A reflete na janela B', async () => {
  const { app, page, errors } = await launchApp({ settings: { ...SETTINGS, theme: 'agzos-dark' } });
  try {
    const { page2 } = await secondWindow(app, page);
    expect(await page2.evaluate(() => window.AgzosState.settings.theme)).toBe('agzos-dark');
    await page.evaluate(async () => {
      const mod = await import('./scripts/editor.js');
      mod.applyTheme('monokai');
    });
    await expect.poll(() => page2.evaluate(() => window.AgzosState.settings.theme)).toBe('monokai');
    await expect.poll(() => page2.evaluate(() => document.body.className)).toContain('theme-monokai');

    // Cópia velha numa janela não desfaz a mudança da outra
    await page2.evaluate(async () => {
      const s = window.AgzosState.settings;
      s.fontSize = 17;
      await window.agzos.settings.save(s);
    });
    const disk = await page.evaluate(() => window.agzos.settings.load());
    expect(disk.theme).toBe('monokai');
    expect(disk.fontSize).toBe(17);
    await expect.poll(() => page.evaluate(() => window.AgzosState.settings.fontSize)).toBe(17);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
