const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');
const { startFakeOpenAI } = require('./fake-openai');

async function openChat(page, baseUrl) {
  await page.evaluate(async (url) => {
    await window.agzos.ai.saveProfile({ preset: 'custom', label: 'Fake', baseUrl: `${url}/v1`, model: 'fake-1' });
    window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
    document.querySelector('.activity-btn[data-view="ai"]').click();
  }, baseUrl);
  await expect(page.locator('#ai-chat')).toBeVisible();
}
async function send(page) {
  await page.locator('#ai-input').fill('Olá');
  await page.locator('#ai-send').click();
}

test('responde com streaming', async () => {
  const fake = await startFakeOpenAI();
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(page, fake.baseUrl);
    await send(page);
    await expect(page.locator('.ai-assistant')).toContainText('Olá do fake');
    await expect(page.locator('#ai-send')).toHaveText('Enviar');
  } finally { await app.close(); await fake.close(); }
});

test('parar interrompe', async () => {
  const fake = await startFakeOpenAI({ reply: 'resposta longa '.repeat(100) });
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(page, fake.baseUrl);
    await send(page);
    await expect(page.locator('.ai-assistant')).not.toBeEmpty();
    await page.locator('#ai-send').click();
    await expect(page.locator('.ai-assistant')).toContainText('(interrompida)');
  } finally { await app.close(); await fake.close(); }
});

test('html no markdown é sanitizado', async () => {
  const fake = await startFakeOpenAI({ reply: '<img src=x onerror="window.__xss=1">' });
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(page, fake.baseUrl);
    await send(page);
    await expect(page.locator('#ai-send')).toHaveText('Enviar');
    await expect(page.locator('.ai-assistant img')).toHaveCount(1);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('.ai-assistant img')).not.toHaveAttribute('onerror');
  } finally { await app.close(); await fake.close(); }
});

test('histórico persiste após reiniciar', async () => {
  const fake = await startFakeOpenAI();
  const first = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(first.page, fake.baseUrl);
    await send(first.page);
    await expect(first.page.locator('#ai-send')).toHaveText('Enviar');
    await expect.poll(async () => first.page.evaluate(() => window.agzos.chat.loadHistory(null))).toHaveLength(2);
    await first.app.close();
    const second = await launchApp({ userData: first.userData });
    try {
      await second.page.locator('.activity-btn[data-view="ai"]').click();
      await expect(second.page.locator('.ai-assistant')).toContainText('Olá do fake');
      await expect(second.page.locator('.ai-user')).toContainText('Olá');
    } finally { await second.app.close(); }
  } finally { await fake.close(); }
});

test('envia o contexto do arquivo aberto ao provider sem exibir como mensagem', async () => {
  const fake = await startFakeOpenAI();
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(page, fake.baseUrl);
    await page.evaluate(() => window.AgzosEditor.openFile('/workspace/segredo.js', 'const segredo = 42;'));
    await send(page);
    await expect(page.locator('.ai-assistant')).toContainText('Olá do fake');
    await expect.poll(() => fake.requests.length).toBeGreaterThan(0);
    expect(fake.requests.at(-1).body.messages[0]).toMatchObject({ role: 'system' });
    expect(fake.requests.at(-1).body.messages[0].content).toContain('const segredo = 42;');
    await expect(page.locator('.ai-user')).toHaveCount(1);
    await expect(page.locator('.ai-user')).not.toContainText('const segredo = 42;');
  } finally { await app.close(); await fake.close(); }
});
