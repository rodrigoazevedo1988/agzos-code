const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const SHOTS = process.env.AGZOS_E2E_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const IDENTITY = {
  GIT_AUTHOR_NAME: 'Agzos Teste', GIT_AUTHOR_EMAIL: 'teste@agzos.local',
  GIT_COMMITTER_NAME: 'Agzos Teste', GIT_COMMITTER_EMAIL: 'teste@agzos.local',
};
const gitEnv = { ...process.env, ...IDENTITY, GIT_TERMINAL_PROMPT: '0' };
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf-8' }).trim();
}
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Repo com 1 commit + remote bare (main) + segunda cópia para simular outro dev. */
function setupRepos() {
  const base = tmp('agzos-git-e2e-');
  const bare = path.join(base, 'remote.git');
  const work = path.join(base, 'projeto');
  const other = path.join(base, 'outro');
  git(base, 'init', '-q', '--bare', '--initial-branch=main', bare);
  fs.mkdirSync(work);
  git(work, 'init', '-q', '--initial-branch=main');
  fs.writeFileSync(path.join(work, 'a.txt'), 'linha 1\n');
  fs.writeFileSync(path.join(work, 'README.md'), '# Projeto\n');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'commit inicial');
  git(work, 'remote', 'add', 'origin', bare);
  git(work, 'push', '-q', '-u', 'origin', 'main');
  git(base, 'clone', '-q', bare, other);
  return { base, bare, work, other };
}

async function openFolder(app, page, dir) {
  await app.evaluate((_e, d) => global.__agzosAllowRoot(d), dir);
  await page.evaluate(async (d) => {
    const mod = await import('./scripts/file-tree.js');
    await mod.openWorkspace(d);
  }, dir);
}

async function refresh(page) {
  await page.evaluate(async () => (await import('./scripts/git-panel.js')).refreshGit({ log: true }));
}

async function openGitView(page) {
  await page.click('.activity-btn[data-view="git"]');
  await expect(page.locator('#panel-git')).toBeVisible();
}

const fileRow = (page, group, p) => page.locator(`.git-section[data-group="${group}"] .git-file[data-path="${p}"]`);

