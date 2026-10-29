const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');

function tmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function openWorkspace(app, page, root) {
  await app.evaluate((_electron, dir) => global.__agzosAllowRoot(dir), root);
  await page.evaluate(async (dir) => {
    const tree = await import('./scripts/file-tree.js');
    await tree.openWorkspace(dir);
  }, root);
}

test('fechar janela com dirty pede confirmação e salva tudo', async () => {
  const root = tmpRoot('agzos-dirty-');
  const file = path.join(root, 'a.txt');
  fs.writeFileSync(file, 'original\n');
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await openWorkspace(app, page, root);
    await page.evaluate(async (p) => {
      const ed = await import('./scripts/editor.js');
      await ed.openFile(p);
      ed.getActiveEditor().setValue('editado\n');
    }, file);
    await page.waitForTimeout(150);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('renderer/index.html'))
        .close();
    });
    await expect(page.locator('#close-guard-overlay')).toBeVisible();
    await page.locator('#close-guard-overlay .cg-cancel').click();
    await page.waitForTimeout(200);
    expect(app.windows().length).toBeGreaterThan(0);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('renderer/index.html'))
        .close();
    });
    await expect(page.locator('#close-guard-overlay')).toBeVisible();
    await page.locator('#close-guard-overlay .cg-save').click();
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('editado\n');
  } finally {
    await app.close().catch(() => {});
  }
});

test('Latin-1 abre somente leitura e reabre como Windows-1252 sem corromper', async () => {
  const root = tmpRoot('agzos-encoding-');
  const file = path.join(root, 'latin1.txt');
  fs.writeFileSync(file, Buffer.from('café ação', 'latin1'));
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await openWorkspace(app, page, root);
    await page.evaluate(async (p) => {
      const ed = await import('./scripts/editor.js');
      await ed.openFile(p);
    }, file);
    await expect(page.locator('#editor-banner')).toContainText('Codificação não reconhecida');
    await page.locator('#editor-banner .editor-banner-action').click();
    await page.waitForTimeout(200);

    const readOnly = await page.evaluate((p) => window.AgzosState.files.get(p).readOnly, file);
    expect(readOnly).toBe(false);
    await page.evaluate(async (p) => {
      const ed = await import('./scripts/editor.js');
      ed.getActiveEditor().setValue('café ação 2');
      await ed.saveActive();
    }, file);
    await expect.poll(() => fs.readFileSync(file).toString('latin1')).toBe('café ação 2');
  } finally {
    await app.close().catch(() => {});
  }
});

test('.env aparece no Explorer e clique na busca leva à linha', async () => {
  const root = tmpRoot('agzos-search-');
  fs.writeFileSync(path.join(root, '.env'), 'SEGREDO=1\n');
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await openWorkspace(app, page, root);
    await expect(page.locator(`.tree-row[data-path="${path.join(root, '.env')}"]`)).toBeVisible();

    await page.locator('[data-view="search"]').click();
    await page.locator('#search-text').fill('SEGREDO');
    await expect(page.locator('.search-hit').first()).toBeVisible();
    await page.locator('.search-hit').first().click();
    const state = await page.evaluate(() => ({
      active: window.AgzosState.activePath,
      line: window.AgzosEditor.getActiveEditor().getPosition().lineNumber,
    }));
    expect(state.active).toBe(path.join(root, '.env'));
    expect(state.line).toBe(1);
  } finally {
    await app.close().catch(() => {});
  }
});

test('novo arquivo e renomear arquivo aberto mantêm abas consistentes', async () => {
  const root = tmpRoot('agzos-fileops-');
  const file = path.join(root, 'a.txt');
  fs.writeFileSync(file, 'abc\n');
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await openWorkspace(app, page, root);
    await page.evaluate(async (p) => {
      const ed = await import('./scripts/editor.js');
      await ed.openFile(p);
    }, file);

    await page.locator('#btn-new-file').click();
    await page.locator('#input-dialog-overlay input').fill('novo.md');
    await page.locator('#input-dialog-overlay .dialog-ok').click();
    await expect.poll(() => fs.existsSync(path.join(root, 'novo.md'))).toBe(true);

    await page.locator(`.tree-row[data-path="${file}"]`).click({ button: 'right' });
    await page.locator('#context-menu [data-action="rename"]').click();
    await page.locator('#input-dialog-overlay input').fill('b.txt');
    await page.locator('#input-dialog-overlay .dialog-ok').click();
    await expect.poll(() => fs.existsSync(path.join(root, 'b.txt'))).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    const state = await page.evaluate(() => ({
      active: window.AgzosState.activePath,
      keys: [...window.AgzosState.files.keys()],
    }));
    expect(state.active).toBe(path.join(root, 'novo.md'));
    expect(state.keys).toContain(path.join(root, 'b.txt'));
    expect(state.keys).not.toContain(file);
  } finally {
    await app.close().catch(() => {});
  }
});
