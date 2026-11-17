const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');
const { createSshServer, generateKey, publicBlob } = require('../fixtures/ssh-server');
const kh = require('../../src/main/remote/known-hosts');

// Pasta remota via SSH contra um servidor ssh2 local (sem sshd do sistema).
// HOME temporário com ~/.ssh/config (alias "fixture"), chave do usuário e known_hosts.

const userKey = generateKey();

function makeRemoteRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-e2e-remote-')));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'const alvo = 1;\n// agulha no palheiro\n');
  fs.writeFileSync(path.join(proj, 'leia-me.md'), '# Remoto\n');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'viewers', 'tiny.png'), path.join(proj, 'tiny.png'));
  return { root, proj };
}

function makeHome(port, { trust = null } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-e2e-remote-home-'));
  const ssh = path.join(home, '.ssh');
  fs.mkdirSync(ssh, { mode: 0o700 });
  fs.writeFileSync(path.join(ssh, 'config'), [
    'Host fixture', '  HostName 127.0.0.1', '  User deploy', `  Port ${port}`, '',
    'Host senha', '  HostName 127.0.0.1', '  User ana', `  Port ${port}`, '',
  ].join('\n'), { mode: 0o600 });
  fs.writeFileSync(path.join(ssh, 'id_ed25519'), userKey.private, { mode: 0o600 });
  if (trust) fs.writeFileSync(path.join(ssh, 'known_hosts'), kh.formatEntry('127.0.0.1', port, trust));
  return home;
}

async function startServer(root) {
  const server = createSshServer({ root, users: { deploy: { publicKeys: [userKey.public] }, ana: { password: 'abc123' } } });
  await server.listen();
  return server;
}

async function launch(home) {
  return launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
    env: { HOME: home, SSH_AUTH_SOCK: '', AGZOS_REMOTE_RETRY_MS: '150' },
  });
}

async function pickHost(page, alias) {
  await page.click('#status-remote-host');
  await page.locator('li[data-pick-id="folder"]').click();
  await page.locator(`li[data-pick-id="remote-host:${alias}"]`).click();
}

test('pasta remota: host desconhecido, explorer, editar/salvar, imagem, busca, Quick Open, mudança externa e queda', async () => {
  test.setTimeout(120000);
  const { root, proj } = makeRemoteRoot();
  const server = await startServer(root);
  const home = makeHome(server.port);
  const { app, page, errors } = await launch(home);
  try {
    await pickHost(page, 'fixture');
    // Host desconhecido: confirmação com fingerprint SHA256.
    const hk = page.locator('#remote-hostkey-dialog');
    await expect(hk).toBeVisible({ timeout: 15000 });
    await expect(hk).toContainText(kh.fingerprint(server.hostPublic));
    await hk.locator('button[type="submit"]').click();
    // Navegador de pastas (SFTP): entra em proj e abre aqui.
    await page.locator('li[data-pick-id="remote-dir:proj"]').click();
    await expect(page.locator('#cmd-input')).toHaveAttribute('placeholder', new RegExp(`SSH: fixture — ${proj.replace(/[/.]/g, '\\$&')}`));
    await page.locator('li[data-pick-id="remote-open-here"]').click();
    const rootUri = `ssh://fixture${proj}`;
    await expect.poll(() => page.evaluate(() => window.AgzosState.workspaceRoot)).toBe(rootUri);
    // known_hosts gravado.
    const known = kh.parseKnownHosts(fs.readFileSync(path.join(home, '.ssh', 'known_hosts'), 'utf8'));
    expect(kh.checkHostKey(known, '127.0.0.1', server.port, server.hostPublic)).toBe('match');

    // Explorer + título + status bar.
    await expect(page.locator('.tree-node[data-path$="/src"]')).toBeVisible();
    await expect(page.locator('#topbar-workspace')).toHaveText('— proj [SSH: fixture]');
    await expect(page.locator('#status-remote-host')).toContainText('SSH: fixture');
    await expect(page.locator('#status-remote-host')).toHaveClass(/connected/);
    await page.locator('.tree-node[data-path$="/src"]').click();
    await page.locator('.tree-node[data-path$="/src/app.js"]').click();
    await expect.poll(() => page.evaluate(() => window.monaco.editor.getModels().some((m) => m.getValue().includes('alvo')))).toBe(true);
    await expect(page).toHaveTitle(/app\.js — SSH: fixture — Agzos Code/);

    // Editar e salvar no host.
    await page.evaluate(() => {
      const model = window.monaco.editor.getModels().find((m) => m.getValue().includes('alvo'));
      model.setValue('const alvo = 2; // salvo pelo Agzos\n');
    });
    await page.evaluate(() => window.AgzosEditor.saveActive());
    await expect.poll(() => fs.readFileSync(path.join(proj, 'src', 'app.js'), 'utf8')).toBe('const alvo = 2; // salvo pelo Agzos\n');

    // Mudança externa: stat no host detecta e recarrega (arquivo limpo).
    await page.evaluate(() => window.AgzosRemote.pollNow());
    fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'const alvo = 3; // mudou no host\n');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(proj, 'src', 'app.js'), future, future);
    await page.evaluate(() => window.AgzosRemote.pollNow());
    await expect.poll(() => page.evaluate(() => window.monaco.editor.getModels().some((m) => m.getValue().includes('mudou no host')))).toBe(true);

    // Imagem pelo protocolo agzos-file (stream SFTP).
    await page.evaluate((p) => window.AgzosEditor.openFile(p), `${rootUri}/tiny.png`);
    const img = page.locator('#viewer-host .viewer-image img');
    await expect.poll(() => img.evaluate((el) => el.naturalWidth), { timeout: 15000 }).toBe(32);

    // Busca em arquivos no host.
    await page.click('.activity-btn[data-view="search"]');
    await page.fill('#search-text', 'agulha no palheiro');
    await expect(page.locator('#search-results .search-hit')).toHaveCount(0);
    fs.writeFileSync(path.join(proj, 'src', 'outro.js'), '// agulha no palheiro\n');
    await page.fill('#search-text', 'agulha no palheir');
    await expect(page.locator('#search-results .search-hit').first()).toContainText('src/outro.js:1', { timeout: 15000 });

    // Quick Open lista os arquivos do host.
    await page.evaluate(async () => (await import('./scripts/command-palette.js')).invalidateQuickOpenCache());
    await page.evaluate(async () => (await import('./scripts/command-palette.js')).showQuickOpen());
    await page.fill('#cmd-input', 'outro');
    await expect(page.locator('#cmd-list')).toContainText('outro.js', { timeout: 15000 });
    await page.keyboard.press('Escape');

    // Queda: reconexão automática falha (host fora do ar) → faixa com "Reconectar".
    const closing = server.stopListening();
    server.dropAll();
    await closing;
    const banner = page.locator('#remote-banner');
    await expect(banner).toContainText('Conexão com fixture perdida', { timeout: 15000 });
    await expect(banner.locator('.remote-banner-reconnect')).toBeVisible({ timeout: 15000 });
    await server.listen(server.port);
    await banner.locator('.remote-banner-reconnect').click();
    await expect(banner).toHaveCount(0, { timeout: 15000 });
    // Continua funcionando depois de reconectar.
    expect(await page.evaluate((p) => window.agzos.fs.readFile(p).then((r) => r.content), `${rootUri}/leia-me.md`)).toBe('# Remoto\n');

    // Abrir Recente lista a pasta remota.
    const recents = await page.evaluate(() => window.agzos.settings.load().then((s) => s.recentFolders));
    expect(recents[0]).toBe(rootUri);

    // Abrir em nova janela: a janela nova conecta por conta própria e abre a pasta.
    const mains = () => app.windows().filter((w) => w.url().endsWith('renderer/index.html'));
    await page.evaluate((u) => window.agzos.remote.openInNewWindow(u), rootUri);
    await expect.poll(() => mains().length, { timeout: 15000 }).toBe(2);
    const page2 = mains().find((w) => w !== page);
    await expect.poll(() => page2.evaluate(() => window.AgzosState?.workspaceRoot).catch(() => null), { timeout: 20000 }).toBe(rootUri);
    // A janela 2 não enxerga outra pasta do host (guard por janela).
    const denied = await page2.evaluate((p) => window.agzos.fs.readFile(p).then(() => 'leu', (e) => e.message), `ssh://fixture${root}/fora.txt`);
    expect(denied).toContain('Acesso negado');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await server.close();
  }
});

