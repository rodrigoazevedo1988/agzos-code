const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');
const { startFakeOpenAI } = require('./fake-openai');

async function openChat(page, baseUrl) {
  await page.evaluate(async (url) => {
    await window.agzos.ai.saveProfile({ preset: 'custom', label: 'Fake', baseUrl: `${url}/v1`, model: 'fake-1' });
    window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
    if (window.AgzosAiDock) window.AgzosAiDock.show();
    else document.querySelector('.activity-btn[data-view="ai"]').click();
  }, baseUrl);
  await expect(page.locator('#ai-chat')).toBeVisible();
  await expect(page.locator('.ai-pill-model')).toHaveText('fake-1');
}
const idle = (page) => expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'send');
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
    await idle(page);
  } finally { await app.close(); await fake.close(); }
});

test('parar interrompe', async () => {
  const fake = await startFakeOpenAI({ reply: 'resposta longa '.repeat(100) });
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(page, fake.baseUrl);
    await send(page);
    await expect(page.locator('.ai-assistant .ai-prose p')).not.toBeEmpty();
    await expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'stop');
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
    await idle(page);
    await expect(page.locator('.ai-assistant .ai-prose img')).toHaveCount(1);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('.ai-assistant .ai-prose img')).not.toHaveAttribute('onerror');
  } finally { await app.close(); await fake.close(); }
});

test('histórico persiste após reiniciar', async () => {
  const fake = await startFakeOpenAI();
  const first = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(first.page, fake.baseUrl);
    await send(first.page);
    await idle(first.page);
    await expect.poll(async () => first.page.evaluate(async () => {
      const history = await window.agzos.chat.loadHistory(null);
      return history.conversations.find((c) => c.id === history.activeId)?.messages.length;
    })).toBe(2);
    await first.app.close();
    const second = await launchApp({ userData: first.userData });
    try {
      await second.page.evaluate(() => {
        if (window.AgzosAiDock) window.AgzosAiDock.show();
        else document.querySelector('.activity-btn[data-view="ai"]').click();
      });
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

test('Enter envia e Shift+Enter quebra linha', async () => {
  const fake = await startFakeOpenAI();
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(page, fake.baseUrl);
    const input = page.locator('#ai-input');
    await input.click();
    await input.type('linha 1');
    await input.press('Shift+Enter');
    await input.type('linha 2');
    await expect(input).toHaveValue('linha 1\nlinha 2');
    await expect(page.locator('.ai-user')).toHaveCount(0);
    await input.press('Enter');
    await expect(page.locator('.ai-user .ai-bubble')).toHaveText('linha 1\nlinha 2');
    await expect(input).toHaveValue('');
    await idle(page);
    await expect(page.locator('.ai-assistant')).toContainText('Olá do fake');
  } finally { await app.close(); await fake.close(); }
});

test('com sendKey ctrlEnter, Enter quebra linha e Ctrl+Enter envia', async () => {
  const fake = await startFakeOpenAI();
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true, aiPanel: { sendKey: 'ctrlEnter' } } });
  try {
    await openChat(page, fake.baseUrl);
    const input = page.locator('#ai-input');
    await input.click();
    await input.type('a');
    await input.press('Enter');
    await input.type('b');
    await expect(input).toHaveValue('a\nb');
    await expect(page.locator('.ai-user')).toHaveCount(0);
    await input.press('Control+Enter');
    await expect(page.locator('.ai-user')).toHaveCount(1);
    await expect(page.locator('#ai-hint')).toContainText('Ctrl');
  } finally { await app.close(); await fake.close(); }
});

test('sugestão do estado vazio envia a mensagem', async () => {
  const fake = await startFakeOpenAI();
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(page, fake.baseUrl);
    await expect(page.locator('.ai-suggestion')).toHaveCount(4);
    await page.locator('.ai-suggestion', { hasText: 'Encontrar bugs' }).click();
    await expect(page.locator('.ai-user')).toContainText('bugs');
    await expect(page.locator('.ai-assistant')).toContainText('Olá do fake');
    await expect(page.locator('.ai-suggestion')).toHaveCount(0);
  } finally { await app.close(); await fake.close(); }
});

