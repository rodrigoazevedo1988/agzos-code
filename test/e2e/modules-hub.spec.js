const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const base = { welcomeSeen: true, onboardingCompleted: true };
// 5 da 1.1.0 + módulos de editor da 1.2.0 (Erros na Linha).
const CARDS = 5 + 1;

test('hub lista os cards, 3 "Em breve"', async () => {
  const { app, page, errors } = await launchApp({ settings: base });
  try {
    const btn = page.locator('.activity-btn[data-view="modules"]');
    await expect(btn).toHaveAttribute('title', 'Módulos Agzos (Ctrl+Shift+X)');
    await expect(page.locator('.activity-btn[data-view="extensions"]')).toHaveCount(0);
    await expect(page.locator('#panel-extensions')).toHaveCount(0);

    await btn.click();
    await expect(btn).toHaveClass(/active/);
    await expect(page.locator('#sidebar-title')).toHaveText('MÓDULOS AGZOS');
    const panel = page.locator('#panel-modules');
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText('Open VSX');

    const cards = panel.locator('.module-card');
    await expect(cards).toHaveCount(CARDS);
    await expect(panel.locator('.module-card.coming-soon')).toHaveCount(3);
    await expect(panel.locator('.module-card[data-module="broom"]')).toContainText('Vassoura de Produção');
    await expect(panel.locator('.module-card[data-module="envVault"]')).toContainText('Cofre .env');
    for (const id of ['snippets', 'sandbox', 'gitSlider']) {
      const card = panel.locator(`.module-card[data-module="${id}"]`);
      await expect(card).toContainText('Em breve');
      await expect(card).toHaveAttribute('aria-disabled', 'true');
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('Ctrl+Shift+X abre o hub', async () => {
  const { app, page } = await launchApp({ settings: base });
  try {
    await page.locator('#editor-host').click();
    await page.keyboard.press('Control+Shift+X');
    await expect(page.locator('#panel-modules')).toBeVisible();
    await expect(page.locator('.activity-btn[data-view="modules"]')).toHaveClass(/active/);
  } finally {
    await app.close();
  }
});

test('abrir card e voltar com ← Módulos', async () => {
  const { app, page } = await launchApp({ settings: base });
  try {
    await page.click('.activity-btn[data-view="modules"]');
    const panel = page.locator('#panel-modules');
    await panel.locator('.module-card[data-module="broom"]').click();
    const back = panel.locator('.modules-back');
    await expect(back).toHaveText(/← Módulos/);
    await expect(panel.locator('.module-card')).toHaveCount(0);
    await expect(panel.locator('.module-view[data-module="broom"]')).toBeVisible();
    await back.click();
    await expect(panel.locator('.module-card')).toHaveCount(CARDS);

    // card "Em breve" não abre
    // aria-disabled: Playwright não clica em elemento desabilitado; dispara o evento direto
    await panel.locator('.module-card[data-module="sandbox"]').dispatchEvent('click');
    await expect(panel.locator('.module-card')).toHaveCount(CARDS);
    await expect(back).toHaveCount(0);

    // API: openModule / showModulesHub
    await page.evaluate(() => import('./scripts/modules-hub.js').then((m) => m.openModule('envVault')));
    await expect(panel.locator('.module-view[data-module="envVault"]')).toBeVisible();
    await page.evaluate(() => import('./scripts/modules-hub.js').then((m) => m.showModulesHub()));
    await expect(panel.locator('.module-card')).toHaveCount(CARDS);
  } finally {
    await app.close();
  }
});

test('módulo desabilitado nas Configurações aparece como desabilitado no card', async () => {
  const { app, page } = await launchApp({ settings: { ...base, modules: { broom: { enabled: false } } } });
  try {
    await page.click('.activity-btn[data-view="modules"]');
    const card = page.locator('#panel-modules .module-card[data-module="broom"]');
    await expect(card).toContainText('Desabilitado');
    await expect(page.locator('#panel-modules .module-card[data-module="envVault"]')).toContainText('Habilitado');
  } finally {
    await app.close();
  }
});

test('window.agzos.broom e window.agzos.envVault existem', async () => {
  const { app, page } = await launchApp({ settings: base });
  try {
    const api = await page.evaluate(() => ({
      broom: Object.keys(window.agzos.broom || {}).sort(),
      envVault: Object.keys(window.agzos.envVault || {}).sort(),
    }));
    expect(api.broom).toEqual(['analyzeFile', 'cancel', 'cleanFile', 'cleanWorkspace', 'onEvent', 'scanWorkspace', 'undo'].sort());
    expect(api.envVault).toEqual([
      'addKey', 'addToGitignore', 'copy', 'generateExample', 'gitignoreStatus', 'hookStatus', 'installHook',
      'list', 'removeHook', 'removeKey', 'reveal', 'scanStaged', 'setValue', 'undo',
    ].sort());
    // stubs registrados no main: os canais respondem (não lançam "No handler registered")
    const res = await page.evaluate(async () => {
      const out = {};
      try { out.broom = await window.agzos.broom.analyzeFile('/nao/existe.js'); } catch (e) { out.broom = String(e.message); }
      try { out.env = await window.agzos.envVault.hookStatus(); } catch (e) { out.env = String(e.message); }
      return out;
    });
    expect(JSON.stringify(res)).not.toMatch(/No handler registered/);
  } finally {
    await app.close();
  }
});

test('pontos de integração: registerCommands, registerContextMenuItems e setFileBadge', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-hub-')));
  fs.writeFileSync(path.join(dir, 'a.js'), 'console.log(1);\n');
  const { app, page } = await launchApp({ settings: base });
  try {
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), dir);
    await page.evaluate((d) => import('./scripts/file-tree.js').then((m) => m.openWorkspace(d)), dir);
    const row = page.locator('.tree-row', { hasText: 'a.js' });
    await expect(row).toBeVisible();

    // comando registrado aparece na paleta
    await page.evaluate(() => import('./scripts/command-palette.js').then((m) => m.registerCommands([
      { id: 'teste.cmd', label: 'Teste: Comando de Módulo', run: () => { window.__cmdRan = true; } },
    ])));
    await page.keyboard.press('Control+Shift+P');
    await page.keyboard.type('Comando de Módulo');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__cmdRan === true)).toBe(true);

    // item de menu de contexto
    await page.evaluate(() => import('./scripts/file-tree.js').then((m) => m.registerContextMenuItems((node) => (
      node.isDirectory ? [] : [{ label: 'Item de Teste', run: () => { window.__ctxPath = node.path; } }]
    ))));
    await row.click({ button: 'right' });
    const item = page.locator('#context-menu li', { hasText: 'Item de Teste' });
    await expect(item).toBeVisible();
    await item.click();
    await expect.poll(() => page.evaluate(() => window.__ctxPath)).toBe(path.join(dir, 'a.js'));

    // badge
    await page.evaluate((p) => import('./scripts/file-tree.js').then((m) => m.setFileBadge(p, '3')), path.join(dir, 'a.js'));
    await expect(row.locator('.tree-badge')).toHaveText('3');
    await page.evaluate((p) => import('./scripts/file-tree.js').then((m) => m.setFileBadge(p, null)), path.join(dir, 'a.js'));
    await expect(row.locator('.tree-badge')).toHaveCount(0);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
