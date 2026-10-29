const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, readSettings, completeOnboarding } = require('./helpers');

// expect.poll não retenta quando a função lança; settings.json pode ainda não existir.
function readSettingsIfExists(userData) {
  try {
    return readSettings(userData);
  } catch {
    return null;
  }
}

test('concluir sem escolher tema salva agzos-dark', async () => {
  const { app, page, userData, errors } = await launchApp();
  try {
    await completeOnboarding(page);
    await expect.poll(() => readSettingsIfExists(userData)?.onboardingAnswers?.theme).toBe('agzos-dark');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('escolher Agzos Light aplica e persiste', async () => {
  const { app, page, userData, errors } = await launchApp();
  try {
    await page.locator('.welcome-primary').click();
    await page.locator('#onboarding-overlay.active').waitFor({ timeout: 5000 });
    await page.locator('#onboarding-overlay.active .onb-primary').click(); // passo: tema
    await page.locator('.onb-theme-card', { hasText: 'Agzos Light' }).click();
    await expect(page.locator('body')).toHaveClass(/theme-agzos-light/);
    await completeOnboarding(page);
    await expect.poll(() => readSettings(userData).theme).toBe('agzos-light');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('tela de boas-vindas do editor aparece e some ao abrir arquivo', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await expect(page.locator('#welcome')).toBeVisible();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-welcome-'));
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'olá');
    await app.evaluate((_electron, d) => global.__agzosAllowRoot(d), dir);
    await page.evaluate((p) => window.AgzosEditor.openFile(p), file);

    await expect(page.locator('#welcome')).toBeHidden();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('status bar mostra rótulo de performance em pt-BR', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await expect(page.locator('#status-perf-label')).toContainText('Balanceado');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('welcome do editor volta ao fechar a última aba', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-welcome-'));
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'x');
    await app.evaluate((_electron, d) => global.__agzosAllowRoot(d), dir);
    await page.evaluate((p) => window.AgzosEditor.openFile(p), file);
    await expect(page.locator('#welcome')).toBeHidden();
    await page.evaluate((p) => import('./scripts/editor.js').then((m) => m.closeTab(p)), file);
    await expect(page.locator('#welcome')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
