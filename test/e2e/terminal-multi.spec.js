const net = require('net');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const SHOTS = process.env.AGZOS_E2E_SHOTS || null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const list = (page) => page.evaluate(() => window.AgzosTerminal.list());
const buffer = (page, id) => page.evaluate((sid) => window.AgzosTerminal.buffer(sid), id);
const activeId = async (page) => (await list(page)).find((s) => s.active)?.id || null;

function rect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
}

async function waitReady(page, count) {
  await expect.poll(async () => {
    const l = await list(page);
    return l.length === count && l.every((s) => !!s.termId);
  }, { timeout: 10000 }).toBe(true);
}

async function typeIn(page, id, text) {
  await page.locator(`.term-instance[data-session-id="${id}"] .xterm`).click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

function pidAlive(app, pid) {
  return app.evaluate((_e, p) => {
    try { process.kill(p, 0); return true; } catch { return false; }
  }, pid);
}

async function openTerminal(page) {
  await page.click('#btn-toggle-terminal');
  await page.waitForFunction(() => !!window.AgzosState?.term?.id, null, { timeout: 10000 });
  await waitReady(page, 1);
}

test('várias sessões: saída isolada, lista, atalhos, divisão, matar e reabrir', async () => {
  test.setTimeout(90000);
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await openTerminal(page);
    // Uma sessão: lista lateral escondida, nome do shell no toolbar
    await expect(page.locator('#term-sessions')).toBeHidden();
    await expect(page.locator('#term-active-name')).not.toHaveText('');
    const [s1] = (await list(page)).map((s) => s.id);
    await typeIn(page, s1, 'echo um-$((10+1))');

    // + cria a segunda
    await page.click('#btn-term-new');
    await waitReady(page, 2);
    const s2 = await activeId(page);
    expect(s2).not.toBe(s1);
    await expect(page.locator('#term-sessions')).toBeVisible();
    await typeIn(page, s2, 'echo dois-$((20+2))');

    // Ctrl+Shift+` com foco no xterm cria a terceira (atalho não vai para o shell)
    await page.locator(`.term-instance[data-session-id="${s2}"] .xterm`).click();
    await page.keyboard.press('Control+Shift+Backquote');
    await waitReady(page, 3);
    const s3 = await activeId(page);
    await typeIn(page, s3, 'echo tres-$((30+3))');

    await expect.poll(() => buffer(page, s1), { timeout: 10000 }).toMatch(/^um-11\s*$/m);
    await expect.poll(() => buffer(page, s2), { timeout: 10000 }).toMatch(/^dois-22\s*$/m);
    await expect.poll(() => buffer(page, s3), { timeout: 10000 }).toMatch(/^tres-33\s*$/m);
    // Nada vaza entre sessões
    expect(await buffer(page, s1)).not.toMatch(/dois-22|tres-33/);
    expect(await buffer(page, s2)).not.toMatch(/um-11|tres-33/);
    expect(await buffer(page, s3)).not.toMatch(/um-11|dois-22/);
    // termIds distintos
    const ids = (await list(page)).map((s) => s.termId);
    expect(new Set(ids).size).toBe(3);
    await expect(page.locator('#term-sessions .term-session-row')).toHaveCount(3);
    await shot(page, '10-three-sessions-list');

    // Alternar pela lista
    await page.click(`#term-sessions .term-session-row[data-session-id="${s1}"]`);
    await expect.poll(() => activeId(page)).toBe(s1);
    await expect(page.locator(`.term-instance[data-session-id="${s1}"]`)).toBeVisible();
    await expect(page.locator(`.term-instance[data-session-id="${s2}"]`)).toBeHidden();
    expect(await page.evaluate(() => window.AgzosState.term.sessionId)).toBe(s1);
    // State.term (usado pela IA) aponta para a ativa
    expect(await page.evaluate(() => window.AgzosState.term.term.buffer.active.length)).toBeGreaterThan(0);

    // Ctrl+PageDown / PageUp com foco no terminal
    await page.locator(`.term-instance[data-session-id="${s1}"] .xterm`).click();
    await page.keyboard.press('Control+PageDown');
    await expect.poll(() => activeId(page)).toBe(s2);
    await page.keyboard.press('Control+PageUp');
    await expect.poll(() => activeId(page)).toBe(s1);

    // Dividir: duas .xterm visíveis lado a lado
    await page.click('#btn-term-split');
    await waitReady(page, 4);
    const s4 = await activeId(page);
    const l4 = await list(page);
    expect(l4.find((s) => s.id === s4).groupSize).toBe(2);
    expect(l4.find((s) => s.id === s1).groupId).toBe(l4.find((s) => s.id === s4).groupId);
    await expect(page.locator('#terminal-host .term-group:not([hidden]) .xterm')).toHaveCount(2);
    const ra = await rect(page, `.term-instance[data-session-id="${s1}"]`);
    const rb = await rect(page, `.term-instance[data-session-id="${s4}"]`);
    expect(ra.width).toBeGreaterThan(80);
    expect(rb.width).toBeGreaterThan(80);
    expect(ra.right).toBeLessThanOrEqual(rb.left + 1);
    expect(Math.abs(ra.top - rb.top)).toBeLessThan(2);
    await typeIn(page, s4, 'echo quatro-$((40+4))');
    await expect.poll(() => buffer(page, s4), { timeout: 10000 }).toMatch(/^quatro-44\s*$/m);
    expect(await buffer(page, s1)).not.toMatch(/quatro-44/);
    // Arrastar o divisor redimensiona as metades
    const div = await rect(page, '#terminal-host .term-group:not([hidden]) .term-divider');
    await page.mouse.move(div.left + div.width / 2, div.top + div.height / 2);
    await page.mouse.down();
    await page.mouse.move(div.left + 80, div.top + div.height / 2, { steps: 5 });
    await page.mouse.up();
    const ra2 = await rect(page, `.term-instance[data-session-id="${s1}"]`);
    expect(ra2.width).toBeGreaterThan(ra.width + 40);
    // Glifos de divisão na lista
    await expect(page.locator(`#term-sessions .term-session-row[data-session-id="${s1}"] .term-session-glyph`)).toHaveText('┌');
    await shot(page, '11-split-with-list');

    // Ctrl+Shift+5 divide de novo (3 no grupo)
    await page.locator(`.term-instance[data-session-id="${s4}"] .xterm`).click();
    await page.keyboard.press('Control+Shift+Digit5');
    await waitReady(page, 5);
    await expect(page.locator('#terminal-host .term-group:not([hidden]) .xterm')).toHaveCount(3);
    const s5 = await activeId(page);

    // Renomear por duplo clique
    await page.dblclick(`#term-sessions .term-session-row[data-session-id="${s5}"]`);
    await page.locator('#term-sessions .term-rename-input').fill('servidor');
    await page.keyboard.press('Enter');
    await expect(page.locator(`#term-sessions .term-session-row[data-session-id="${s5}"] .term-session-title`)).toHaveText('servidor');
    await expect(page.locator('#term-active-name')).toHaveText('servidor');

    // Matar uma sessão encerra o processo dela
    await page.click(`#term-sessions .term-session-row[data-session-id="${s2}"]`);
    await expect.poll(() => activeId(page)).toBe(s2);
    await typeIn(page, s2, 'echo PID=$$');
    await expect.poll(() => buffer(page, s2), { timeout: 10000 }).toMatch(/^PID=\d+\s*$/m);
    const pid = Number((await buffer(page, s2)).match(/^PID=(\d+)\s*$/m)[1]);
    expect(await pidAlive(app, pid)).toBe(true);
    await page.hover(`#term-sessions .term-session-row[data-session-id="${s2}"]`);
    await page.click(`#term-sessions .term-session-row[data-session-id="${s2}"] .term-session-kill`);
    await expect(page.locator('#term-sessions .term-session-row')).toHaveCount(4);
    await expect(page.locator(`.term-instance[data-session-id="${s2}"]`)).toHaveCount(0);
    await expect.poll(() => pidAlive(app, pid), { timeout: 10000 }).toBe(false);

    // Matar todas pela lixeira do toolbar: a última fecha o painel
    for (let i = 0; i < 4; i++) await page.click('#btn-term-kill');
    await expect(page.locator('#bottom-panel')).toBeHidden();
    expect(await list(page)).toEqual([]);
    expect(await page.evaluate(() => window.AgzosState.term)).toBeNull();
    expect(await page.evaluate(() => document.querySelectorAll('#terminal-host .term-group').length)).toBe(0);

    // Reabrir cria uma sessão nova
    await page.click('#btn-toggle-terminal');
    await expect(page.locator('#bottom-panel')).toBeVisible();
    await waitReady(page, 1);
    const fresh = await list(page);
    expect(ids).not.toContain(fresh[0].termId);
    await typeIn(page, fresh[0].id, 'echo nova-$((5+5))');
    await expect.poll(() => buffer(page, fresh[0].id), { timeout: 10000 }).toMatch(/^nova-10\s*$/m);

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('perfis: menu lista bash e cria sessão com o perfil escolhido; paleta tem os comandos', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await openTerminal(page);
    const real = await page.evaluate(() => window.agzos.term.profiles());
    expect(real.profiles.some((p) => /bash/i.test(p.label) || /bash$/.test(p.shell))).toBe(true);

    await page.click('#btn-term-profiles');
    const menu = page.locator('#term-profiles-menu');
    await expect(menu).toBeVisible();
    const items = menu.locator('[data-term-action="new-profile"]');
    expect(await items.count()).toBe(real.profiles.length);
    await expect(menu).toContainText('bash');
    await shot(page, '12-profiles-menu');

    // Cria com o perfil "sh" se existir (prova que o shell muda), senão bash
    const target = real.profiles.find((p) => p.id !== real.defaultId && /(^|\/)sh$/.test(p.shell))
      || real.profiles.find((p) => /bash/.test(p.shell));
    await menu.locator(`[data-profile-id="${target.id}"]`).click();
    await expect(menu).toHaveCount(0);
    await waitReady(page, 2);
    const created = (await list(page)).find((s) => s.active);
    expect(created.profileId).toBe(target.id);
    await typeIn(page, created.id, 'ps -o comm= -p $$ | sed "s/^/SHELL=/"');
    const base = target.shell.split('/').pop();
    await expect.poll(() => buffer(page, created.id), { timeout: 10000 })
      .toMatch(new RegExp(`^SHELL=(${base}|dash)\\s*$`, 'm'));

    // Escape fecha o menu
    await page.click('#btn-term-profiles');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // Paleta de comandos
    await page.keyboard.press('Control+Shift+P');
    await page.locator('#cmd-input').fill('> terminal');
    for (const label of ['Novo Terminal', 'Novo Terminal com Perfil', 'Dividir Terminal', 'Matar Terminal']) {
      await expect(page.locator('#cmd-list')).toContainText(label);
    }
    await page.locator('#cmd-input').fill('> perfil');
    await page.keyboard.press('Enter');
    await expect(page.locator('#cmd-list li').first()).toBeVisible();
    await expect(page.locator('#cmd-list')).toContainText('bash');
    await page.locator('#cmd-input').fill('bash');
    await page.keyboard.press('Enter');
    await expect(page.locator('#cmd-overlay')).toBeHidden();
    await waitReady(page, 3);

    // Processo que sai fica na lista marcado; Enter reinicia o shell na mesma sessão
    const victim = (await list(page)).find((s) => s.active);
    await typeIn(page, victim.id, 'exit');
    await expect(page.locator(`#term-sessions .term-session-row[data-session-id="${victim.id}"]`)).toHaveClass(/exited/);
    await expect.poll(() => buffer(page, victim.id), { timeout: 10000 }).toMatch(/Processo encerrou/);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await list(page)).find((s) => s.id === victim.id)?.termId || null, { timeout: 10000 })
      .not.toBeNull();
    await expect(page.locator(`#term-sessions .term-session-row[data-session-id="${victim.id}"]`)).not.toHaveClass(/exited/);
    await typeIn(page, victim.id, 'echo volta-$((6+6))');
    await expect.poll(() => buffer(page, victim.id), { timeout: 10000 }).toMatch(/^volta-12\s*$/m);

    // Toolbar do terminal some fora da aba TERMINAL
    await page.click('.bottom-tab[data-tab="output"]');
    await expect(page.locator('#btn-term-new')).toBeHidden();
    await expect(page.locator('#btn-ports-refresh')).toBeHidden();
    await page.click('.bottom-tab[data-tab="terminal"]');
    await expect(page.locator('#btn-term-new')).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('aba PORTAS lista porta aberta, copia endereço e abre no navegador', async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await app.evaluate(({ shell }) => {
      globalThis.__agzosOpened = [];
      shell.openExternal = async (u) => { globalThis.__agzosOpened.push(u); };
    });
    await openTerminal(page);
    await page.click('.bottom-tab[data-tab="ports"]');
    await expect(page.locator('#pane-ports')).toBeVisible();
    await expect(page.locator('#btn-ports-refresh')).toBeVisible();
    await expect(page.locator('#btn-term-new')).toBeHidden();
    const row = page.locator(`#ports-view tr[data-port="${port}"]`);
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(row).toContainText(String(port));
    await expect(page.locator('.bottom-tab[data-tab="ports"] .bottom-tab-count')).toBeVisible();
    await shot(page, '13-ports');

    await row.hover();
    await row.locator('[data-port-action="copy"]').click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`http://localhost:${port}`);
    await row.locator('[data-port-action="open"]').click();
    await expect.poll(() => app.evaluate(() => globalThis.__agzosOpened)).toEqual([`http://localhost:${port}`]);

    // Porta fechada some no refresh
    await new Promise((r) => server.close(r));
    await page.click('#btn-ports-refresh');
    await expect(row).toHaveCount(0, { timeout: 10000 });

    expect(errors).toEqual([]);
  } finally {
    if (server.listening) server.close();
    await app.close();
  }
});
