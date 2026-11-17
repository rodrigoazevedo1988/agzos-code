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

test.describe('Agzos Marca-texto', () => {
  test('colore comentários por marcador e segue a lista das Configurações', async () => {
    const env = await setup({ files: { 'a.js': "// ! alerta\n// TODO: depois\n// comum\n//// velho\nconst x = 1;\n" } });
    const { page } = env;
    try {
      await env.open('a.js');
      const alert = page.locator('.view-lines span.agzos-hl', { hasText: 'alerta' });
      await expect(alert).toBeVisible({ timeout: 10000 });
      await expect(alert).toHaveCSS('color', 'rgb(255, 82, 82)');
      await expect(page.locator('.view-lines span.agzos-hl', { hasText: 'TODO' })).toHaveCSS('color', 'rgb(255, 152, 0)');
      await expect(page.locator('.view-lines span.agzos-hl', { hasText: 'velho' })).toHaveCSS('text-decoration-line', 'line-through');
      await expect(page.locator('.view-lines span.agzos-hl', { hasText: 'comum' })).toHaveCount(0);

      // Nova cor para "!" pelas Configurações (lista "marcador=#cor").
      await page.evaluate(() => import('./scripts/mods/common.js').then((m) => m.setModSetting('highlighter', 'tags', ['!=#00FF00'])));
      await expect(alert).toHaveCSS('color', 'rgb(0, 255, 0)');
      await expect(page.locator('.view-lines span.agzos-hl', { hasText: 'TODO' })).toHaveCount(0);

      await page.evaluate(() => import('./scripts/mods/common.js').then((m) => m.setModSetting('highlighter', 'enabled', false)));
      await expect(page.locator('.view-lines span.agzos-hl')).toHaveCount(0);
      expect(env.errors).toEqual([]);
    } finally { await env.close(); }
  });
});

test.describe('Agzos Formatador', () => {
  const value = (page) => page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
  const formatDoc = (page) => page.evaluate(() => import('./scripts/command-palette.js').then((m) => m.runCommand('editor.format')));

  test('"Formatar Documento" usa o prettier com a config do projeto (JS e Markdown)', async () => {
    const env = await setup({ files: { '.prettierrc': '{ "semi": false, "singleQuote": true }', 'a.js': 'const a = {b:1,c:"x"}\n', 'b.md': '# T\n* um\n* dois\n', 'c.css': 'a{color:red}' } });
    const { page } = env;
    try {
      await env.open('a.js');
      await formatDoc(page);
      await expect.poll(() => value(page)).toBe("const a = { b: 1, c: 'x' }\n");
      await env.open('b.md');
      await formatDoc(page);
      await expect.poll(() => value(page)).toBe('# T\n\n- um\n- dois\n');
      // CSS: o Prettier (com ";" e quebra final) vence o formatador embutido do Monaco.
      await env.open('c.css');
      await formatDoc(page);
      await expect.poll(() => value(page)).toBe('a {\n  color: red;\n}\n');
      expect(env.errors).toEqual([]);
    } finally { await env.close(); }
  });

  test('formatar ao salvar só na linguagem ligada', async () => {
    const env = await setup({
      files: { 'a.ts': 'let x=1\n', 'b.css': 'a{color:red}\n' },
      settings: { modules: { formatter: { enabled: true, formatOnSave: { typescript: true } } } },
    });
    const { page } = env;
    try {
      await env.open('a.ts');
      await page.evaluate(() => window.AgzosEditor.saveActive());
      await expect.poll(() => fs.readFileSync(env.file('a.ts'), 'utf8')).toBe('let x = 1;\n');
      await env.open('b.css');
      await page.evaluate(() => window.AgzosEditor.saveActive());
      await page.waitForTimeout(500);
      expect(fs.readFileSync(env.file('b.css'), 'utf8')).toBe('a{color:red}\n');
    } finally { await env.close(); }
  });

  test('projeto com prettier.config.js: ignorado com aviso e nada do projeto executa', async () => {
    const marker = path.join(os.tmpdir(), `agzos-e2e-prettier-pwned-${process.pid}`);
    const env = await setup({
      files: {
        'prettier.config.js': `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = { semi: false };`,
        'a.js': 'let a=1\n',
      },
    });
    const { page } = env;
    try {
      await env.open('a.js');
      await formatDoc(page);
      await expect.poll(() => value(page)).toBe('let a = 1;\n');
      await expect(page.locator('.toast', { hasText: 'prettier.config.js' })).toBeVisible();
      expect(fs.existsSync(marker)).toBe(false);
    } finally { await env.close(); }
  });

  test('desligado: volta ao formatador do Monaco', async () => {
    const env = await setup({ files: { 'a.md': '# T\n* um\n', 'c.css': 'a{color:red}' }, settings: { modules: { formatter: { enabled: false } } } });
    const { page } = env;
    try {
      await env.open('a.md');
      await formatDoc(page);
      await page.waitForTimeout(500);
      expect(await value(page)).toBe('# T\n* um\n');
      // CSS: formatador embutido do Monaco (sem o ";" que o Prettier acrescenta).
      await env.open('c.css');
      await formatDoc(page);
      await expect.poll(() => value(page)).toBe('a {\n  color: red\n}');
    } finally { await env.close(); }
  });
});
