const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const base = { welcomeSeen: true, onboardingCompleted: true };

// 3 itens: import não usado, comentário e console.log.
const DIRTY = "import { a } from './x';\n// comentário\nconsole.log('oi');\nexport const n = 1;\n";
const CLEAN = 'export const n = 1;\n';

async function setup({ files = {}, settings = {} } = {}) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-broom-e2e-')));
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

async function runCommand(page, label) {
  await page.keyboard.press('Control+Shift+P');
  await page.locator('#cmd-input').fill(`> ${label}`);
  await expect(page.locator('#cmd-list')).toContainText(label);
  await page.keyboard.press('Enter');
}

test('status bar mostra 🧹 3 para arquivo com 3 lixos e some com 0', async () => {
  const env = await setup({ files: { 'sujo.ts': DIRTY, 'limpo.ts': CLEAN, 'estilo.css': '/* x */' } });
  const { page } = env;
  try {
    const item = page.locator('#status-broom');
    await env.open('sujo.ts');
    await expect(item).toBeVisible();
    await expect(item).toHaveText('🧹 3');
    await env.open('limpo.ts');
    await expect(item).toBeHidden();
    await env.open('estilo.css');
    await expect(item).toBeHidden();
    await env.open('sujo.ts');
    await expect(item).toHaveText('🧹 3');
    expect(env.errors).toEqual([]);
  } finally { await env.close(); }
});

