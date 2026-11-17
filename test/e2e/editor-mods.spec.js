// Módulos de editor da 1.2.0: Erros na Linha, Erros Claros, Marca-texto e Formatador.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const base = { welcomeSeen: true, onboardingCompleted: true };

async function setup({ files = {}, settings = {} } = {}) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-editor-mods-e2e-')));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true });
    fs.writeFileSync(path.join(workspace, name), content);
  }
  const launched = await launchApp({ settings: { ...base, ...settings } });
  const { app, page } = launched;
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), workspace);
  await page.evaluate((d) => import('./scripts/file-tree.js').then((m) => m.openWorkspace(d)), workspace);
  const open = (rel) => page.evaluate((p) => window.AgzosEditor.openFile(p), path.join(workspace, rel));
  const close = async () => { await app.close(); fs.rmSync(workspace, { recursive: true, force: true }); };
  return { ...launched, workspace, open, close, file: (rel) => path.join(workspace, rel) };
}

async function openModuleCard(page, id) {
  await page.click('.activity-btn[data-view="modules"]');
  await page.locator(`#panel-modules .module-card[data-module="${id}"]`).click();
  return page.locator(`#panel-modules .module-view[data-module="${id}"]`);
}

const TS_ERROR = "const n: number = 'texto';\nexport { n };\n";

test.describe('Agzos Erros na Linha', () => {
  test('mostra a mensagem do erro no fim da linha e some ao desligar', async () => {
    const env = await setup({ files: { 'erro.ts': TS_ERROR } });
    const { page } = env;
    try {
      await env.open('erro.ts');
      const deco = page.locator('.monaco-editor .view-lines .agzos-inline-error-error');
      await expect(deco).toBeVisible({ timeout: 15000 });
      await expect(deco).toContainText("not assignable to type 'number'");

      const view = await openModuleCard(page, 'inlineErrors');
      const toggle = view.locator('input.mod-enabled-toggle');
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      await expect(deco).toHaveCount(0);
      await toggle.check();
      await expect(deco).toBeVisible();
      expect(env.errors).toEqual([]);
    } finally { await env.close(); }
  });

  test('só a linha do cursor quando a opção está ligada', async () => {
    const env = await setup({
      files: { 'dois.ts': "const a: number = 'x';\n\n\nconst b: string = 1;\nexport { a, b };\n" },
      settings: { modules: { inlineErrors: { enabled: true, severities: ['error'], onlyCursorLine: true } } },
    });
    const { page } = env;
    try {
      await env.open('dois.ts');
      const deco = page.locator('.monaco-editor .view-lines .agzos-inline-error-error');
      await expect(deco).toHaveCount(1, { timeout: 15000 });
      await expect(deco).toContainText("type 'number'");
      await page.evaluate(() => {
        const ed = window.monaco.editor.getEditors()[0];
        ed.setPosition({ lineNumber: 4, column: 1 });
      });
      await expect(deco).toHaveCount(1);
      await expect(deco).toContainText("type 'string'");
    } finally { await env.close(); }
  });
});

test.describe('Agzos Erros Claros', () => {
  const LONG = "interface User { name: string }\nconst u: User = { name: 'a', age: 3, extra: { a: 1, b: 2, c: 3 } };\nexport { u };\n";

  test('hover mostra a mensagem formatada com link do código do erro', async () => {
    const env = await setup({ files: { 'erro.ts': TS_ERROR } });
    const { page } = env;
    try {
      await env.open('erro.ts');
      await expect(page.locator('.monaco-editor .agzos-inline-error-error')).toBeVisible({ timeout: 15000 });
      await page.evaluate(() => {
        const ed = window.monaco.editor.getEditors()[0];
        ed.setPosition({ lineNumber: 1, column: 8 });
        ed.focus();
        ed.trigger('e2e', 'editor.action.showHover', {});
      });
      const hover = page.locator('.monaco-hover .agzos-pretty-error, .monaco-hover a[data-href*="typescript.tv/errors/#ts2322"]').first();
      await expect(hover).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.monaco-hover')).toContainText('TS2322');
      expect(env.errors).toEqual([]);
    } finally { await env.close(); }
  });

  test('painel Problemas lista os erros do arquivo, formatados e com link', async () => {
    const env = await setup({ files: { 'longo.ts': LONG } });
    const { page } = env;
    try {
      await env.open('longo.ts');
      await page.evaluate(() => import('./scripts/terminal.js').then((m) => { m.setBottomPanelVisible(true); m.selectBottomTab('problems'); }));
      const item = page.locator('#pane-problems .problem-item').first();
      await expect(item).toBeVisible({ timeout: 15000 });
      await expect(item).toContainText('longo.ts');
      await expect(item.locator('a.problem-code')).toHaveAttribute('href', /typescript\.tv\/errors\/#ts2353/);
      // Trecho de tipo realçado pelo monaco.editor.colorize.
      await expect(item.locator('.problem-type').first()).toBeVisible();
      await expect(item.locator('.problem-type span[class*="mtk"]').first()).toBeAttached();

      // Desligado: mensagem crua, sem link.
      await page.evaluate(() => import('./scripts/mods/common.js').then((m) => m.setModSetting('prettyErrors', 'enabled', false)));
      await expect(page.locator('#pane-problems a.problem-code')).toHaveCount(0);
      await expect(page.locator('#pane-problems .problem-item').first()).toContainText("Object literal may only specify known properties");
    } finally { await env.close(); }
  });
});
