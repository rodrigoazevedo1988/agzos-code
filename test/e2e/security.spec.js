const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');

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
