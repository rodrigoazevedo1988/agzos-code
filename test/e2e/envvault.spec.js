const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

// Valores SINTÉTICOS (não são chaves reais), montados em tempo de execução.
const FAKE_AWS = ['AK', 'IA', 'Z3Q7R2M9K4T8W1P6'].join('');
const FAKE_PASS = ['Hj7Kq2', 'Lm9Np4Rt5Vw8'].join('');
const PLAIN = 'valor-comum-123';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Agzos Teste', GIT_AUTHOR_EMAIL: 'teste@agzos.local',
  GIT_COMMITTER_NAME: 'Agzos Teste', GIT_COMMITTER_EMAIL: 'teste@agzos.local',
};
const gitEnv = { ...process.env, ...IDENTITY, GIT_TERMINAL_PROMPT: '0' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf-8' }).trim();
const tmp = (p) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p)));

const settings = {
  welcomeSeen: true,
  onboardingCompleted: true,
  modules: { envVault: { enabled: true, blockCommits: true, revealTimeoutSec: 3 } },
};

async function openFolder(app, page, dir) {
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), dir);
  await page.evaluate(async (d) => {
    const mod = await import('./scripts/file-tree.js');
    await mod.openWorkspace(d);
  }, dir);
}

async function openVault(page) {
  await page.click('.activity-btn[data-view="modules"]');
  await page.locator('#panel-modules .module-card[data-module="envVault"]').click();
  const view = page.locator('.module-view[data-module="envVault"]');
  await expect(view.locator('.ev-card').first()).toBeVisible();
  return view;
}

function workspace() {
  const dir = tmp('agzos-envvault-e2e-');
  fs.writeFileSync(path.join(dir, '.env'), [
    `DB_PASSWORD=${FAKE_PASS}`,
    `AWS_KEY=${FAKE_AWS}`,
    `PLAIN=${PLAIN}`,
    'EMPTY=',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, '.env.example'), 'DB_PASSWORD=\nAWS_KEY=\nPLAIN=\nEMPTY=\nFALTA=\n');
  return dir;
}

