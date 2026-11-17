/**
 * Ctrl+Q / Arquivo › Sair pede confirmação (diálogo nativo stubado via app.evaluate).
 */
const { test, expect } = require('@playwright/test');
const { launchApp, readSettings } = require('./helpers');

const SETTINGS = { welcomeSeen: true, onboardingCompleted: true };

// Substitui dialog.showMessageBox: grava as opções e responde { response, checkboxChecked }.
async function stubDialog(app, answer) {
  await app.evaluate(({ dialog }, a) => {
    global.__quitDialogs = [];
    dialog.showMessageBox = async (win, opts) => {
      global.__quitDialogs.push(opts || win);
      return a;
    };
  }, answer);
}
const dialogs = (app) => app.evaluate(() => global.__quitDialogs);
const mainCount = (app) => app.windows().filter((w) => w.url().endsWith('renderer/index.html')).length;

test('Ctrl+Q: Cancelar mantém o app aberto', async () => {
  const { app, page, errors } = await launchApp({ settings: SETTINGS });
  try {
    await stubDialog(app, { response: 1, checkboxChecked: false });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+q');
    await expect.poll(async () => (await dialogs(app)).length).toBe(1);
    const [opts] = await dialogs(app);
    expect(opts.message).toBe('Sair do Agzos Code?');
    expect(opts.buttons).toEqual(['Sair', 'Cancelar']);
    expect(opts.defaultId).toBe(1);
    expect(opts.checkboxLabel).toBe('Não perguntar novamente');
    await page.waitForTimeout(500);
    expect(mainCount(app)).toBe(1);
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Arquivo › Sair: Sair fecha o app', async () => {
  const { app, page } = await launchApp({ settings: SETTINGS });
  let closed = false;
  try {
    await stubDialog(app, { response: 0, checkboxChecked: false });
    const done = app.waitForEvent('close', { timeout: 15000 }).then(() => { closed = true; });
    await page.locator('#menubar .mb-title', { hasText: 'Arquivo' }).click();
    await page.locator('.mb-dropdown .mb-item[data-id="file.exit"]').click().catch(() => {});
    await done;
    expect(closed).toBe(true);
  } finally {
    if (!closed) await app.close();
  }
});

test('"Não perguntar novamente" grava window.confirmBeforeQuit: false e sai', async () => {
  const { app, page, userData } = await launchApp({ settings: SETTINGS });
  let closed = false;
  try {
    await stubDialog(app, { response: 0, checkboxChecked: true });
    const done = app.waitForEvent('close', { timeout: 15000 }).then(() => { closed = true; });
    await page.evaluate(() => window.agzos.window.quit()).catch(() => {});
    await done;
    expect(readSettings(userData).window.confirmBeforeQuit).toBe(false);
  } finally {
    if (!closed) await app.close();
  }
  // Próxima vez: sai sem perguntar
  const second = await launchApp({ userData });
  let closed2 = false;
  try {
    await stubDialog(second.app, { response: 1, checkboxChecked: false });
    const done = second.app.waitForEvent('close', { timeout: 15000 }).then(() => { closed2 = true; });
    await second.page.evaluate(() => window.agzos.window.quit()).catch(() => {});
    await done;
    expect(closed2).toBe(true);
  } finally {
    if (!closed2) await second.app.close();
  }
});

test('Fechar Janela com 2 janelas não pergunta', async () => {
  const { app, page } = await launchApp({ settings: SETTINGS });
  try {
    await stubDialog(app, { response: 1, checkboxChecked: false });
    await page.evaluate(() => window.agzos.window.newWindow());
    await expect.poll(() => mainCount(app), { timeout: 15000 }).toBe(2);
    const page2 = app.windows().filter((w) => w.url().endsWith('renderer/index.html')).find((w) => w !== page);
    await page2.waitForFunction(() => !!window.AgzosEditor, null, { timeout: 15000 });
    await page2.evaluate(() => window.agzos.window.close());
    await expect.poll(() => mainCount(app)).toBe(1);
    expect(await dialogs(app)).toEqual([]);
  } finally {
    await app.close();
  }
});

test('com arquivo não salvo: uma pergunta só, avisando a perda', async () => {
  const { app, page } = await launchApp({ settings: { ...SETTINGS, window: { confirmBeforeQuit: false } } });
  try {
    await stubDialog(app, { response: 1, checkboxChecked: false });
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+n');
    await expect(page.locator('#tabs .tab.active')).toContainText('Sem título-1');
    await page.evaluate(() => {
      const ed = window.monaco.editor.getEditors()[0];
      ed.setValue('rascunho');
    });
    await expect.poll(() => page.evaluate(() => [...window.AgzosState.files.values()].some((f) => f.dirty))).toBe(true);
    await page.evaluate(() => window.agzos.window.quit());
    const all = await dialogs(app);
    expect(all.length).toBe(1);
    expect(all[0].buttons).toEqual(['Sair sem salvar', 'Cancelar']);
    expect(all[0].detail).toContain('1 arquivo com alterações não salvas');
    expect(mainCount(app)).toBe(1);
  } finally {
    await app.close();
  }
});
