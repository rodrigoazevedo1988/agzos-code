const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, readSettings } = require('./helpers');

test('árvore de pastas expande verticalmente e suporta troca de tema de ícones', async () => {
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-tree-test-'));
  fs.writeFileSync(path.join(tmpWorkspace, 'app.js'), 'console.log("hello");');
  fs.writeFileSync(path.join(tmpWorkspace, 'index.html'), '<h1>Hello</h1>');
  const subDir = path.join(tmpWorkspace, 'subfolder');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(subDir, 'styles.css'), 'body { margin: 0; }');

  const { app, page, userData, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true, iconTheme: 'lucide-color' },
  });

  try {
    // Permite a pasta de teste no path-guard (harness de teste)
    await app.evaluate((_electron, d) => global.__agzosAllowRoot(d), tmpWorkspace);

    // Abre workspace programaticamente no teste
    await page.evaluate(async (dir) => {
      const mod = await import('./scripts/file-tree.js');
      await mod.openWorkspace(dir);
    }, tmpWorkspace);

    // Aguarda carregar árvore
    await expect(page.locator('#file-tree')).toBeVisible();
    const rootRow = page.locator('.tree-node').first();
    await expect(rootRow).toBeVisible();

    // Verifica que itens filhos foram criados
    const fileItems = page.locator('.tree-node[data-is-dir="false"]');
    await expect(fileItems.first()).toBeVisible();

    // Mede coordenadas do pai e do primeiro filho para garantir expansão vertical (não lado a lado)
    const rootBox = await rootRow.boundingBox();
    const firstChildBox = await fileItems.first().boundingBox();

    expect(rootBox).not.toBeNull();
    expect(firstChildBox).not.toBeNull();
    // O filho deve estar abaixo (Y maior) e não na mesma linha horizontal do pai
    expect(firstChildBox.y).toBeGreaterThanOrEqual(rootBox.y + rootBox.height);

    // Testa troca de tema de ícones nas configurações
    await page.locator('.activity-btn[data-view="settings"]').click();
    await expect(page.locator('#settings-page')).toBeVisible();

    const iconSelect = page.locator('#setting-icon-theme');
    await expect(iconSelect).toHaveValue('lucide-color');

    // Altera para 'emoji'
    await iconSelect.selectOption('emoji');
    await expect.poll(() => readSettings(userData).iconTheme).toBe('emoji');

    // Volta ao Explorer e verifica se emoji foi renderizado
    await page.locator('#btn-settings-back').click();
    await page.locator('.activity-btn[data-view="explorer"]').click();
    await expect(page.locator('#file-tree .emoji-icon').first()).toBeVisible();

    // Altera para 'badges'
    await page.locator('.activity-btn[data-view="settings"]').click();
    await expect(page.locator('#settings-page')).toBeVisible();
    await iconSelect.selectOption('badges');
    await expect.poll(() => readSettings(userData).iconTheme).toBe('badges');

    await page.locator('#btn-settings-back').click();
    await page.locator('.activity-btn[data-view="explorer"]').click();
    await expect(page.locator('#file-tree .tree-badge').first()).toBeVisible();

    // Configurações abrem em página cheia; Esc volta.
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-page')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-page')).toBeHidden();

    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  }
});
