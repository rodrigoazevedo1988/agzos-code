const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

test('terminal abre sem conflito AMD e executa um comando', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await page.locator('#btn-toggle-terminal').click();
    await expect(page.locator('.xterm')).toBeVisible();
    expect(await page.locator('#fatal-overlay').count()).toBe(0);

    await page.waitForFunction(() => !!window.AgzosState.term?.term, null, { timeout: 10000 });
    await page.evaluate(() => window.AgzosState.term.term.focus());
    await page.keyboard.type('echo agzos-42');
    await page.keyboard.press('Enter');

    await expect.poll(async () => page.evaluate(() => {
      const t = window.AgzosState.term.term;
      const buffer = t.buffer.active;
      let out = '';
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) out += line.translateToString(true) + '\n';
      }
      return out;
    })).toContain('agzos-42');

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
