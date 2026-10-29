const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

test('copiar diagnóstico não gera erro quando o clipboard é negado', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'teste de diagnóstico' }));
    });
    await expect(page.locator('#fatal-overlay')).toBeVisible();
    await page.locator('#fatal-overlay .fatal-copy').click();
    await expect(page.locator('#fatal-overlay .fatal-copy')).toHaveText(/Copiado|Selecione o texto/);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
