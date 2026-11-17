const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');

const SETTINGS = { welcomeSeen: true, onboardingCompleted: true };
const MENUS = ['Arquivo', 'Editar', 'Seleção', 'Ver', 'Ir', 'Executar', 'Terminal', 'Ajuda'];

function tmpDir(prefix, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

async function openWorkspace(app, page, dir) {
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), dir);
  await page.evaluate(async (d) => {
    const mod = await import('./scripts/file-tree.js');
    await mod.openWorkspace(d);
  }, dir);
}

const title = (page, label) => page.locator('#menubar .mb-title', { hasText: label });
const dropdown = (page) => page.locator('#menubar-dropdown');
const item = (page, id) => page.locator(`.mb-dropdown .mb-item[data-id="${id}"]`);

test('barra de menus: 8 menus, clique abre, hover troca, Esc e clique fora fecham', async () => {
  const { app, page, errors } = await launchApp({ settings: SETTINGS });
  try {
    await expect(page.locator('#menubar')).toBeVisible();
    await expect(page.locator('#menubar .mb-title')).toHaveText(MENUS);

    // O topbar é área de arrastar; os títulos não
    const regions = await page.evaluate(() => ({
      topbar: getComputedStyle(document.getElementById('topbar')).webkitAppRegion,
      title: getComputedStyle(document.querySelector('#menubar .mb-title')).webkitAppRegion,
    }));
    expect(regions).toEqual({ topbar: 'drag', title: 'no-drag' });

    await title(page, 'Arquivo').click();
    await expect(dropdown(page)).toBeVisible();
    await expect(item(page, 'file.newWindow')).toContainText('Nova Janela');
    await expect(item(page, 'file.newWindow').locator('.mb-accel')).toHaveText('Ctrl+Shift+N');

    // Com um menu aberto, passar o mouse por outro título troca de menu
    await title(page, 'Editar').hover();
    await expect(item(page, 'edit.undo')).toBeVisible();
    await expect(item(page, 'file.newWindow')).toHaveCount(0);
    await expect(title(page, 'Editar')).toHaveClass(/open/);

    await page.keyboard.press('Escape');
    await expect(dropdown(page)).toHaveCount(0);

    await title(page, 'Ver').click();
    await expect(dropdown(page)).toBeVisible();
    await page.mouse.click(700, 500);
    await expect(dropdown(page)).toHaveCount(0);

    // Todo item com comando da paleta aponta para um comando que existe
    const missing = await page.evaluate(async () => {
      const { allItems } = await import('./scripts/menu-model.js');
      const { hasCommand } = await import('./scripts/command-palette.js');
      return allItems().filter((i) => typeof i.run === 'string' && !i.run.startsWith('monaco:') && !hasCommand(i.run)).map((i) => i.run);
    });
    expect(missing).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('teclado: Alt foca, setas navegam, Alt+letra abre, Esc fecha', async () => {
  const { app, page } = await launchApp({ settings: SETTINGS });
  try {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Alt');
    await expect(page.locator('#menubar .mb-title.focused')).toHaveText('Arquivo');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#menubar .mb-title.focused')).toHaveText('Editar');
    await page.keyboard.press('ArrowDown');
    await expect(item(page, 'edit.undo')).toHaveClass(/active/);
    await page.keyboard.press('ArrowDown');
    await expect(item(page, 'edit.redo')).toHaveClass(/active/);
    // → num item sem submenu vai para o próximo menu
    await page.keyboard.press('ArrowRight');
    await expect(title(page, 'Seleção')).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(dropdown(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);

    // Alt+V abre Ver; → num item com submenu abre o submenu
    await page.keyboard.press('Alt+v');
    await expect(title(page, 'Ver')).toHaveClass(/open/);
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown'); // Paleta → Abrir Visualização → Aparência
    await expect(item(page, 'view.appearance')).toHaveClass(/active/);
    await page.keyboard.press('ArrowRight');
    await expect(item(page, 'view.fullScreen')).toHaveClass(/active/);
    await page.keyboard.press('ArrowLeft');
    await expect(item(page, 'view.fullScreen')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(dropdown(page)).toHaveCount(0);

    // Alt dentro do terminal não é roubado
    await page.evaluate(() => {
      const fake = document.createElement('div');
      fake.className = 'xterm';
      const ta = document.createElement('textarea');
      ta.id = 'fake-xterm-input';
      fake.append(ta);
      document.body.append(fake);
      ta.focus();
    });
    await page.keyboard.press('Alt+a');
    await page.keyboard.press('Alt');
    await expect(dropdown(page)).toHaveCount(0);
    await expect(page.locator('#menubar .mb-title.focused')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('item Em breve fica desabilitado, com selo, e não executa', async () => {
  const { app, page, errors } = await launchApp({ settings: SETTINGS });
  try {
    await title(page, 'Executar').click();
    const soon = item(page, 'run.startDebugging');
    await expect(soon).toHaveClass(/coming-soon/);
    await expect(soon).toHaveAttribute('aria-disabled', 'true');
    await expect(soon.locator('.mb-soon')).toHaveText('Em breve');
    await expect(soon).toHaveAttribute('title', /Em breve/);
    await soon.click({ force: true }); // aria-disabled: o Playwright esperaria habilitar
    // Não fecha nem executa nada
    await expect(dropdown(page)).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Ver › Terminal abre o terminal; Seleção › Selecionar Tudo seleciona no editor', async () => {
  const { app, page, errors } = await launchApp({ settings: SETTINGS });
  try {
    const dir = tmpDir('agzos-menu-', { 'a.txt': 'linha 1\nlinha 2\nlinha 3' });
    await openWorkspace(app, page, dir);

    // Sem editor ativo: Selecionar Tudo desabilitado
    await title(page, 'Seleção').click();
    await expect(item(page, 'selection.selectAll')).toHaveClass(/disabled/);
    await page.keyboard.press('Escape');

    await page.evaluate((p) => window.AgzosEditor.openFile(p), path.join(dir, 'a.txt'));
    await title(page, 'Seleção').click();
    await item(page, 'selection.selectAll').click();
    await expect(dropdown(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => {
      const { getActiveEditor } = await import('./scripts/editor.js');
      const ed = getActiveEditor();
      return ed.getModel().getValueInRange(ed.getSelection());
    })).toBe('linha 1\nlinha 2\nlinha 3');

    await expect(page.locator('#bottom-panel')).toBeHidden();
    await title(page, 'Ver').click();
    await item(page, 'view.terminal').click();
    await expect(page.locator('#bottom-panel')).toBeVisible();
    await expect(page.locator('#bottom-panel .bottom-tab.active')).toHaveAttribute('data-tab', 'terminal');
    await expect(page.locator('#terminal-host .xterm').first()).toBeVisible({ timeout: 15000 });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Terminal › Executar Tarefa lista os scripts do package.json e roda o escolhido', async () => {
  const { app, page, errors } = await launchApp({ settings: SETTINGS });
  try {
    const pkg = { name: 'fixture', scripts: { hello: 'node -e "console.log(\'ola-da-tarefa\')"', build: 'echo build' } };
    const dir = tmpDir('agzos-task-', { 'package.json': JSON.stringify(pkg) });
    await openWorkspace(app, page, dir);

    await title(page, 'Terminal').click();
    await item(page, 'terminal.menu.runTask').click();
    await expect(page.locator('#cmd-overlay')).toBeVisible();
    await expect(page.locator('#cmd-list li')).toHaveCount(2);
    await expect(page.locator('#cmd-list li').first()).toContainText('hello');
    await page.locator('#cmd-list li', { hasText: 'hello' }).click();
    await expect(page.locator('#bottom-panel')).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const m = await import('./scripts/terminal.js');
      return m.getRecentOutput(20000);
    }), { timeout: 20000 }).toContain('ola-da-tarefa');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Arquivo › Nova Janela abre uma 2ª janela independente, cada uma com sua pasta', async () => {
  const { app, page, errors } = await launchApp({ settings: SETTINGS });
  try {
    const dirA = tmpDir('agzos-win-a-', { 'a.txt': 'A' });
    const dirB = tmpDir('agzos-win-b-', { 'b.txt': 'B' });
    await openWorkspace(app, page, dirA);

    const mainWindows = () => app.windows().filter((w) => w.url().endsWith('renderer/index.html'));
    expect(mainWindows().length).toBe(1);
    await title(page, 'Arquivo').click();
    await item(page, 'file.newWindow').click();
    await expect.poll(() => mainWindows().length, { timeout: 15000 }).toBe(2);
    const mains = app.windows().filter((w) => w.url().endsWith('renderer/index.html'));
    expect(mains.length).toBe(2);
    const page2 = mains.find((w) => w !== page);
    await page2.waitForFunction(() => !!window.AgzosEditor, null, { timeout: 15000 });
    await expect(page2.locator('#menubar .mb-title')).toHaveText(MENUS);

    // Janela nova começa sem pasta; abre outra pasta nela
    expect(await page2.evaluate(() => window.AgzosState.workspaceRoot)).toBe(null);
    await openWorkspace(app, page2, dirB);

    expect(await page.evaluate(() => window.AgzosState.workspaceRoot)).toBe(dirA);
    expect(await page2.evaluate(() => window.AgzosState.workspaceRoot)).toBe(dirB);
    await expect(page.locator('#topbar-workspace')).toContainText(path.basename(dirA));
    await expect(page2.locator('#topbar-workspace')).toContainText(path.basename(dirB));
    await expect(page.locator('#file-tree')).toContainText('a.txt');
    await expect(page2.locator('#file-tree')).toContainText('b.txt');
    await expect(page2.locator('#file-tree')).not.toContainText('a.txt');

    // Fechar a 2ª janela não derruba a 1ª
    await page2.evaluate(() => window.agzos.window.close());
    await expect.poll(() => mainWindows().length).toBe(1);
    expect(await page.evaluate(() => window.AgzosState.workspaceRoot)).toBe(dirA);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('atalhos do antigo menu nativo: Ctrl+N (sem título), Ctrl+Shift+N (nova janela); Fechar Pasta', async () => {
  const { app, page, errors } = await launchApp({ settings: SETTINGS });
  try {
    const dir = tmpDir('agzos-keys-', { 'a.txt': 'A' });
    await openWorkspace(app, page, dir);
    await page.evaluate(() => document.activeElement?.blur());

    await page.keyboard.press('Control+n');
    await expect(page.locator('#tabs .tab.active')).toContainText('Sem título-1');

    const mainWindows = () => app.windows().filter((w) => w.url().endsWith('renderer/index.html'));
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Control+Shift+N');
    await expect.poll(() => mainWindows().length, { timeout: 15000 }).toBe(2);
    const page2 = mainWindows().find((w) => w !== page);
    await page2.waitForFunction(() => !!window.AgzosEditor, null, { timeout: 15000 });
    await page2.evaluate(() => window.agzos.window.close());
    await expect.poll(() => mainWindows().length).toBe(1);

    // Fechar Pasta: sem título não salvo pede confirmação → aceita
    page.on('dialog', (d) => d.accept());
    await title(page, 'Arquivo').click();
    await item(page, 'file.closeFolder').click();
    await expect.poll(() => page.evaluate(() => window.AgzosState.workspaceRoot)).toBe(null);
    await expect(page.locator('#topbar-workspace')).toContainText('Sem pasta aberta');
    await expect(page.locator('#empty-explorer')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
