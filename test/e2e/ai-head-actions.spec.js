const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');
const { startFakeOpenAI } = require('./fake-openai');

const READY = { welcomeSeen: true, onboardingCompleted: true };

async function openChat(page, baseUrl) {
  await page.evaluate(async (url) => {
    await window.agzos.ai.saveProfile({ preset: 'custom', label: 'Fake', baseUrl: `${url}/v1`, model: 'fake-1' });
    window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
    window.AgzosAiDock.show();
  }, baseUrl);
  await expect(page.locator('#ai-chat')).toBeVisible();
  await expect(page.locator('.ai-pill-model')).toHaveText('fake-1');
}
const idle = (page) => expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'send', { timeout: 15000 });

for (const position of ['left', 'right', 'bottom']) {
  test(`cabeçalho (${position}): "Nova conversa" limpa o fluxo e o relógio abre o histórico`, async () => {
    const fake = await startFakeOpenAI({ delayMs: 2 });
    const { app, page } = await launchApp({ settings: { ...READY, aiPanel: { position, visible: true } } });
    try {
      await openChat(page, fake.baseUrl);
      await page.evaluate((pos) => window.AgzosAiDock.setPosition(pos), position);
      await expect(page.locator('#ai-panel')).toHaveAttribute('data-position', position);
      await page.locator('#ai-input').fill('Olá');
      await page.locator('#ai-input').press('Enter');
      await expect(page.locator('.ai-assistant')).toContainText('Olá do fake');
      await idle(page);

      // Clique real (mouse), não dispatch: pega elemento coberto / região de arrasto.
      await page.locator('#ai-new-chat').click();
      await expect(page.locator('.ai-msg')).toHaveCount(0);
      await expect(page.locator('.ai-welcome')).toBeVisible();
      await expect(page.locator('#ai-input')).toBeFocused();
      // a conversa nova (vazia) virou a ativa e a anterior continua salva
      await expect.poll(() => page.evaluate(async () => {
        const h = await window.agzos.chat.loadHistory(null);
        return [h.conversations.length, h.conversations.find((c) => c.id === h.activeId)?.messages.length];
      })).toEqual([2, 0]);

      await page.locator('#ai-history-btn').click();
      await expect(page.locator('#ai-history')).toBeVisible();
      await expect(page.locator('#ai-history .ai-history-open', { hasText: 'Olá' })).toHaveCount(1);
    } finally { await app.close(); await fake.close(); }
  });
}

test('cabeçalho: "Nova conversa" e histórico funcionam com uma resposta em andamento', async () => {
  const fake = await startFakeOpenAI({ reply: 'resposta longa '.repeat(60), delayMs: 15 });
  const { app, page } = await launchApp({ settings: READY });
  try {
    await openChat(page, fake.baseUrl);
    await page.locator('#ai-input').fill('Pergunta lenta');
    await page.locator('#ai-input').press('Enter');
    await expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'stop');
    await expect(page.locator('#ai-new-chat')).toBeEnabled();
    await page.locator('#ai-new-chat').click();
    await expect(page.locator('.ai-welcome')).toBeVisible();
    await page.locator('#ai-history-btn').click();
    await expect(page.locator('#ai-history')).toBeVisible();
    // a resposta segue na conversa dela e termina lá
    await page.locator('.ai-history-open', { hasText: 'Pergunta lenta' }).click();
    await expect(page.locator('.ai-assistant')).toContainText('resposta longa');
    await idle(page);
    await expect.poll(() => page.evaluate(async () => {
      const h = await window.agzos.chat.loadHistory(null);
      const c = h.conversations.find((x) => x.title === 'Pergunta lenta');
      return c?.messages.at(-1).content.length || 0;
    })).toBeGreaterThan(500);
  } finally { await app.close(); await fake.close(); }
});
