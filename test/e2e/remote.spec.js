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

test('pasta remota: chave do host de outro tipo que a registrada bloqueia (não vira "desconhecido")', async () => {
  test.setTimeout(60000);
  const { root } = makeRemoteRoot();
  // Servidor só com ssh-rsa; o known_hosts tem ssh-ed25519 para o host.
  const server = createSshServer({
    root, hostKey: generateKey('rsa', { bits: 2048 }).private, users: { deploy: { publicKeys: [userKey.public] } },
  });
  await server.listen();
  const home = makeHome(server.port, { trust: publicBlob(generateKey().private) });
  const { app, page } = await launch(home);
  try {
    await pickHost(page, 'fixture');
    const blocked = page.locator('#remote-hostkey-blocked');
    await expect(blocked).toBeVisible({ timeout: 15000 });
    await expect(blocked).toContainText('diferente da registrada');
    await expect(blocked).toContainText('ataque');
    await expect(blocked.locator('button')).toHaveCount(1);
    await expect(page.locator('#remote-hostkey-dialog')).toHaveCount(0);
    await blocked.locator('button').click();
    expect(await page.evaluate(() => window.agzos.remote.list())).toEqual([]);
  } finally {
    await app.close();
    await server.close();
  }
});

test('pasta remota: agente não lê arquivo fora da raiz por symlink do host', async () => {
  test.setTimeout(90000);
  const { startFakeOpenAI } = require('./fake-openai');
  const { root, proj } = makeRemoteRoot();
  const fora = path.join(root, 'fora');
  fs.mkdirSync(fora);
  fs.writeFileSync(path.join(fora, 'segredo'), 'SEGREDO-DO-HOST\n');
  fs.symlinkSync(fora, path.join(proj, 'cfg'));
  const server = await startServer(root);
  const home = makeHome(server.port, { trust: server.hostPublic });
  const fake = await startFakeOpenAI({
    delayMs: 5,
    script: [
      { toolCalls: [{ name: 'read_file', arguments: { path: 'cfg/segredo' } }] },
      { text: 'Não consegui.' },
    ],
  });
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true, aiAgent: { mode: 'auto' } },
    env: { HOME: home, SSH_AUTH_SOCK: '', AGZOS_REMOTE_RETRY_MS: '150' },
  });
  const rootUri = `ssh://fixture${proj}`;
  try {
    await page.evaluate(async (uri) => {
      await window.AgzosRemote.connect('fixture');
      await window.AgzosRemote.openFolder(uri);
    }, rootUri);
    await expect.poll(() => page.evaluate(() => window.AgzosState.workspaceRoot)).toBe(rootUri);
    // fs IPC também nega (mesmo provider).
    const viaIpc = await page.evaluate((u) => window.agzos.fs.readFile(`${u}/cfg/segredo`).then(() => 'lido', (e) => String(e.message || e)), rootUri);
    expect(viaIpc).toContain('Acesso negado');
    await page.evaluate(async (url) => {
      await window.agzos.ai.saveProfile({ preset: 'custom', label: 'Fake', baseUrl: `${url}/v1`, model: 'fake-1' });
      window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
      window.AgzosAiDock.show();
    }, fake.baseUrl);
    await expect(page.locator('#ai-skill-btn')).toHaveAttribute('data-skill', 'agent');
    await page.locator('#ai-input').fill('Leia cfg/segredo');
    await page.locator('#ai-input').press('Enter');
    await expect(page.locator('.ag-step[data-tool="read_file"]')).toHaveAttribute('data-status', 'error', { timeout: 15000 });
    await expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'send', { timeout: 15000 });
    const sent = JSON.stringify(fake.requests.map((r) => r.body));
    expect(sent).toContain('Acesso negado');
    expect(sent).not.toContain('SEGREDO-DO-HOST');
  } finally {
    await app.close();
    await fake.close();
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

test('pasta remota: terminal no host, git status/commit remoto e agente editando arquivo remoto', async () => {
  test.setTimeout(120000);
  const { startFakeOpenAI } = require('./fake-openai');
  const { execFileSync } = require('child_process');
  const { root, proj } = makeRemoteRoot();
  execFileSync('git', ['init', '-q', '-b', 'main', proj]);
  const server = await startServer(root);
  const home = makeHome(server.port, { trust: server.hostPublic });
  const fake = await startFakeOpenAI({
    delayMs: 5,
    script: [
      { toolCalls: [{ name: 'edit_file', arguments: { path: 'src/app.js', old_string: 'const alvo = 1;', new_string: 'const alvo = 42;' } }] },
      { toolCalls: [{ name: 'write_file', arguments: { path: 'novo/criado.txt', content: 'feito pelo agente\n' } }] },
      { text: 'Pronto no host.' },
    ],
  });
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true, aiAgent: { mode: 'auto' } },
    env: {
      HOME: home, SSH_AUTH_SOCK: '', AGZOS_REMOTE_RETRY_MS: '150',
      GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 't@x.com', GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 't@x.com',
    },
  });
  const rootUri = `ssh://fixture${proj}`;
  try {
    await page.evaluate(async (uri) => {
      await window.AgzosRemote.connect('fixture');
      await window.AgzosRemote.openFolder(uri);
    }, rootUri);
    await expect.poll(() => page.evaluate(() => window.AgzosState.workspaceRoot)).toBe(rootUri);

    // Terminal: perfil "SSH: fixture" é o padrão e abre o shell no host, já na raiz.
    const profiles = await page.evaluate(async () => (await import('./scripts/terminal.js')).getTerminalProfiles());
    expect(profiles.defaultId).toBe('ssh-remote');
    expect(profiles.profiles[0].label).toBe('SSH: fixture');
    await page.evaluate(() => window.AgzosTerminal ? null : import('./scripts/terminal.js').then((m) => m.setupTerminalPanel()));
    const sid = await page.evaluate(() => window.AgzosTerminal.create());
    await expect.poll(async () => (await page.evaluate(() => window.AgzosTerminal.list())).find((t) => t.id === sid)?.termId || null).not.toBeNull();
    const term = (await page.evaluate(() => window.AgzosTerminal.list())).find((t) => t.id === sid);
    expect(term.profileId).toBe('ssh-remote');
    await page.evaluate((id) => window.agzos.term.write(id, 'echo "eco-$((40+2))"; pwd\n'), term.termId);
    await expect.poll(() => page.evaluate((id) => window.AgzosTerminal.buffer(id), sid), { timeout: 15000 }).toContain('eco-42');
    expect(await page.evaluate((id) => window.AgzosTerminal.buffer(id), sid)).toContain(proj);
    expect(server.execLog.some((c) => c.startsWith(`cd '${proj}' && exec "\${SHELL:-/bin/sh}" -l`))).toBe(true);

    // Git remoto: status, stage e commit pelo exec do host.
    const st = await page.evaluate((r) => window.agzos.git.status(r), rootUri);
    expect(st.ok).toBe(true);
    expect(st.data.root).toBe(rootUri);
    expect(st.data.changes.map((f) => f.path)).toContain('src/app.js');
    expect((await page.evaluate((r) => window.agzos.git.stage(r, []), rootUri)).ok).toBe(true);
    const c = await page.evaluate((r) => window.agzos.git.commit(r, 'commit remoto'), rootUri);
    expect(c.ok).toBe(true);
    expect(execFileSync('git', ['-C', proj, 'log', '-1', '--format=%s']).toString().trim()).toBe('commit remoto');

    // Agente (modo automático) edita e cria arquivos no host; desfazer restaura pelo provider.
    await page.evaluate(async (url) => {
      await window.agzos.ai.saveProfile({ preset: 'custom', label: 'Fake', baseUrl: `${url}/v1`, model: 'fake-1' });
      window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
      window.AgzosAiDock.show();
    }, fake.baseUrl);
    await expect(page.locator('#ai-skill-btn')).toHaveAttribute('data-skill', 'agent');
    await page.locator('#ai-input').fill('Troque o alvo para 42');
    await page.locator('#ai-input').press('Enter');
    await expect(page.locator('.ag-step[data-tool="edit_file"]')).toHaveAttribute('data-status', 'ok', { timeout: 15000 });
    await expect(page.locator('.ag-step[data-tool="write_file"]')).toHaveAttribute('data-status', 'ok', { timeout: 15000 });
    await expect(page.locator('#ai-send')).toHaveAttribute('data-state', 'send', { timeout: 15000 });
    expect(fs.readFileSync(path.join(proj, 'src', 'app.js'), 'utf8')).toContain('const alvo = 42;');
    expect(fs.readFileSync(path.join(proj, 'novo', 'criado.txt'), 'utf8')).toBe('feito pelo agente\n');
    await expect(page.locator('.ag-summary .ag-file')).toHaveCount(2);
    await page.locator('.ag-undo').click();
    await page.locator('.ag-undo-confirm').click();
    await expect(page.locator('.ag-summary')).toHaveClass(/is-undone/, { timeout: 15000 });
    await expect.poll(() => fs.readFileSync(path.join(proj, 'src', 'app.js'), 'utf8')).toContain('const alvo = 1;');
    expect(fs.existsSync(path.join(proj, 'novo'))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fake.close();
    await server.close();
  }
});

