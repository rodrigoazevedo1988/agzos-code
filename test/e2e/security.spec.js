const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, readSettings } = require('./helpers');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('fs fora da workspace é negado; dentro da raiz liberada funciona', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const outside = path.join(tmpDir('agzos-outside-'), 'secreto.txt');
    fs.writeFileSync(outside, 'segredo');
    const root = tmpDir('agzos-root-');
    const inside = path.join(root, 'a.txt');
    fs.writeFileSync(inside, 'ok-dentro');

    const denied = await page.evaluate((p) => window.agzos.fs.readFile(p).then(() => 'ok', (e) => e.message), outside);
    expect(denied).toContain('Acesso negado');

    await app.evaluate((_electron, dir) => global.__agzosAllowRoot(dir), root);
    const content = await page.evaluate((p) => window.agzos.fs.readFile(p).then((r) => r.content), inside);
    expect(content).toBe('ok-dentro');

    expect(await page.evaluate((p) => window.agzos.workspace.open(p), '/nao/liberada')).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('renderer não consegue liberar pasta gravando recentFolders', async () => {
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const secretDir = tmpDir('agzos-secret-');
    fs.writeFileSync(path.join(secretDir, 's.txt'), 'segredo');
    const result = await page.evaluate(async (d) => {
      const s = await window.agzos.settings.load();
      await window.agzos.settings.save({ ...s, recentFolders: [d] });
      const opened = await window.agzos.workspace.open(d);
      const read = await window.agzos.fs.readFile(d + '/s.txt').then(() => 'leu', (e) => e.message);
      return { opened, read };
    }, secretDir);
    expect(result.opened).toBe(false);
    expect(result.read).toContain('Acesso negado');
  } finally {
    await app.close();
  }
});

test('pasta aberta vira recente e reabre após reiniciar', async () => {
  const root = tmpDir('agzos-recent-');
  const first = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await first.app.evaluate((_electron, d) => global.__agzosAllowRoot(d), root);
    expect(await first.page.evaluate((d) => window.agzos.workspace.open(d), root)).toBe(true);
    expect(readSettings(first.userData).recentFolders).toContain(root);
  } finally {
    await first.app.close();
  }

  const second = await launchApp({ userData: first.userData });
  try {
    expect(await second.page.evaluate((d) => window.agzos.workspace.open(d), root)).toBe(true);
  } finally {
    await second.app.close();
  }
});
