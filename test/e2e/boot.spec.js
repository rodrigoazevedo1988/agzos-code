const { test, expect } = require('@playwright/test');
const { launchApp, readSettings, completeOnboarding } = require('./helpers');

test('primeira execução mostra welcome e conclui onboarding', async () => {
  const { app, page, userData, errors } = await launchApp();
  try {
    await expect(page.locator('#welcome-popup.active')).toBeVisible();
    await completeOnboarding(page);
    // exitOnboarding() esconde o overlay antes de o save assíncrono terminar.
    await expect.poll(() => readSettings(userData).onboardingCompleted).toBe(true);
    expect(readSettings(userData).welcomeSeen).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('segunda execução não mostra overlays', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await expect(page.locator('#welcome-popup.active')).toHaveCount(0);
    await expect(page.locator('#onboarding-overlay.active')).toHaveCount(0);
    await expect(page.locator('.monaco-editor').first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
