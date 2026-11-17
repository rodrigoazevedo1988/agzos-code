const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

test('cabeçalho do Explorer: 4 ações, atualizar e recolher pastas', async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-explorer-')));
  fs.mkdirSync(path.join(ws, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src', 'lib', 'a.js'), '1');
  const { app, page, errors } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), ws);
    await page.evaluate(async (d) => { const m = await import('./scripts/file-tree.js'); await m.openWorkspace(d); }, ws);

    const actions = page.locator('#explorer-actions');
    await expect(actions).toBeVisible();
    await expect(actions.locator('button')).toHaveCount(4);
    for (const id of ['btn-new-file', 'btn-new-folder', 'btn-refresh-explorer', 'btn-collapse-folders']) {
      await expect(actions.locator(`#${id}`)).toBeVisible();
    }
    await expect(page.locator('#btn-open-folder')).toHaveCount(0);

    // Expande src e src/lib
    await page.locator('.tree-row', { hasText: 'src' }).first().click();
    await page.locator('.tree-row', { hasText: 'lib' }).first().click();
    await expect(page.locator('.tree-row', { hasText: 'a.js' })).toBeVisible();

    // Arquivo criado fora aparece ao atualizar, mantendo pastas abertas
    fs.writeFileSync(path.join(ws, 'src', 'lib', 'novo.js'), '2');
    await page.locator('#btn-refresh-explorer').click();
    await expect(page.locator('.tree-row', { hasText: 'novo.js' })).toBeVisible();

    // Recolher pastas
    await page.locator('#btn-collapse-folders').click();
    await expect(page.locator('.tree-row', { hasText: 'a.js' })).toHaveCount(0);
    await expect(page.locator('.tree-row', { hasText: 'src' })).toBeVisible();

    // Só aparece no Explorer
    await page.locator('.activity-btn[data-view="git"]').click();
    await expect(actions).toBeHidden();
    await page.locator('.activity-btn[data-view="modules"]').click();
    await expect(actions).toBeHidden();
    await page.locator('.activity-btn[data-view="explorer"]').click();
    await expect(actions).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('título da janela mostra projeto › arquivo ativo', async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-title-')));
  fs.writeFileSync(path.join(ws, 'README.md'), '# oi\n');
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), ws);
    await page.evaluate(async (d) => { const m = await import('./scripts/file-tree.js'); await m.openWorkspace(d); }, ws);
    await expect(page).toHaveTitle(`${path.basename(ws)} — Agzos Code`);
    await page.evaluate(async (f) => { const m = await import('./scripts/editor.js'); await m.openFile(f); }, path.join(ws, 'README.md'));
    await expect(page).toHaveTitle(`${path.basename(ws)} › README.md — Agzos Code`);
  } finally {
    await app.close();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('pasta linkada (symlink/junction) com vídeos expande no Explorer', async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-link-')));
  fs.mkdirSync(path.join(ws, 'real'));
  fs.writeFileSync(path.join(ws, 'real', 'aula 01.mp4'), 'x');
  fs.symlinkSync(path.join(ws, 'real'), path.join(ws, 'Vídeos'), process.platform === 'win32' ? 'junction' : 'dir');
  const { app, page, errors } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), ws);
    await page.evaluate(async (d) => { const m = await import('./scripts/file-tree.js'); await m.openWorkspace(d); }, ws);
    await page.locator('.tree-row', { hasText: 'Vídeos' }).first().click();
    await expect(page.locator('.tree-row', { hasText: 'aula 01.mp4' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('erro ao ler pasta aparece em aviso (não fica em silêncio)', async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-err-')));
  fs.mkdirSync(path.join(ws, 'videos'));
  fs.writeFileSync(path.join(ws, 'videos', 'a.mp4'), 'x');
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), ws);
    await page.evaluate(async (d) => { const m = await import('./scripts/file-tree.js'); await m.openWorkspace(d); }, ws);
    await expect(page.locator('.tree-row', { hasText: 'videos' })).toBeVisible();
    fs.rmSync(path.join(ws, 'videos'), { recursive: true, force: true });
    await page.locator('.tree-row', { hasText: 'videos' }).first().click();
    await expect(page.locator('.toast.error')).toContainText('Não foi possível abrir a pasta videos');
  } finally {
    await app.close();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('arquivo criado por outro programa aparece sem atualizar (observador) e ao reabrir a pasta', async () => {
  const ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-watch-')));
  fs.mkdirSync(path.join(ws, 'Global'));
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), ws);
    await page.evaluate(async (d) => { const m = await import('./scripts/file-tree.js'); await m.openWorkspace(d); }, ws);
    const globalRow = page.locator('.tree-row', { hasText: 'Global' }).first();
    // Abre a pasta vazia (fica em cache) e fecha.
    await globalRow.click();
    await globalRow.click();
    // "Download" chega depois.
    fs.writeFileSync(path.join(ws, 'Global', 'video.mp4'), 'x');
    await globalRow.click();
    await expect(page.locator('.tree-row', { hasText: 'video.mp4' })).toBeVisible();
    // Com a pasta aberta, um novo arquivo aparece sozinho (observador).
    fs.writeFileSync(path.join(ws, 'Global', 'segundo.mp4'), 'x');
    await expect(page.locator('.tree-row', { hasText: 'segundo.mp4' })).toBeVisible({ timeout: 5000 });
  } finally {
    await app.close();
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