test('pasta remota (integração): Git Slider/histórico, Agzos Árvore e Agzos Ao Vivo no host', async () => {
  test.setTimeout(120000);
  const http = require('http');
  const { execFileSync } = require('child_process');
  const { root, proj } = makeRemoteRoot();
  fs.writeFileSync(path.join(proj, '.gitignore'), 'ignorado/\n');
  fs.mkdirSync(path.join(proj, 'ignorado'));
  fs.writeFileSync(path.join(proj, 'ignorado', 'x.txt'), 'x');
  fs.writeFileSync(path.join(proj, 'index.html'), '<!doctype html><html><body><h1>Remoto ao vivo</h1></body></html>');
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Teste', GIT_AUTHOR_EMAIL: 't@x.com', GIT_COMMITTER_NAME: 'Teste', GIT_COMMITTER_EMAIL: 't@x.com' };
  execFileSync('git', ['init', '-q', '-b', 'main', proj]);
  execFileSync('git', ['-C', proj, 'add', '-A'], { env: gitEnv });
  execFileSync('git', ['-C', proj, 'commit', '-q', '-m', 'commit no host'], { env: gitEnv });
  const server = await startServer(root);
  const home = makeHome(server.port, { trust: server.hostPublic });
  const { app, page, errors } = await launch(home);
  const rootUri = `ssh://fixture${proj}`;
  const fileUri = `${rootUri}/src/app.js`;
  try {
    await page.evaluate(async (uri) => {
      await window.AgzosRemote.connect('fixture');
      await window.AgzosRemote.openFolder(uri);
    }, rootUri);
    await expect.poll(() => page.evaluate(() => window.AgzosState.workspaceRoot)).toBe(rootUri);

    // Git Slider: salvar 2 vezes → 2 marcadores locais; o commit feito no host aparece.
    await page.evaluate((p) => window.AgzosEditor.openFile(p), fileUri);
    for (const n of [2, 3]) {
      await page.evaluate((v) => {
        const model = window.monaco.editor.getModels().find((m) => m.getValue().includes('alvo'));
        model.setValue(`const alvo = ${v};\n`);
      }, n);
      await page.evaluate(() => window.AgzosEditor.saveActive());
      await expect.poll(() => fs.readFileSync(path.join(proj, 'src', 'app.js'), 'utf8')).toBe(`const alvo = ${n};\n`);
      // recordSave lê o arquivo depois do salvamento: espera a versão antes de salvar de novo.
      await expect.poll(async () => (await page.evaluate((p) => window.agzos.history.list(p), fileUri)).length, { timeout: 15000 }).toBe(n - 1);
    }
    await expect.poll(async () => (await page.evaluate((p) => window.agzos.history.timeline(p), fileUri)).items.filter((i) => i.kind === 'local').length, { timeout: 15000 }).toBe(2);
    const tl = await page.evaluate((p) => window.agzos.history.timeline(p), fileUri);
    expect(tl.git).toBe(true);
    const commit = tl.items.find((i) => i.kind === 'commit');
    expect(commit.message).toBe('commit no host');
    // Conteúdo do commit vem do host (git show) e o local guarda a cópia salva.
    expect((await page.evaluate(([p, v]) => window.agzos.history.read(p, v), [fileUri, commit.versionId])).content).toBe('const alvo = 1;\n// agulha no palheiro\n');
    const firstLocal = tl.items.find((i) => i.kind === 'local');
    expect((await page.evaluate(([p, v]) => window.agzos.history.read(p, v), [fileUri, firstLocal.versionId])).content).toBe('const alvo = 2;\n');
    // Restaurar a versão do commit escreve no host.
    await page.evaluate(([p, v]) => window.agzos.history.restore(p, v), [fileUri, commit.versionId]);
    expect(fs.readFileSync(path.join(proj, 'src', 'app.js'), 'utf8')).toBe('const alvo = 1;\n// agulha no palheiro\n');

    // Agzos Árvore: lida do host, respeitando o .gitignore de lá.
    const tree = await page.evaluate((d) => window.agzos.tree.generate(d, { depth: 3, gitignore: true }), rootUri);
    expect(tree.text.split('\n')[0]).toBe('proj/');
    expect(tree.text).toContain('app.js');
    expect(tree.text).toContain('index.html');
    expect(tree.text).not.toContain('ignorado');

    // Agzos Ao Vivo: servidor em 127.0.0.1 servindo o arquivo do host (com script de recarga).
    const live = await page.evaluate((p) => window.agzos.live.start(p, { open: false }), `${rootUri}/index.html`);
    expect(live.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const get = (u) => new Promise((resolve, reject) => {
      http.get(u, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', reject);
    });
    const html = await get(live.openUrl);
    expect(html.status).toBe(200);
    expect(html.body).toContain('Remoto ao vivo');
    expect(html.body).toContain('<script');
    const png = await get(`${live.url}tiny.png`);
    expect(png.status).toBe(200);
    expect((await get(`${live.url}..%2f..%2ffora.txt`)).status).not.toBe(200);
    await page.evaluate(() => window.agzos.live.stop());
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await server.close();
  }
});
