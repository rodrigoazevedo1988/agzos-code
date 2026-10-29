const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, readSettings } = require('./helpers');

const READY = { welcomeSeen: true, onboardingCompleted: true };

test('engrenagem da topbar abre a página cheia de Configurações', async () => {
  const { app, page, errors } = await launchApp({ settings: READY });
  try {
    await expect(page.locator('#settings-page')).toBeHidden();
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-page')).toBeVisible();
    // Página cheia, não o painel lateral antigo
    await expect(page.locator('#settings-page .settings-page-inner')).toBeVisible();
    await expect(page.locator('#settings-page h1')).toHaveText('Configurações');
    await expect(page.locator('#sidebar')).not.toContainText('Configurações');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('botão da activity bar abre a página cheia de Configurações', async () => {
  const { app, page, errors } = await launchApp({ settings: READY });
  try {
    await page.locator('.activity-btn[data-view="settings"]').click();
    await expect(page.locator('#settings-page')).toBeVisible();
    await expect(page.locator('#settings-page .settings-page-inner')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Ctrl+, abre a página cheia e Esc fecha', async () => {
  const { app, page, errors } = await launchApp({ settings: READY });
  try {
    await expect(page.locator('#settings-page')).toBeHidden();

    await page.keyboard.press('Control+Comma');
    await expect(page.locator('#settings-page')).toBeVisible();
    await expect(page.locator('#settings-page .settings-page-inner')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#settings-page')).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('botão voltar fecha a página cheia de Configurações', async () => {
  const { app, page, errors } = await launchApp({ settings: READY });
  try {
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-page')).toBeVisible();

    await page.locator('#btn-settings-back').click();
    await expect(page.locator('#settings-page')).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('settings.json com BOM UTF-8 preserva as configurações salvas', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-bom-'));
  // PowerShell/editor Windows grava com BOM: tema escolhido + onboarding já feito
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    `\ufeff${JSON.stringify({ ...READY, theme: 'monokai', fontSize: 17 }, null, 2)}`,
    'utf-8',
  );

  const { app, page, errors } = await launchApp({ userData });
  try {
    // Não deve reabrir welcome/onboarding por ter "resetado" as configurações
    await expect(page.locator('#welcome-popup.active')).toHaveCount(0);
    await expect(page.locator('#onboarding-overlay.active')).toHaveCount(0);

    await expect(page.locator('body')).toHaveClass(/theme-monokai/);
    expect(readSettings(userData).theme).toBe('monokai');
    expect(readSettings(userData).fontSize).toBe(17);

    await expect.poll(
      () => fs.readdirSync(userData).filter((f) => f.startsWith('settings.json.corrupt-')).length,
    ).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
