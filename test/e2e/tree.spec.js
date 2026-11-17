const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const base = { welcomeSeen: true, onboardingCompleted: true };

async function setup({ settings = {} } = {}) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-tree-e2e-')));
  const files = {
    '.gitignore': 'node_modules/\n*.log\n',
    'node_modules/pkg/index.js': '',
    'debug.log': '',
    'src/lib/util.js': '',
    'src/app.js': 'const x = 1;\n',
    'README.md': '# Projeto\n',
  };
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true });
    fs.writeFileSync(path.join(workspace, name), content);
  }
  const launched = await launchApp({ settings: { ...base, ...settings } });
  const { app, page } = launched;
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), workspace);
  await page.evaluate((d) => import('./scripts/file-tree.js').then((m) => m.openWorkspace(d)), workspace);
  const close = async () => { await app.close(); fs.rmSync(workspace, { recursive: true, force: true }); };
  return { ...launched, workspace, close };
}

async function runCommand(page, label) {
  await page.keyboard.press('Control+Shift+P');
  await page.locator('#cmd-input').fill(`> ${label}`);
  await expect(page.locator('#cmd-list')).toContainText(label);
  await page.keyboard.press('Enter');
}

const SRC_TREE = 'src/\n├── lib/\n│   └── util.js\n└── app.js';

test('menu de contexto da pasta abre a prévia e Copiar põe a árvore na área de transferência', async () => {
  const env = await setup();
  const { page, app } = env;
  try {
    await page.locator('.tree-row', { hasText: 'src' }).first().click({ button: 'right' });
    await page.locator('#context-menu li', { hasText: 'Gerar árvore (Agzos Árvore)' }).click();
    const dialog = page.locator('.tree-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.tree-preview')).toHaveText(SRC_TREE);
    await dialog.locator('button', { hasText: 'Copiar' }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(SRC_TREE);
    expect(env.errors).toEqual([]);
  } finally { await env.close(); }
});

test('opções mudam a prévia e Criar ARVORE.md grava na pasta', async () => {
  const env = await setup();
  const { page, workspace } = env;
  try {
    await runCommand(page, 'Agzos Árvore: Gerar árvore do projeto');
    const dialog = page.locator('.tree-dialog');
    const preview = dialog.locator('.tree-preview');
    await expect(preview).toContainText('README.md');
    await expect(preview).not.toContainText('node_modules');
    await expect(preview).not.toContainText('debug.log');
    await dialog.getByLabel('Respeitar .gitignore').uncheck();
    await expect(preview).toContainText('node_modules/');
    await expect(preview).toContainText('debug.log');
    await dialog.getByLabel('Só pastas').check();
    await expect(preview).not.toContainText('README.md');
    await dialog.getByLabel('Só pastas').uncheck();
    await dialog.getByLabel('Respeitar .gitignore').check();
    await dialog.getByLabel('Profundidade').fill('1');
    await expect(preview).not.toContainText('util.js');
    await dialog.locator('button', { hasText: 'Criar ARVORE.md' }).click();
    const file = path.join(workspace, 'ARVORE.md');
    await expect.poll(() => fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('```text\n');
    expect(text).toContain('├── src/');
    expect(text).not.toContain('util.js');
    await expect(dialog).toBeHidden();
  } finally { await env.close(); }
});

test('Inserir no cursor coloca a árvore no editor ativo', async () => {
  const env = await setup();
  const { page, workspace } = env;
  try {
    await page.evaluate((p) => window.AgzosEditor.openFile(p), path.join(workspace, 'README.md'));
    await page.locator('.tree-row', { hasText: 'src' }).first().click({ button: 'right' });
    await page.locator('#context-menu li', { hasText: 'Gerar árvore (Agzos Árvore)' }).click();
    const dialog = page.locator('.tree-dialog');
    await expect(dialog.locator('.tree-preview')).toHaveText(SRC_TREE);
    await dialog.locator('button', { hasText: 'Inserir no cursor' }).click();
    await expect.poll(() => page.evaluate(() => window.AgzosState.files.get(window.AgzosState.activePath).content))
      .toContain('│   └── util.js');
  } finally { await env.close(); }
});

test('módulo desabilitado: sem item no menu de contexto e card desabilitado no hub', async () => {
  const env = await setup({ settings: { modules: { tree: { enabled: false } } } });
  const { page } = env;
  try {
    await page.locator('.tree-row', { hasText: 'src' }).first().click({ button: 'right' });
    await expect(page.locator('#context-menu')).toBeVisible();
    await expect(page.locator('#context-menu li', { hasText: 'Agzos Árvore' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+X');
    const card = page.locator('.module-card[data-module="tree"]');
    await expect(card.locator('.module-card-status')).toHaveText('Desabilitado');
    // Liga pelo card (view do módulo) e o item volta ao menu.
    await card.click();
    await page.locator('.module-view[data-module="tree"]').getByLabel('Módulo habilitado').check();
    await page.locator('.tree-row', { hasText: 'src' }).first().click({ button: 'right' });
    await expect(page.locator('#context-menu li', { hasText: 'Gerar árvore (Agzos Árvore)' })).toBeVisible();
  } finally { await env.close(); }
});
