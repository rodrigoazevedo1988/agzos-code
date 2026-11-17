const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const base = { welcomeSeen: true, onboardingCompleted: true };
const IDENTITY = {
  GIT_AUTHOR_NAME: 'Agzos Teste', GIT_AUTHOR_EMAIL: 'teste@agzos.local',
  GIT_COMMITTER_NAME: 'Agzos Teste', GIT_COMMITTER_EMAIL: 'teste@agzos.local',
};
const gitEnv = { ...process.env, ...IDENTITY, GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf-8' }).trim();

async function setup({ files = {}, settings = {}, init } = {}) {
  const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-history-e2e-')));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true });
    fs.writeFileSync(path.join(workspace, name), content);
  }
  if (init) init(workspace);
  const launched = await launchApp({ settings: { ...base, ...settings } });
  const { app, page } = launched;
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), workspace);
  await page.evaluate((d) => import('./scripts/file-tree.js').then((m) => m.openWorkspace(d)), workspace);
  const file = (rel) => path.join(workspace, rel);
  const open = (rel) => page.evaluate((p) => window.AgzosEditor.openFile(p), file(rel));
  const close = async () => { await app.close(); fs.rmSync(workspace, { recursive: true, force: true }); };
  return { ...launched, workspace, open, close, file };
}

/** Troca o texto do editor ativo e salva (Ctrl+S). */
async function editAndSave(page, text) {
  await page.evaluate((t) => import('./scripts/editor.js').then((m) => m.getActiveEditor().setValue(t)), text);
  await page.locator('.monaco-editor textarea').first().focus();
  await page.keyboard.press('Control+S');
}

test('salvar 3 vezes guarda 3 versões no histórico local', async () => {
  const env = await setup({ files: { 'a.txt': 'v0\n' } });
  const { page } = env;
  try {
    await env.open('a.txt');
    for (const v of ['v1\n', 'v2\n', 'v3\n']) {
      await editAndSave(page, v);
      await expect.poll(() => fs.readFileSync(env.file('a.txt'), 'utf8')).toBe(v);
    }
    await expect.poll(() => page.evaluate((p) => window.agzos.history.list(p).then((l) => l.length), env.file('a.txt'))).toBe(3);
    const dir = path.join(env.userData, 'local-history');
    expect(fs.existsSync(dir)).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    expect(env.errors).toEqual([]);
  } finally { await env.close(); }
});


const editorText = (page) => page.evaluate(() => import('./scripts/editor.js').then((m) => m.getActiveEditor().getValue()));

test('linha do tempo: 3 marcadores, diff, restaurar e Esc volta ao presente', async () => {
  const env = await setup({ files: { 'a.txt': 'v0\n' } });
  const { page } = env;
  try {
    await env.open('a.txt');
    for (const v of ['v1\n', 'v2\n', 'v3\n']) {
      await editAndSave(page, v);
      await expect.poll(() => fs.readFileSync(env.file('a.txt'), 'utf8')).toBe(v);
    }
    await expect.poll(() => page.evaluate((p) => window.agzos.history.list(p).then((l) => l.length), env.file('a.txt'))).toBe(3);
    await page.locator('.monaco-editor textarea').first().focus();
    await page.keyboard.press('Control+Alt+H');
    const tl = page.locator('#file-timeline');
    await expect(tl).toBeVisible();
    await expect(tl.locator('.timeline-marker[data-kind="local"]')).toHaveCount(3);
    await expect(tl.locator('.timeline-marker.present')).toHaveCount(1);

    // 1º marcador = v1: diff entre v1 e o presente (v3).
    await tl.locator('.timeline-marker[data-kind="local"]').first().click();
    const diff = page.locator('#file-timeline-diff');
    await expect(diff).toBeVisible();
    await expect(diff.locator('.monaco-diff-editor')).toBeVisible();
    await expect(diff).toContainText('v1');
    await expect(diff).toContainText('v3');
    await expect(tl.locator('.timeline-info')).toContainText('salvo');

    // ←/→ navegam.
    await tl.locator('.timeline-marker[data-kind="local"]').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(tl.locator('.timeline-marker.selected')).toHaveAttribute('data-index', '1');
    await page.keyboard.press('ArrowLeft');
    await expect(tl.locator('.timeline-marker.selected')).toHaveAttribute('data-index', '0');

    await tl.locator('button', { hasText: 'Restaurar esta versão' }).click();
    await expect.poll(() => fs.readFileSync(env.file('a.txt'), 'utf8')).toBe('v1\n');
    await expect.poll(() => editorText(page)).toBe('v1\n');
    // A restauração entra no histórico.
    await expect(tl.locator('.timeline-marker[data-kind="local"]')).toHaveCount(4);
    await expect(diff).toBeHidden();

    await tl.locator('.timeline-marker[data-kind="local"]').first().click();
    await expect(diff).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(diff).toBeHidden();
    await expect(tl).toBeHidden();
    expect(env.errors).toEqual([]);
  } finally { await env.close(); }
});

test('linha do tempo: arquivo em repo git mostra commits; comparar com a anterior', async () => {
  const env = await setup({
    init: (dir) => {
      git(dir, 'init', '-q');
      fs.writeFileSync(path.join(dir, 'b.js'), 'const x = 1;\n');
      git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'primeiro commit');
      fs.writeFileSync(path.join(dir, 'b.js'), 'const x = 2;\n');
      git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'segundo commit');
    },
  });
  const { page } = env;
  try {
    await env.open('b.js');
    const btn = page.locator('#file-timeline-toggle');
    await expect(btn).toBeVisible();
    await btn.click();
    const tl = page.locator('#file-timeline');
    await expect(tl.locator('.timeline-marker[data-kind="commit"]')).toHaveCount(2);
    await tl.locator('.timeline-marker[data-kind="commit"]').nth(1).click();
    await expect(tl.locator('.timeline-info')).toContainText('segundo commit');
    await expect(tl.locator('.timeline-info')).toContainText('Agzos Teste');
    await tl.locator('button', { hasText: 'Comparar com a anterior' }).click();
    const diff = page.locator('#file-timeline-diff');
    await expect(diff).toContainText('const x = 1;');
    await expect(diff).toContainText('const x = 2;');
    await tl.locator('button', { hasText: 'Voltar ao presente' }).click();
    await expect(diff).toBeHidden();
    await expect(tl).toBeHidden();
    // Comando da paleta abre de novo.
    await page.keyboard.press('Control+Shift+P');
    await page.locator('#cmd-input').fill('> Agzos: Linha do tempo do arquivo');
    await expect(page.locator('#cmd-list')).toContainText('Linha do tempo do arquivo');
    await page.keyboard.press('Enter');
    await expect(tl).toBeVisible();
    expect(env.errors).toEqual([]);
  } finally { await env.close(); }
});

test('hub: card Agzos Git Slider habilitado abre a view', async () => {
  const env = await setup({ files: { 'a.txt': 'x\n' } });
  const { page } = env;
  try {
    await page.click('.activity-btn[data-view="modules"]');
    const card = page.locator('#panel-modules .module-card[data-module="gitSlider"]');
    await expect(card).toContainText('Agzos Git Slider');
    await expect(card.locator('.module-card-status')).toHaveText('Habilitado');
    await card.click();
    await expect(page.locator('.module-view[data-module="gitSlider"]')).toContainText('Linha do tempo');
  } finally { await env.close(); }
});