test('nova conversa e volta pela lista de conversas', async () => {
  const fake = await startFakeOpenAI();
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await openChat(page, fake.baseUrl);
    await page.locator('#ai-input').fill('Primeira pergunta');
    await page.locator('#ai-input').press('Enter');
    await idle(page);
    await expect(page.locator('.ai-assistant')).toContainText('Olá do fake');
    await page.locator('#ai-new-chat').click();
    await expect(page.locator('.ai-msg')).toHaveCount(0);
    await expect(page.locator('.ai-welcome')).toBeVisible();
    await expect(page.locator('#ai-input')).toBeFocused();
    await page.locator('#ai-input').fill('Segunda pergunta');
    await page.locator('#ai-input').press('Enter');
    await idle(page);
    await page.locator('#ai-history-btn').click();
    await expect(page.locator('#ai-history')).toBeVisible();
    await expect(page.locator('.ai-history-open')).toHaveCount(2);
    await expect(page.locator('.ai-history-item.is-active')).toContainText('Segunda pergunta');
    await page.locator('.ai-history-open', { hasText: 'Primeira pergunta' }).click();
    await expect(page.locator('#ai-history')).toBeHidden();
    await expect(page.locator('.ai-user')).toHaveText('Primeira pergunta');
    await expect.poll(() => page.evaluate(async () => (await window.agzos.chat.loadHistory(null)).conversations.length)).toBe(2);
    // apagar a conversa ativa volta para a outra
    await page.locator('#ai-history-btn').click();
    await page.locator('.ai-history-item.is-active .ai-history-delete').click();
    await page.locator('.ai-history-confirm-yes').click();
    await expect(page.locator('.ai-history-open')).toHaveCount(1);
    await expect.poll(() => page.evaluate(async () => (await window.agzos.chat.loadHistory(null)).conversations.length)).toBe(1);
  } finally { await app.close(); await fake.close(); }
});

test('erro do provider aparece inline com tentar de novo', async () => {
  const fake = await startFakeOpenAI({ status: 500 });
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await page.evaluate(async (url) => {
      await window.agzos.ai.saveProfile({ preset: 'custom', label: 'Fake', baseUrl: `${url}/v1`, model: 'fake-1' });
      window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
      if (window.AgzosAiDock) window.AgzosAiDock.show();
      else document.querySelector('.activity-btn[data-view="ai"]').click();
    }, fake.baseUrl);
    await expect(page.locator('#ai-chat')).toBeVisible();
    await send(page);
    await expect(page.locator('#ai-error')).toBeVisible();
    await expect(page.locator('.ai-assistant')).toHaveCount(0);
    const before = fake.requests.filter((r) => r.path === '/v1/chat/completions').length;
    await page.locator('.ai-retry').click();
    await expect.poll(() => fake.requests.filter((r) => r.path === '/v1/chat/completions').length).toBe(before + 1);
    await expect(page.locator('.ai-user')).toHaveCount(1);
  } finally { await app.close(); await fake.close(); }
});

test('personalização da Agzos IA aplica ao vivo e persiste', async () => {
  const { app, page, userData } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  const { readSettings } = require('./helpers');
  try {
    await page.evaluate(async () => (await import('./scripts/settings-modal.js')).openSettingsModal('ai'));
    const panel = page.locator('#ai-panel');
    const size = page.locator('.setting-item-row[data-key="aiPanel.fontSize"] input');
    await size.fill('16');
    await size.dispatchEvent('change');
    await expect.poll(() => panel.evaluate((el) => el.style.getPropertyValue('--ai-fs'))).toBe('16px');
    await page.locator('.setting-item-row[data-key="aiPanel.density"] select').selectOption('compact');
    await expect(panel).toHaveAttribute('data-density', 'compact');
    await page.locator('.setting-item-row[data-key="aiPanel.showAvatars"] input').uncheck();
    await expect(panel).toHaveClass(/no-avatars/);
    await page.locator('.setting-item-row[data-key="aiPanel.sendKey"] select').selectOption('ctrlEnter');
    await expect(page.locator('#ai-hint')).toContainText('Ctrl');
    await page.locator('.setting-item-row[data-key="aiPanel.position"] select').selectOption('bottom');
    await expect(panel).toHaveAttribute('data-position', 'bottom');
    await expect.poll(() => readSettings(userData).aiPanel).toMatchObject({ fontSize: 16, density: 'compact', showAvatars: false, sendKey: 'ctrlEnter', position: 'bottom' });
  } finally { await app.close(); }
});
