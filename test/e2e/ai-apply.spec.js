const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');
const { startFakeOpenAI } = require('./fake-openai');

test('refatora seleção, revisa diff e aplica sem salvar, com desfazer', async () => {
  const fake = await startFakeOpenAI({ reply: '```js\nconst soma = (a, b) => a + b;\n```' });
  const { app, page } = await launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } });
  try {
    await page.evaluate(async (url) => {
      await window.agzos.ai.saveProfile({ preset: 'custom', label: 'Fake', baseUrl: `${url}/v1`, model: 'fake-1' });
      window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
      await window.AgzosEditor.openFile('/workspace/a.js', 'function soma(a,b){return a+b}');
    }, fake.baseUrl);
    await expect(page.locator('#ai-chat')).toHaveCount(1);
    await expect(page.locator('.ai-pill-model')).toHaveText('fake-1');
    await page.evaluate(async () => {
      const { getActiveEditor } = await import('./scripts/editor.js');
      const editor = getActiveEditor();
      editor.setSelection(editor.getModel().getFullModelRange());
      await editor.getAction('agzos-ai.refactor').run();
    });
    await expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'send');
    await expect(page.locator('[data-code-action="apply"]')).toBeVisible();
    await page.locator('[data-code-action="apply"]').click();
    await expect(page.locator('.diff-overlay')).toBeVisible();
    await page.locator('.diff-actions button', { hasText: 'Aplicar' }).click();
    await expect.poll(() => page.evaluate(async () => (await import('./scripts/editor.js')).getActiveEditor().getValue())).toBe('const soma = (a, b) => a + b;');
    expect(await page.evaluate(() => window.AgzosState.files.get('/workspace/a.js').dirty)).toBe(true);
    await page.evaluate(async () => (await import('./scripts/editor.js')).getActiveEditor().getModel().undo());
    await expect.poll(() => page.evaluate(async () => (await import('./scripts/editor.js')).getActiveEditor().getValue())).toBe('function soma(a,b){return a+b}');
  } finally { await app.close(); await fake.close(); }
});