test('painel git: status, diff, stage/unstage/descartar, commit, histórico e branches', async () => {
  const { work } = setupRepos();
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
    env: IDENTITY,
  });
  try {
    await openFolder(app, page, work);
    await openGitView(page);
    await expect(page.locator('#status-remote')).toContainText('main');
    await expect(page.locator('.git-commit-subject').first()).toHaveText('commit inicial');

    fs.writeFileSync(path.join(work, 'a.txt'), 'linha 1\nlinha 2\n');
    fs.mkdirSync(path.join(work, 'docs'));
    fs.writeFileSync(path.join(work, 'docs', 'novo arquivo ç.md'), 'oi\n');
    await refresh(page);

    await expect(fileRow(page, 'changes', 'a.txt')).toBeVisible();
    await expect(fileRow(page, 'changes', 'docs/novo arquivo ç.md')).toBeVisible();
    await expect(fileRow(page, 'changes', 'a.txt').locator('.git-file-status')).toHaveText('M');
    await expect(fileRow(page, 'changes', 'docs/novo arquivo ç.md').locator('.git-file-status')).toHaveText('U');
    await expect(page.locator('.activity-btn[data-view="git"] .activity-badge')).toHaveText('2');
    await expect(page.locator('#status-remote')).toContainText('main*');
    // Cor na árvore de arquivos
    await expect(page.locator(`.tree-node[data-path="${path.join(work, 'a.txt')}"]`)).toHaveAttribute('data-git', 'modified');
    await shot(page, 'git-01-changes');
    if (SHOTS) {
      for (const theme of ['agzos-light', 'monokai']) {
        await page.evaluate((t) => { document.body.className = document.body.className.replace(/theme-[\w-]+/, `theme-${t}`); }, theme);
        await shot(page, `git-01-changes-${theme}`);
      }
      await page.evaluate(() => { document.body.className = document.body.className.replace(/theme-[\w-]+/, 'theme-agzos-dark'); });
    }

    // Diff HEAD ↔ working tree
    await fileRow(page, 'changes', 'a.txt').click();
    await expect(page.locator('.diff-overlay')).toBeVisible();
    await expect(page.locator('.diff-overlay h2')).toContainText('a.txt');
    await shot(page, 'git-02-diff');
    await page.keyboard.press('Escape');
    await expect(page.locator('.diff-overlay')).toHaveCount(0);

    // Stage / unstage de um arquivo
    const novo = fileRow(page, 'changes', 'docs/novo arquivo ç.md');
    await novo.hover();
    await novo.locator('button[title="Preparar (stage)"]').click();
    await expect(fileRow(page, 'staged', 'docs/novo arquivo ç.md')).toBeVisible();
    await fileRow(page, 'staged', 'docs/novo arquivo ç.md').hover();
    await fileRow(page, 'staged', 'docs/novo arquivo ç.md').locator('button[title="Remover da preparação"]').click();
    await expect(fileRow(page, 'changes', 'docs/novo arquivo ç.md')).toBeVisible();
    await expect(page.locator('.git-section[data-group="staged"]')).toHaveCount(0);

    // Descartar com confirmação
    await fileRow(page, 'changes', 'a.txt').hover();
    await fileRow(page, 'changes', 'a.txt').locator('button[title="Descartar alterações"]').click();
    await expect(page.locator('.git-dialog')).toBeVisible();
    await page.locator('.git-dialog .git-btn-danger').click();
    await expect(fileRow(page, 'changes', 'a.txt')).toHaveCount(0);
    expect(fs.readFileSync(path.join(work, 'a.txt'), 'utf-8')).toBe('linha 1\n');

    // Commit com Ctrl+Enter (prepara tudo após confirmação)
    await page.locator('#git-commit-message').fill('adiciona docs');
    await page.locator('#git-commit-message').press('Control+Enter');
    await page.locator('.git-dialog .git-btn-primary').click();
    await expect(page.locator('.git-commit-subject').first()).toHaveText('adiciona docs');
    expect(git(work, 'log', '-1', '--format=%s')).toBe('adiciona docs');
    await expect(page.locator('.git-section[data-group="changes"] .git-file')).toHaveCount(0);
    await expect(page.locator('.activity-btn[data-view="git"] .activity-badge')).toBeHidden();
    await expect(page.locator('#git-sync-btn')).toContainText('↑1');
    await expect(page.locator('#status-sync')).toContainText('1↑');
    await shot(page, 'git-03-history');

    // Criar branch pelo menu
    await page.click('#git-branch-btn');
    await expect(page.locator('#git-branch-menu')).toBeVisible();
    await expect(page.locator('#git-branch-menu .git-menu-item.current')).toContainText('main');
    await shot(page, 'git-04-branch-menu');
    await page.locator('#git-branch-search').fill('feat/painel');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status-remote')).toContainText('feat/painel');
    expect(git(work, 'branch', '--show-current')).toBe('feat/painel');

    // Trocar de volta para main
    await page.click('#git-branch-btn');
    await page.locator('#git-branch-menu .git-menu-item', { hasText: /^main/ }).first().click();
    await expect(page.locator('#status-remote')).toContainText('main');
    expect(git(work, 'branch', '--show-current')).toBe('main');

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('git: push, pull e sincronizar com remote bare local', async () => {
  const { bare, work, other } = setupRepos();
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
    env: IDENTITY,
  });
  try {
    await openFolder(app, page, work);
    await openGitView(page);

    // Commit local → Push pela paleta (runGitCommand)
    fs.writeFileSync(path.join(work, 'b.txt'), 'b\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'local b');
    await refresh(page);
    await expect(page.locator('#git-sync-btn')).toContainText('↑1');
    await page.evaluate(async () => (await import('./scripts/git-panel.js')).runGitCommand('push'));
    await expect(page.locator('#git-sync-btn')).toContainText('↑0');
    expect(git(bare, 'log', '-1', '--format=%s', 'main')).toBe('local b');

    // Outro dev envia commit → Sincronizar traz (pull + push)
    git(other, 'pull', '-q');
    fs.writeFileSync(path.join(other, 'c.txt'), 'c\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-q', '-m', 'remoto c');
    git(other, 'push', '-q');
    await page.evaluate(async () => (await import('./scripts/git-panel.js')).runGitCommand('fetch'));
    await expect(page.locator('#git-sync-btn')).toContainText('↓1');
    await page.click('#git-sync-btn');
    await expect(page.locator('#git-sync-btn')).toContainText('↓0');
    expect(fs.existsSync(path.join(work, 'c.txt'))).toBe(true);
    await expect(page.locator('.git-commit-subject').first()).toHaveText('remoto c');

    // Commit e Push pelo botão
    fs.writeFileSync(path.join(work, 'd.txt'), 'd\n');
    await refresh(page);
    await page.locator('#git-commit-message').fill('commit e push');
    await page.click('#git-commit-push');
    await page.locator('.git-dialog .git-btn-primary').click();
    await expect.poll(() => git(bare, 'log', '-1', '--format=%s', 'main')).toBe('commit e push');

    // Push rejeitado → mensagem sugere Pull
    git(other, 'pull', '-q');
    fs.writeFileSync(path.join(other, 'e.txt'), 'e\n');
    git(other, 'add', '-A'); git(other, 'commit', '-q', '-m', 'e'); git(other, 'push', '-q');
    fs.writeFileSync(path.join(work, 'f.txt'), 'f\n');
    git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'f');
    await page.evaluate(async () => (await import('./scripts/git-panel.js')).runGitCommand('push'));
    await expect(page.locator('.toast.error').last()).toContainText('Pull');

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('clonar repositório pelo botão "Clonar Repo" da tela inicial', async () => {
  const { bare } = setupRepos();
  const parent = tmp('agzos-clone-dest-');
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
    env: IDENTITY,
  });
  try {
    // Origem local precisa estar liberada no guard (proteção contra copiar repos arbitrários)
    await app.evaluate((_e, d) => global.__agzosAllowRoot(d), bare);
    // Diálogo nativo de pasta → devolve a pasta temporária (o handler libera no guard)
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
    }, parent);
    await page.locator('#welcome [data-action="clone"]').click();
    const dlg = page.locator('#git-clone-dialog');
    await expect(dlg).toBeVisible();
    await dlg.locator('.git-field[data-name="url"] input').fill(bare);
    await dlg.locator('.git-field[data-name="parent"] button').click();
    await expect(dlg.locator('.git-field[data-name="parent"] input')).toHaveValue(parent);
    await shot(page, 'git-05-clone');
    await dlg.locator('button[type="submit"]').click();
    await expect(dlg).toHaveCount(0, { timeout: 20000 });
    const dest = path.join(parent, 'remote');
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf-8')).toBe('linha 1\n');
    await expect(page.locator('#topbar-workspace')).toContainText('remote');
    await openGitView(page);
    await expect(page.locator('#status-remote')).toContainText('main');
    await expect(page.locator('.git-commit-subject').first()).toHaveText('commit inicial');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('pasta sem repositório: inicializar pelo painel', async () => {
  const dir = tmp('agzos-git-init-');
  fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
    env: IDENTITY,
  });
  try {
    await openFolder(app, page, dir);
    await openGitView(page);
    await expect(page.locator('.git-empty-title')).toHaveText('Esta pasta não é um repositório Git');
    await expect(page.locator('#git-publish')).toBeVisible();
    await expect(page.locator('#status-remote')).toBeHidden();
    await shot(page, 'git-06-norepo');
    await page.click('#git-init');
    await expect(fileRow(page, 'changes', 'x.txt')).toBeVisible();
    expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

/* ------------------------------------------------------------------------ */
/*  GitHub com API falsa                                                     */
/* ------------------------------------------------------------------------ */
const http = require('http');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function startFakeGitHub() {
  const users = {
    'tok-onboarding': { id: 101, login: 'onb-user', name: 'Onboarding User' },
    'tok-tester': { id: 202, login: 'tester', name: 'Test User' },
  };
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
      const json = body ? JSON.parse(body) : null;
      calls.push({ method: req.method, url: req.url, auth, body: json });
      const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      const base = `http://127.0.0.1:${server.address().port}`;
      if (req.url.startsWith('/avatar/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(PNG_1PX); return; }
      const user = users[auth];
      if (!user) return send(401, { message: 'Bad credentials' });
      if (req.method === 'GET' && req.url === '/user') return send(200, { ...user, avatar_url: `${base}/avatar/${user.login}.png` });
      if (req.method === 'GET' && req.url.startsWith('/user/orgs')) return send(200, [{ login: 'agzos-org' }]);
      if (req.method === 'POST' && req.url === '/user/repos') {
        return send(201, { full_name: `${user.login}/${json.name}`, html_url: `https://github.com/${user.login}/${json.name}`, clone_url: `https://github.com/${user.login}/${json.name}.git` });
      }
      const repo = req.url.match(/^\/repos\/([^/]+)\/([^/]+)$/);
      if (req.method === 'GET' && repo) return send(200, { default_branch: 'main' });
      const pulls = req.url.match(/^\/repos\/([^/]+)\/([^/]+)\/pulls$/);
      if (req.method === 'POST' && pulls) return send(201, { number: 7, html_url: `https://github.com/${pulls[1]}/${pulls[2]}/pull/7` });
      return send(404, { message: 'Not Found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}` })));
}

test('GitHub: conta do onboarding migrada, adicionar PAT, publicar repositório e criar PR', async () => {
  const gh = await startFakeGitHub();
  const base = tmp('agzos-gh-e2e-');
  const remotes = path.join(base, 'remotes');
  fs.mkdirSync(path.join(remotes, 'tester'), { recursive: true });
  git(base, 'init', '-q', '--bare', '--initial-branch=main', path.join(remotes, 'tester', 'demo.git'));
  // github.com só no push vira o bare local (fetch mostra a URL original no `remote -v`)
  const gitconfig = path.join(base, 'gitconfig');
  fs.writeFileSync(gitconfig, `[url "${remotes}/"]\n\tpushInsteadOf = https://github.com/\n[user]\n\tname = Agzos Teste\n\temail = teste@agzos.local\n`);
  const project = path.join(base, 'demo');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'index.js'), 'console.log(1);\n');

  // Token salvo pelo onboarding (cofre falso: base64("fake:" + valor))
  const userData = tmp('agzos-gh-ud-');
  fs.writeFileSync(path.join(userData, 'secrets.json'), JSON.stringify({ 'github.onboarding': Buffer.from('fake:tok-onboarding').toString('base64') }));

  const { app, page, errors } = await launchApp({
    userData,
    settings: { welcomeSeen: true, onboardingCompleted: true },
    env: { AGZOS_GITHUB_API: gh.url, GIT_CONFIG_GLOBAL: gitconfig },
  });
  try {
    await app.evaluate(({ shell }) => {
      globalThis.__agzosOpened = [];
      shell.openExternal = async (u) => { globalThis.__agzosOpened.push(u); };
    });

    // Configurações → Git & GitHub
    await page.click('#btn-settings');
    await page.locator('.settings-category-item[data-cat="git"]').click();
    const accounts = page.locator('#gh-accounts');
    await expect(accounts.locator('.gh-account')).toHaveCount(1);
    await expect(accounts).toContainText('@onb-user');
    await expect(accounts).toContainText('Padrão');

    await page.locator('#gh-token-input').fill('tok-invalido');
    await page.locator('#gh-add-form button[type="submit"]').click();
    await expect(page.locator('#gh-add-form .gh-error')).toContainText('Token inválido');

    await page.locator('#gh-token-input').fill('tok-tester');
    await page.locator('#gh-add-form button[type="submit"]').click();
    await expect(accounts.locator('.gh-account')).toHaveCount(2);
    await expect(accounts.locator('.gh-account[data-id="202"] img')).toBeVisible();
    await accounts.locator('.gh-account[data-id="202"] button', { hasText: 'Tornar padrão' }).click();
    await expect(accounts.locator('.gh-account[data-id="202"]')).toContainText('Padrão');
    await shot(page, 'git-07-github-settings');
    await page.keyboard.press('Escape');

    // Token nunca no settings.json
    const settingsRaw = fs.readFileSync(path.join(userData, 'settings.json'), 'utf-8');
    expect(settingsRaw).not.toContain('tok-tester');
    expect(settingsRaw).not.toContain('tok-onboarding');
    expect(JSON.parse(settingsRaw).github.accounts.map((a) => a.login)).toEqual(['onb-user', 'tester']);
    expect(fs.readFileSync(path.join(userData, 'secrets.json'), 'utf-8')).not.toContain('github.onboarding');

    // Publicar no GitHub a partir de pasta sem git
    await openFolder(app, page, project);
    await openGitView(page);
    await page.click('#git-publish');
    const dlg = page.locator('#git-publish-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.git-field[data-name="account"] select')).toHaveValue('202');
    await expect(dlg.locator('.git-field[data-name="name"] input')).toHaveValue('demo');
    await shot(page, 'git-08-publish');
    await dlg.locator('button[type="submit"]').click();
    await expect(dlg).toHaveCount(0, { timeout: 20000 });
    const created = gh.calls.find((c) => c.method === 'POST' && c.url === '/user/repos');
    expect(created.auth).toBe('tok-tester');
    expect(created.body).toMatchObject({ name: 'demo', private: true });
    expect(git(path.join(remotes, 'tester', 'demo.git'), 'log', '-1', '--format=%s', 'main')).toBe('Commit inicial');
    expect(git(project, 'remote', 'get-url', 'origin')).toBe('https://github.com/tester/demo.git');
    expect(fs.readFileSync(path.join(project, '.git', 'config'), 'utf-8')).not.toContain('tok-');
    await expect(page.locator('#git-account-chip')).toBeVisible();

    // Branch nova + commit → Criar Pull Request
    git(project, 'checkout', '-q', '-b', 'feat/pr');
    fs.writeFileSync(path.join(project, 'index.js'), 'console.log(2);\n');
    git(project, 'commit', '-q', '-am', 'muda log');
    await refresh(page);
    await page.evaluate(async () => { (await import('./scripts/git-panel.js')).runGitCommand('pr'); });
    const pr = page.locator('#git-pr-dialog');
    await expect(pr).toBeVisible();
    await expect(pr.locator('.git-field[data-name="title"] input')).toHaveValue('muda log');
    await expect(pr.locator('.git-field[data-name="base"] select')).toHaveValue('main');
    await pr.locator('.git-field[data-name="body"] textarea').fill('Descrição do PR');
    await shot(page, 'git-09-pr');
    await pr.locator('button[type="submit"]').click();
    await expect(pr).toHaveCount(0, { timeout: 20000 });
    const prCall = gh.calls.find((c) => c.method === 'POST' && c.url === '/repos/tester/demo/pulls');
    expect(prCall.auth).toBe('tok-tester');
    expect(prCall.body).toMatchObject({ head: 'feat/pr', base: 'main', title: 'muda log', body: 'Descrição do PR' });
    expect(git(path.join(remotes, 'tester', 'demo.git'), 'log', '-1', '--format=%s', 'feat/pr')).toBe('muda log');
    await expect.poll(() => app.evaluate(() => globalThis.__agzosOpened)).toEqual(['https://github.com/tester/demo/pull/7']);

    expect(errors).toEqual([]);
  } finally {
    gh.server.close();
    await app.close();
  }
});
