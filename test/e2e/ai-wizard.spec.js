const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, readSettings } = require('./helpers');
const { startFakeOpenAI } = require('./fake-openai');

async function startCustom(page, baseUrl) {
  await page.evaluate(() => { import('./scripts/ai-wizard.js').then((m) => m.openAIWizard()); });
  const wizard = page.locator('#ai-wizard-overlay');
  await wizard.locator('.ai-next').click();
  await wizard.locator('[data-preset="custom"]').click();
  await wizard.locator('.ai-next').click();
  await wizard.locator('#ai-base-url').fill(`${baseUrl}/v1`);
  await wizard.locator('#ai-api-key').fill('sk-teste');
  await wizard.locator('.ai-next').click();
  return wizard;
}

test('configura endpoint custom pelo wizard', async () => {
  const fake = await startFakeOpenAI();
  const { app, page, userData } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    const wizard = await startCustom(page, fake.baseUrl);
    await wizard.locator('#ai-model').selectOption('fake-1');
    await wizard.locator('.ai-next').click();
    await wizard.getByRole('button', { name: 'Testar conexão' }).click();
    await expect(wizard.locator('[role="status"]')).toContainText('2 modelos disponíveis');
    await wizard.locator('.ai-next').click();
    await wizard.locator('.ai-next').click();
    await wizard.locator('.ai-next').click();
    await expect(wizard).toBeHidden();
    expect(readSettings(userData).ai.profiles).toHaveLength(1);
    expect(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).not.toContain('sk-teste');
    await expect(page.locator('#status-ai')).toContainText('fake-1');
  } finally { await app.close(); await fake.close(); }
});

test('chave inválida mostra erro amigável', async () => {
  const fake = await startFakeOpenAI({ status: 401 });
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    const wizard = await startCustom(page, fake.baseUrl);
    await expect(wizard.locator('[role="status"]')).toContainText('Chave inválida ou sem permissão (401)');
  } finally { await app.close(); await fake.close(); }
});
