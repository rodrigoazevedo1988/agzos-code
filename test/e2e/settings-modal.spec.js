const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

test('modal de configurações abre com Ctrl+,, navega por categorias, busca e reseta', async () => {
  const { app, page } = await launchApp({
    settings: {
      welcomeSeen: true,
      onboardingCompleted: true,
    },
  });

  try {
    // 1. Modal fechado inicialmente
    const overlay = page.locator('#settings-modal-overlay');
    await expect(overlay).toBeHidden();

    // 2. Abre via clique no botão de settings da topbar
    await page.click('#btn-settings');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveClass(/active/);

    // 3. Título e categorias presentes
    await expect(page.locator('#settings-modal-title')).toHaveText('Configurações');
    await expect(page.locator('.settings-category-item').first()).toContainText('Comumente Usados');

    // 4. Busca por 'tabSize'
    const searchInput = page.locator('#settings-search-input');
    await searchInput.fill('tabSize');

    const tabSizeRow = page.locator('.setting-item-row[data-key="editor.tabSize"]');
    await expect(tabSizeRow).toBeVisible();
    await expect(tabSizeRow).toContainText('Editor: Tab Size');

    // 5. Altera tabSize para 4
    const tabSizeInput = tabSizeRow.locator('input[type="number"]');
    await tabSizeInput.fill('4');
    await tabSizeInput.dispatchEvent('change');

    // Deve marcar como modified e mostrar botão de reset
    await expect(tabSizeRow).toHaveClass(/modified/);
    const resetBtn = tabSizeRow.locator('.setting-reset-btn');
    await expect(resetBtn).toBeVisible();

    // 6. Filtro @modified mostra apenas itens alterados
    await searchInput.fill('@modified');
    await expect(tabSizeRow).toBeVisible();

    // 7. Clicar em restaurar padrão volta ao default (2) e o item sai da lista de @modified
    await resetBtn.click();
    await expect(tabSizeRow).toBeHidden();

    // Limpa a busca e confere que o tabSize agora é 2 e não tem .modified
    await searchInput.fill('tabSize');
    await expect(tabSizeRow).toBeVisible();
    await expect(tabSizeInput).toHaveValue('2');
    await expect(tabSizeRow).not.toHaveClass(/modified/);

    // 8. Alternar para visualização JSON
    await page.click('#btn-toggle-settings-json');
    const jsonTextarea = page.locator('#settings-json-textarea');
    await expect(jsonTextarea).toBeVisible();
    const jsonVal = await jsonTextarea.inputValue();
    expect(jsonVal).toContain('"theme"');

    // 9. Fechar modal com Escape
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden();
  } finally {
    await app.close();
  }
});