test('cofre: valores mascarados, selos, clique longo revela e esconde após o tempo', async () => {
  const dir = workspace();
  const { app, page, errors } = await launchApp({ settings });
  try {
    await openFolder(app, page, dir);
    const view = await openVault(page);
    const card = view.locator('.ev-card[data-rel=".env"]');
    await expect(card.locator('.ev-row')).toHaveCount(5);
    await expect(view.locator('#envvault-summary')).toHaveText('2 segredo(s) · 1 faltando');

    // Nenhum valor no DOM antes de revelar
    const html = await page.content();
    for (const v of [FAKE_AWS, FAKE_PASS, PLAIN]) expect(html.includes(v)).toBe(false);

    const row = (key) => card.locator(`.ev-row[data-key="${key}"]`);
    await expect(row('PLAIN').locator('.ev-value')).toHaveText('••••••••');
    await expect(row('AWS_KEY').locator('.ev-badge.secret')).toContainText('segredo');
    await expect(row('DB_PASSWORD').locator('.ev-badge.secret')).toBeVisible();
    await expect(row('EMPTY').locator('.ev-badge.empty')).toHaveText('vazia');
    await expect(row('FALTA').locator('.ev-badge.missing')).toContainText('faltando');

    // Clique curto não revela; clique longo (500 ms) revela
    const value = row('AWS_KEY').locator('.ev-value');
    await value.click();
    await page.waitForTimeout(700);
    await expect(value).toHaveText('••••••••');
    await value.hover();
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(value).toHaveText(FAKE_AWS);
    // ...e some sozinho após revealTimeoutSec (3 s)
    await expect(value).toHaveText('••••••••', { timeout: 5000 });
    expect((await page.content()).includes(FAKE_AWS)).toBe(false);

    // Alt com o mouse sobre a linha também revela
    await row('PLAIN').hover();
    await page.keyboard.down('Alt');
    await page.keyboard.up('Alt');
    await expect(row('PLAIN').locator('.ev-value')).toHaveText(PLAIN);

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('cofre: gerar .env.example e editar valor pela view', async () => {
  const dir = workspace();
  fs.rmSync(path.join(dir, '.env.example'));
  const { app, page, errors } = await launchApp({ settings });
  try {
    await openFolder(app, page, dir);
    const view = await openVault(page);
    const card = view.locator('.ev-card[data-rel=".env"]');
    await card.locator('.ev-gen-example').click();
    await expect(view.locator('.ev-card[data-rel=".env.example"]')).toBeVisible();
    expect(fs.readFileSync(path.join(dir, '.env.example'), 'utf-8')).toBe('DB_PASSWORD=\nAWS_KEY=\nPLAIN=\nEMPTY=\n');

    const plain = view.locator('.ev-card[data-rel=".env"] .ev-row[data-key="PLAIN"]');
    await plain.hover();
    await plain.locator('button[title="Editar valor"]').click();
    const input = plain.locator('input.ev-input');
    await expect(input).toHaveValue('');
    await input.fill('novo valor');
    await input.press('Enter');
    await expect.poll(() => fs.readFileSync(path.join(dir, '.env'), 'utf-8')).toContain('PLAIN="novo valor"');
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf-8')).toContain(`AWS_KEY=${FAKE_AWS}\n`);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('cofre: aviso de .gitignore e botão acrescenta a linha', async () => {
  const dir = workspace();
  git(dir, 'init', '-q');
  const { app, page, errors } = await launchApp({ settings });
  try {
    await openFolder(app, page, dir);
    const view = await openVault(page);
    await expect(view.locator('#envvault-gitignore-warn')).toContainText('não está no .gitignore');
    await view.locator('#envvault-add-gitignore').click();
    await expect(view.locator('#envvault-gitignore-warn')).toHaveCount(0);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')).toBe('.env\n.env*.local\n');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('commit com segredo abre o diálogo, não commita, e "Ignorar uma vez" cria o commit', async () => {
  const dir = tmp('agzos-envvault-git-');
  git(dir, 'init', '-q', '--initial-branch=main');
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicial');
  const { app, page, errors, userData } = await launchApp({ settings, env: IDENTITY });
  try {
    await openFolder(app, page, dir);
    await page.click('.activity-btn[data-view="git"]');
    fs.writeFileSync(path.join(dir, 'config.js'), `export const key = "${FAKE_AWS}";\n`);
    git(dir, 'add', 'config.js');
    await page.evaluate(async () => (await import('./scripts/git-panel.js')).refreshGit({ log: true }));
    await expect(page.locator('.git-section[data-group="staged"] .git-file[data-path="config.js"]')).toBeVisible();

    await page.locator('#git-commit-message').fill('com segredo');
    await page.click('#git-commit');
    const dlg = page.locator('#envvault-blocked-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.git-dialog-title')).toHaveText('Commit bloqueado: possíveis segredos');
    await expect(dlg.locator('.envvault-finding-file')).toHaveText('config.js:1');
    await expect(dlg.locator('.envvault-finding-preview')).toHaveText('AKIA…');
    await expect(dlg.locator('button[data-action="cancel"]')).toBeFocused();
    expect((await page.content()).includes(FAKE_AWS)).toBe(false);

    // Cancelar: nada commitado, mensagem preservada
    await dlg.locator('button[data-action="cancel"]').click();
    await expect(dlg).toHaveCount(0);
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
    await expect(page.locator('#git-commit-message')).toHaveValue('com segredo');

    // Ignorar uma vez: commita e registra o override
    await page.click('#git-commit');
    await expect(dlg).toBeVisible();
    await dlg.locator('button[data-action="ignore"]').click();
    await expect.poll(() => git(dir, 'log', '-1', '--format=%s')).toBe('com segredo');
    const logFile = path.join(userData, 'envvault-overrides.log');
    await expect.poll(() => fs.existsSync(logFile)).toBe(true);
    const log = fs.readFileSync(logFile, 'utf-8');
    expect(log).toContain('config.js');
    expect(log.includes(FAKE_AWS)).toBe(false);

    // Remover do stage
    fs.writeFileSync(path.join(dir, 'b.js'), `export const key = "${FAKE_AWS}";\n`);
    git(dir, 'add', 'b.js');
    await page.evaluate(async () => (await import('./scripts/git-panel.js')).refreshGit({ log: true }));
    await page.locator('#git-commit-message').fill('outro');
    await page.click('#git-commit');
    await dlg.locator('button[data-action="unstage"]').click();
    await expect.poll(() => git(dir, 'diff', '--cached', '--name-only')).toBe('');
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('2');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('cofre: editar valor e Desfazer restaura o arquivo', async () => {
  const dir = workspace();
  const original = fs.readFileSync(path.join(dir, '.env'), 'utf8');
  const { app, page, errors } = await launchApp({ settings });
  try {
    await openFolder(app, page, dir);
    const view = await openVault(page);
    const row = view.locator('.ev-row[data-key="PLAIN"]').first();
    await row.hover();
    await row.getByRole('button', { name: 'Editar valor' }).click();
    const input = page.getByLabel('Novo valor de PLAIN');
    await input.fill('outro-valor');
    await input.press('Enter');
    await expect.poll(() => fs.readFileSync(path.join(dir, '.env'), 'utf8')).toContain('PLAIN=outro-valor');
    await page.locator('.toast-action-btn', { hasText: 'Desfazer' }).click();
    await expect.poll(() => fs.readFileSync(path.join(dir, '.env'), 'utf8')).toBe(original);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