test('preview abre diff, Limpar aplica e Desfazer restaura', async () => {
  const env = await setup({ files: { 'sujo.ts': DIRTY } });
  const { page } = env;
  try {
    await env.open('sujo.ts');
    await expect(page.locator('#status-broom')).toHaveText('🧹 3');
    await page.locator('#status-broom').click();
    const dialog = page.locator('.diff-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toContainText('sujo.ts');
    await dialog.locator('button', { hasText: 'Limpar' }).click();
    await expect.poll(() => fs.readFileSync(env.file('sujo.ts'), 'utf8')).toBe(CLEAN);
    // O editor recarrega e o contador some.
    await expect.poll(() => page.evaluate(() => window.AgzosState.files.get(window.AgzosState.activePath).content)).toBe(CLEAN);
    await expect(page.locator('#status-broom')).toBeHidden();
    const undo = page.locator('.broom-undo-toast .broom-undo');
    await expect(undo).toBeVisible();
    await undo.click();
    await expect.poll(() => fs.readFileSync(env.file('sujo.ts'), 'utf8')).toBe(DIRTY);
    await expect(page.locator('#status-broom')).toHaveText('🧹 3');
  } finally { await env.close(); }
});

test('comando do arquivo atual e "Desfazer última limpeza" pela paleta', async () => {
  const env = await setup({ files: { 'sujo.js': DIRTY } });
  const { page } = env;
  try {
    await env.open('sujo.js');
    await expect(page.locator('#status-broom')).toHaveText('🧹 3');
    await runCommand(page, 'Agzos: Limpar Código de Produção (arquivo atual)');
    await page.locator('.diff-dialog button', { hasText: 'Limpar' }).click();
    await expect.poll(() => fs.readFileSync(env.file('sujo.js'), 'utf8')).toBe(CLEAN);
    await runCommand(page, 'Agzos: Desfazer última limpeza');
    await expect.poll(() => fs.readFileSync(env.file('sujo.js'), 'utf8')).toBe(DIRTY);
  } finally { await env.close(); }
});

test('arquivo sujo: Limpar pede para salvar e não altera o disco antes', async () => {
  const env = await setup({ files: { 'sujo.ts': DIRTY } });
  const { page } = env;
  try {
    await env.open('sujo.ts');
    await expect(page.locator('#status-broom')).toHaveText('🧹 3');
    await page.locator('#editor-host .monaco-editor').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('export const m = 2;\n');
    await expect.poll(() => page.evaluate(() => window.AgzosState.files.get(window.AgzosState.activePath).dirty)).toBe(true);

    await page.locator('#status-broom').click();
    const ask = page.locator('.broom-dirty');
    await expect(ask).toBeVisible();
    await expect(ask).toContainText('sujo.ts');
    await expect(page.locator('.diff-dialog')).toHaveCount(0);
    await ask.locator('button', { hasText: 'Cancelar' }).click();
    await expect(ask).toHaveCount(0);
    expect(fs.readFileSync(env.file('sujo.ts'), 'utf8')).toBe(DIRTY);

    // "Salvar e limpar": salva primeiro e então mostra o diff com o conteúdo salvo.
    await page.locator('#status-broom').click();
    await page.locator('.broom-dirty button', { hasText: 'Salvar e limpar' }).click();
    await expect(page.locator('.diff-dialog')).toBeVisible();
    expect(fs.readFileSync(env.file('sujo.ts'), 'utf8')).toBe(`${DIRTY}export const m = 2;\n`);
    await page.locator('.diff-dialog button', { hasText: 'Limpar' }).click();
    await expect.poll(() => fs.readFileSync(env.file('sujo.ts'), 'utf8')).toBe(`${CLEAN}export const m = 2;\n`);
    await expect.poll(() => page.evaluate(() => window.AgzosState.files.get(window.AgzosState.activePath).content))
      .toBe(`${CLEAN}export const m = 2;\n`);
  } finally { await env.close(); }
});

test('view do hub: analisar, desmarcar 1 arquivo, Limpar selecionados, toast Desfazer restaura', async () => {
  const env = await setup({
    files: {
      'src/a.ts': DIRTY,
      'src/b.js': '// x\nfoo();\n',
      'src/c.tsx': CLEAN,
      'node_modules/p/d.js': DIRTY,
    },
  });
  const { page } = env;
  try {
    await page.click('.activity-btn[data-view="modules"]');
    await page.locator('#panel-modules .module-card[data-module="broom"]').click();
    const view = page.locator('.module-view[data-module="broom"]');
    await view.locator('.broom-scan').click();
    const rows = view.locator('.broom-file');
    await expect(rows).toHaveCount(2);
    await expect(view.locator('.broom-file[data-path$="a.ts"] .broom-count')).toHaveText('−3');
    await expect(view.locator('.broom-file[data-path$="a.ts"] .broom-chip')).toHaveCount(3);
    await expect(view.locator('.broom-summary')).toContainText('2 arquivos');

    // badge no Explorer para os arquivos do scan
    await page.click('.activity-btn[data-view="explorer"]');
    await page.locator('.tree-row', { hasText: 'src' }).first().click();
    await expect(page.locator('.tree-row', { hasText: 'a.ts' }).locator('.tree-badge')).toHaveText('−3');
    await page.click('.activity-btn[data-view="modules"]');

    await view.locator('.broom-file[data-path$="b.js"] input[type="checkbox"]').uncheck();
    await view.locator('.broom-clean-selected').click();
    await expect.poll(() => fs.readFileSync(env.file('src/a.ts'), 'utf8')).toBe(CLEAN);
    expect(fs.readFileSync(env.file('src/b.js'), 'utf8')).toBe('// x\nfoo();\n');
    expect(fs.readFileSync(env.file('node_modules/p/d.js'), 'utf8')).toBe(DIRTY);
    await expect(rows).toHaveCount(1);

    const undo = page.locator('.broom-undo-toast .broom-undo');
    await expect(undo).toBeVisible();
    await undo.click();
    await expect.poll(() => fs.readFileSync(env.file('src/a.ts'), 'utf8')).toBe(DIRTY);
  } finally { await env.close(); }
});

test('clique no arquivo da lista abre o diff', async () => {
  const env = await setup({ files: { 'a.ts': DIRTY } });
  const { page } = env;
  try {
    await page.click('.activity-btn[data-view="modules"]');
    await page.locator('#panel-modules .module-card[data-module="broom"]').click();
    const view = page.locator('.module-view[data-module="broom"]');
    await view.locator('.broom-scan').click();
    await view.locator('.broom-file .broom-name').first().click();
    await expect(page.locator('.diff-dialog')).toBeVisible();
    await page.locator('.diff-dialog button', { hasText: 'Descartar' }).click();
    await expect(page.locator('.diff-dialog')).toHaveCount(0);
    expect(fs.readFileSync(env.file('a.ts'), 'utf8')).toBe(DIRTY);
  } finally { await env.close(); }
});

test('scan do workspace respeita Cancelar', async () => {
  const big = "console.log('x');\n".repeat(3000);
  const files = {};
  for (let i = 0; i < 300; i++) files[`f/${String(i).padStart(3, '0')}.js`] = big;
  const env = await setup({ files });
  const { page } = env;
  try {
    await page.click('.activity-btn[data-view="modules"]');
    await page.locator('#panel-modules .module-card[data-module="broom"]').click();
    const view = page.locator('.module-view[data-module="broom"]');
    await view.locator('.broom-scan').click();
    const cancel = view.locator('.broom-cancel');
    await expect(cancel).toBeVisible();
    await cancel.click();
    await expect(view.locator('.broom-summary')).toContainText('Cancelado', { timeout: 3000 });
    await expect(cancel).toBeHidden();
    await expect(view.locator('.broom-scan')).toBeEnabled();
  } finally { await env.close(); }
});

test('menu de contexto do Explorer: "Limpar código de produção" abre o preview', async () => {
  const env = await setup({ files: { 'a.js': DIRTY } });
  const { page } = env;
  try {
    await page.locator('.tree-row', { hasText: 'a.js' }).click({ button: 'right' });
    await page.locator('#context-menu li', { hasText: 'Limpar código de produção' }).click();
    await expect(page.locator('.diff-dialog')).toBeVisible();
    // Abrir o arquivo analisado também mostra o badge.
    await expect(page.locator('.tree-row', { hasText: 'a.js' }).locator('.tree-badge')).toHaveText('−3');
  } finally { await env.close(); }
});

test('statusBar=false esconde o item', async () => {
  const env = await setup({ files: { 'sujo.ts': DIRTY }, settings: { modules: { broom: { statusBar: false } } } });
  const { page } = env;
  try {
    await env.open('sujo.ts');
    await page.waitForTimeout(800);
    await expect(page.locator('#status-broom')).toBeHidden();
    // Ligar pelas Configurações (evento agzos:modules-settings) mostra o contador.
    await page.evaluate(() => {
      const modules = { ...window.AgzosState.settings.modules, broom: { ...window.AgzosState.settings.modules.broom, statusBar: true } };
      window.AgzosState.settings.modules = modules;
      window.dispatchEvent(new CustomEvent('agzos:modules-settings', { detail: { modules } }));
    });
    await expect(page.locator('#status-broom')).toHaveText('🧹 3');
  } finally { await env.close(); }
});
