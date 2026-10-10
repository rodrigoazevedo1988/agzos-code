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

test('migra aiApiKey antigo para o cofre', async () => {
  const fs = require('fs');
  const path = require('path');
  const { app, page, userData, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true, aiApiKey: 'sk-teste' },
  });
  try {
    await expect.poll(() => readSettings(userData).aiApiKey, { timeout: 5000 }).toBeUndefined();
    const secrets = fs.readFileSync(path.join(userData, 'secrets.json'), 'utf-8');
    expect(secrets).not.toContain('sk-teste');
    expect(await page.evaluate(() => window.agzos.secrets.has('ai.legacy'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