test('pasta remota: host key divergente bloqueia sem opção de continuar', async () => {
  test.setTimeout(60000);
  const { root } = makeRemoteRoot();
  const server = await startServer(root);
  const home = makeHome(server.port, { trust: publicBlob(generateKey().private) });
  const { app, page } = await launch(home);
  try {
    await pickHost(page, 'fixture');
    const blocked = page.locator('#remote-hostkey-blocked');
    await expect(blocked).toBeVisible({ timeout: 15000 });
    await expect(blocked).toContainText('ataque');
    await expect(blocked.locator('button')).toHaveCount(1);
    await expect(blocked.locator('button')).toHaveText('Fechar');
    await expect(page.locator('#remote-hostkey-dialog')).toHaveCount(0);
    await blocked.locator('button').click();
    expect(await page.evaluate(() => window.AgzosState.workspaceRoot)).toBeNull();
    expect(await page.evaluate(() => window.agzos.remote.list())).toEqual([]);
  } finally {
    await app.close();
    await server.close();
  }
});

test('pasta remota: senha pedida em diálogo e "Lembrar" grava no cofre', async () => {
  test.setTimeout(60000);
  const { root } = makeRemoteRoot();
  const server = await startServer(root);
  const home = makeHome(server.port, { trust: server.hostPublic });
  const { app, page, userData } = await launch(home);
  try {
    await pickHost(page, 'senha');
    const dlg = page.locator('#remote-secret-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await dlg.locator('input[type="password"]').fill('errada');
    await dlg.locator('input[type="checkbox"]').check();
    await dlg.locator('button[type="submit"]').click();
    // Senha errada: pede de novo.
    await expect(dlg).toContainText('Senha incorreta', { timeout: 15000 });
    await dlg.locator('input[type="password"]').fill('abc123');
    await dlg.locator('input[type="checkbox"]').check();
    await dlg.locator('button[type="submit"]').click();
    await expect(page.locator('li[data-pick-id="remote-dir:proj"]')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    const secrets = JSON.parse(fs.readFileSync(path.join(userData, 'secrets.json'), 'utf8'));
    expect(Object.keys(secrets)).toContain(`ssh.ana@127.0.0.1:${server.port}`);
    expect(JSON.stringify(secrets)).not.toContain('abc123'); // cifrado (cofre falso: base64)
  } finally {
    await app.close();
    await server.close();
  }
});
