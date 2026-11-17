const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

// HOME temporário com ~/.ssh/config de fixture. O ssh real não conecta em
// nada externo: os alvos apontam para um servidor TCP local que aceita a
// conexão e nunca responde (o ssh fica esperando o banner = sessão viva).

const list = (page) => page.evaluate(() => window.AgzosTerminal.list());
const lastSpawn = (app) => app.evaluate(() => global.__agzosLastSpawn || null);

function fixtureHome(port) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-ssh-home-'));
  const sshDir = path.join(home, '.ssh');
  fs.mkdirSync(path.join(sshDir, 'conf.d'), { recursive: true, mode: 0o700 });
  const config = [
    '# fixture e2e',
    'Include conf.d/*.conf',
    '',
    'Host *',
    '  ServerAliveInterval 30',
    '',
    'Host prod',
    '  HostName 127.0.0.1',
    '  User deploy',
    `  Port ${port}`,
    '',
    'Host web-?',
    '  User x',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(sshDir, 'config'), config, { mode: 0o600 });
  fs.writeFileSync(path.join(sshDir, 'conf.d', 'extra.conf'), 'Host extra\n  HostName extra.example.com\n');
  return { home, cfg: path.join(sshDir, 'config'), original: config };
}

async function openPicker(page) {
  await page.click('#status-remote-host');
  await expect(page.locator('#cmd-overlay')).toBeVisible();
  await expect(page.locator('#cmd-input')).toHaveAttribute('placeholder', 'Selecione uma opção para abrir uma conexão remota');
}

