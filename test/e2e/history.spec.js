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