test('SSH: botão remoto, seletor, conectar, adicionar host e abrir config', async () => {
  test.setTimeout(90000);
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on('error', () => {}); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const { home, cfg, original } = fixtureHome(port);

  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
    env: { HOME: home },
  });
  try {
    // Botão é o primeiro item da esquerda e não é o #status-remote do Git.
    const btn = page.locator('#status-remote-host');
    await expect(btn).toBeVisible();
    expect(await page.evaluate(() => document.querySelector('#statusbar .status-left').firstElementChild.id)).toBe('status-remote-host');
    await expect(btn).not.toHaveClass(/connected/);

    // Seletor: hosts do config + Include, curingas fora; pasta remota habilitada (1.2.0).
    await openPicker(page);
    const items = page.locator('#cmd-list li');
    const ids = await items.evaluateAll((els) => els.map((e) => e.dataset.pickId));
    expect(ids).toEqual(['host:extra', 'host:prod', 'connect', 'add', 'config', 'folder']);
    await expect(page.locator('li[data-pick-id="host:prod"]')).toContainText(`deploy@127.0.0.1:${port}`);
    const folder = page.locator('li[data-pick-id="folder"]');
    await expect(folder).not.toHaveClass(/disabled/);
    await expect(folder).not.toContainText('Em breve');
    // Abre o seletor de host da pasta remota (o fluxo completo está em remote.spec.js).
    await folder.click();
    await expect(page.locator('#cmd-input')).toHaveAttribute('placeholder', 'Escolha o host da pasta remota');
    await expect(page.locator('li[data-pick-id="remote-host:prod"]')).toBeVisible();
    await page.keyboard.press('Escape');

    // Conectar a um host…: valida e abre terminal SSH com args em array.
    await openPicker(page);
    await page.click('li[data-pick-id="connect"]');
    const dlg = page.locator('#ssh-connect-dialog');
    await expect(dlg).toBeVisible();
    await dlg.locator('input').first().fill('-oProxyCommand=id@x');
    await dlg.locator('button[type="submit"]').click();
    await expect(dlg.locator('.git-dialog-error')).toContainText('Formato inválido');
    await dlg.locator('input').first().fill(`tester@127.0.0.1:${port}`);
    await dlg.locator('button[type="submit"]').click();
    await expect(dlg).toBeHidden();
    await expect.poll(async () => (await list(page)).map((s) => s.title)).toContain('SSH: 127.0.0.1');
    await expect.poll(async () => (await lastSpawn(app))?.args).toEqual(['-p', String(port), 'tester@127.0.0.1']);
    expect((await lastSpawn(app)).shell).toMatch(/ssh(\.exe)?$/);
    // Sessão ativa e viva (ssh esperando o banner): botão destacado.
    await expect(btn).toHaveClass(/connected/);
    await expect(btn).toContainText('SSH: 127.0.0.1');
    await expect.poll(() => sockets.size, { timeout: 10000 }).toBeGreaterThan(0);

    // Escolher um host do config.
    await openPicker(page);
    await page.click('li[data-pick-id="host:prod"]');
    await expect.poll(async () => (await list(page)).find((s) => s.active)?.title).toBe('SSH: prod');
    await expect.poll(async () => (await lastSpawn(app))?.args).toEqual(['prod']);
    const prod = (await list(page)).find((s) => s.title === 'SSH: prod');
    expect(prod.ssh).toEqual({ alias: 'prod' });

    // Adicionar novo host: grava no fim do config (resto intacto) e conecta.
    await openPicker(page);
    await page.click('li[data-pick-id="add"]');
    const add = page.locator('#ssh-add-host-dialog');
    await expect(add).toBeVisible();
    await add.locator('input').nth(0).fill(`ana@127.0.0.1:${port}`);
    await add.locator('input').nth(1).fill('novo-host');
    await add.locator('button[type="submit"]').click();
    await expect(add).toBeHidden();
    const after = fs.readFileSync(cfg, 'utf8');
    expect(after.startsWith(original)).toBe(true);
    expect(after.slice(original.length)).toBe(`\nHost novo-host\n  HostName 127.0.0.1\n  User ana\n  Port ${port}\n`);
    await expect.poll(async () => (await list(page)).find((s) => s.active)?.title).toBe('SSH: novo-host');
    await expect.poll(async () => (await lastSpawn(app))?.args).toEqual(['novo-host']);

    // Novo host aparece no seletor.
    await openPicker(page);
    await expect(page.locator('li[data-pick-id="host:novo-host"]')).toBeVisible();

    // Abrir arquivo de configuração SSH no editor.
    await page.click('li[data-pick-id="config"]');
    await expect.poll(() => page.evaluate(() => window.AgzosState.activePath)).toBe(cfg);

    // Matar as sessões SSH apaga o destaque.
    for (const s of await list(page)) await page.evaluate((id) => window.AgzosTerminal.kill(id), s.id);
    await expect(btn).not.toHaveClass(/connected/);

    // Paleta: comandos registrados.
    await page.keyboard.press('Control+Shift+P');
    await page.locator('#cmd-input').fill('> SSH:');
    const labels = await page.locator('#cmd-list li').allInnerTexts();
    for (const l of ['SSH: Conectar ao Host…', 'SSH: Adicionar Novo Host…', 'SSH: Abrir Configuração SSH']) {
      expect(labels.some((t) => t.includes(l))).toBe(true);
    }
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
  } finally {
    await app.close();
    for (const s of sockets) s.destroy();
    server.close();
  }
});

test('SSH: perfil "SSH…" no menu de perfis do terminal abre o seletor', async () => {
  test.setTimeout(60000);
  const { home } = fixtureHome(1);
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
    env: { HOME: home },
  });
  try {
    const profiles = await page.evaluate(() => window.agzos.term.profiles());
    const ssh = profiles.profiles.find((p) => p.id === 'ssh');
    expect(ssh).toMatchObject({ label: 'SSH…', picker: true });
    expect(profiles.defaultId).not.toBe('ssh');

    await page.click('#btn-toggle-terminal');
    await page.waitForFunction(() => !!window.AgzosState?.term?.id, null, { timeout: 10000 });
    await page.click('#btn-term-profiles');
    await page.click('#term-profiles-menu [data-profile-id="ssh"]');
    await expect(page.locator('#cmd-overlay')).toBeVisible();
    await expect(page.locator('li[data-pick-id="host:prod"]')).toBeVisible();
    expect((await list(page)).length).toBe(1); // não criou sessão
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
