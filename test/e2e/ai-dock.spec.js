const { test, expect } = require('@playwright/test');
const { launchApp, readSettings } = require('./helpers');

const SHOTS = process.env.AGZOS_E2E_SHOTS || null;
const READY = { welcomeSeen: true, onboardingCompleted: true };

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

function rect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
}

async function drag(page, selector, dx, dy) {
  const r = await rect(page, selector);
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

async function dragTo(page, selector, targetX) {
  const r = await rect(page, selector);
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 8 });
  await page.mouse.up();
}

// Sentinela com textarea: prova que o nó é movido (mesma identidade), não recriado.
async function plantSentinel(page) {
  await page.evaluate(() => {
    const panel = document.getElementById('ai-panel');
    const s = document.createElement('div');
    s.id = 'dock-sentinel';
    s.style.cssText = 'flex:1;min-height:40px;padding:8px;color:var(--fg)';
    s.innerHTML = '<p>sentinela do dock</p><textarea id="dock-sentinel-input" rows="2"></textarea>';
    panel.appendChild(s);
    window.__dockSentinel = s;
    window.__dockPanel = panel;
  });
}

function dockInfo(page) {
  return page.evaluate(() => {
    const panel = document.getElementById('ai-panel');
    return {
      position: window.AgzosAiDock.getPosition(),
      visible: window.AgzosAiDock.isVisible(),
      samePanel: panel === window.__dockPanel,
      sameSentinel: !!window.__dockSentinel && panel.contains(window.__dockSentinel),
      host: panel.parentElement?.id,
      dataPosition: panel.dataset.position,
    };
  });
}

const HOST = { left: 'panel-ai', right: 'right-dock-host', bottom: 'pane-ai' };

test('dock da IA: move entre esquerda/direita/embaixo sem recriar, redimensiona e persiste', async () => {
  const first = await launchApp({ settings: READY });
  const { page, userData } = first;
  let second = null;
  try {
    await page.waitForFunction(() => !!window.AgzosAiDock);
    const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

    // Padrão 0.6.0: direita, visível
    let info = await dockInfo(page);
    expect(info.position).toBe('right');
    expect(info.visible).toBe(true);
    expect(info.host).toBe('right-dock-host');
    await expect(page.locator('#right-dock')).toBeVisible();
    await expect(page.locator('.bottom-tab[data-tab="ai"]')).toBeHidden();

    await plantSentinel(page);
    const events = [];
    await page.exposeFunction('__dockEvent', (d) => events.push(d));
    await page.evaluate(() => window.addEventListener('agzos:ai-dock', (e) => window.__dockEvent(e.detail)));

    for (const pos of ['right', 'bottom', 'left', 'right']) {
      await page.evaluate((p) => window.AgzosAiDock.setPosition(p, { show: true }), pos);
      await page.waitForTimeout(150);
      info = await dockInfo(page);
      expect(info).toEqual({
        position: pos, visible: true, samePanel: true, sameSentinel: true, host: HOST[pos], dataPosition: pos,
      });
      await expect(page.locator('#dock-sentinel')).toBeVisible();
      const panel = await rect(page, '#ai-panel');
      expect(panel.width).toBeGreaterThan(150);
      expect(panel.height).toBeGreaterThan(100);
      const editor = await rect(page, '#editor-host');
      expect(editor.width).toBeGreaterThan(win.w * 0.4);
      expect(editor.height).toBeGreaterThan(win.h * 0.4);
      // Hosts que não estão em uso ficam ocultos
      await expect(page.locator('#right-dock')).toBeVisible({ visible: pos === 'right' });
      await expect(page.locator('#right-dock-resizer')).toBeVisible({ visible: pos === 'right' });
      await expect(page.locator('.bottom-tab[data-tab="ai"]')).toBeVisible({ visible: pos === 'bottom' });
      if (pos === 'bottom') {
        await expect(page.locator('#bottom-panel')).toBeVisible();
        await expect(page.locator('.bottom-tab[data-tab="ai"]')).toHaveClass(/active/);
        // IA abaixo do editor
        expect(panel.top).toBeGreaterThanOrEqual(editor.bottom - 1);
      }
      if (pos === 'left') {
        await expect(page.locator('.activity-btn[data-view="ai"]')).toHaveClass(/active/);
        expect(panel.right).toBeLessThanOrEqual(editor.left + 1);
      }
      if (pos === 'right') expect(panel.left).toBeGreaterThanOrEqual(editor.right - 1);
      await shot(page, `dock-${pos}`);
    }
    expect(events.at(-1)).toEqual({ position: 'right', visible: true });

    // Divisor da direita: arrastar para a esquerda alarga; limites 280 / 60vw
    const w0 = (await rect(page, '#right-dock')).width;
    await drag(page, '#right-dock-resizer', -150, 0);
    const w1 = (await rect(page, '#right-dock')).width;
    expect(w1).toBeGreaterThan(w0 + 100);
    await expect.poll(() => readSettings(userData).aiPanel?.width).toBe(Math.round(w1));
    // Arrastos até a borda da janela (mousemove fora da janela não chega)
    await dragTo(page, '#right-dock-resizer', win.w - 5);
    expect((await rect(page, '#right-dock')).width).toBeCloseTo(280, 0);
    await dragTo(page, '#right-dock-resizer', 60);
    const wMax = (await rect(page, '#right-dock')).width;
    expect(wMax).toBeLessThanOrEqual(win.w * 0.6 + 1);
    expect(wMax).toBeGreaterThan(win.w * 0.6 - 2);
    await dragTo(page, '#right-dock-resizer', win.w - 420); // ~420px
    const savedWidth = Math.round((await rect(page, '#right-dock')).width);

    // hide/show/toggle
    await page.evaluate(() => window.AgzosAiDock.hide());
    await expect(page.locator('#right-dock')).toBeHidden();
    expect((await dockInfo(page)).visible).toBe(false);
    await page.evaluate(() => window.AgzosAiDock.toggle());
    await expect(page.locator('#right-dock')).toBeVisible();

    // Termina embaixo para checar persistência
    await page.evaluate(() => window.AgzosAiDock.setPosition('bottom', { show: true }));
    await expect.poll(() => readSettings(userData).aiPanel).toMatchObject({ position: 'bottom', visible: true, width: savedWidth });
    expect(first.errors).toEqual([]);
    await first.app.close();

    // Reinício com o mesmo userData: posição/visibilidade/largura restauradas
    second = await launchApp({ userData });
    await second.page.waitForFunction(() => !!window.AgzosAiDock);
    info = await dockInfo(second.page);
    expect(info.position).toBe('bottom');
    expect(info.host).toBe('pane-ai');
    expect(info.visible).toBe(true);
    await expect(second.page.locator('#bottom-panel')).toBeVisible();
    await expect(second.page.locator('#pane-ai')).toBeVisible();
    await expect(second.page.locator('#right-dock')).toBeHidden();
    await second.page.evaluate(() => window.AgzosAiDock.setPosition('right', { show: true }));
    expect(Math.round((await rect(second.page, '#right-dock')).width)).toBe(savedWidth);
    expect(second.errors).toEqual([]);
  } finally {
    await first.app.close().catch(() => {});
    if (second) await second.app.close().catch(() => {});
  }
});

function bufferText(page) {
  return page.evaluate(() => {
    const t = window.AgzosState?.term?.term;
    if (!t) return '';
    const buf = t.buffer.active;
    const lines = [];
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) || '');
    return lines.join('\n');
  });
}

test('Ctrl+L alterna o painel da IA, não age no xterm e o terminal convive com a aba IA', async () => {
  const { app, page, errors } = await launchApp({ settings: READY });
  try {
    await page.waitForFunction(() => !!window.AgzosAiDock);
    await plantSentinel(page);
    const visible = () => page.evaluate(() => window.AgzosAiDock.isVisible());
    const focusInPanel = () => page.evaluate(() => !!document.activeElement?.closest('#ai-panel'));

    // Visível (padrão) com foco fora → Ctrl+L foca a caixa
    expect(await visible()).toBe(true);
    await page.locator('#editor-host').click({ position: { x: 20, y: 20 } }).catch(() => {});
    await page.keyboard.press('Control+l');
    await expect.poll(focusInPanel).toBe(true);
    // Foco dentro → Ctrl+L fecha
    await page.keyboard.press('Control+l');
    await expect.poll(visible).toBe(false);
    await expect(page.locator('#right-dock')).toBeHidden();
    // Fechado → Ctrl+L abre e foca
    await page.keyboard.press('Control+l');
    await expect.poll(visible).toBe(true);
    await expect.poll(focusInPanel).toBe(true);

    // Embaixo: abas TERMINAL e AGZOS IA no mesmo painel
    await page.evaluate(() => window.AgzosAiDock.setPosition('bottom', { show: true }));
    await expect(page.locator('#pane-ai')).toBeVisible();
    await expect(page.locator('#pane-terminal')).toBeHidden();
    // Botões só do terminal somem na aba IA
    await expect(page.locator('#btn-term-new')).toBeHidden();
    await expect(page.locator('#btn-term-more')).toBeHidden();

    // Ctrl+` com o painel aberto na aba IA vai para o terminal (não fecha)
    await page.locator('#dock-sentinel-input').focus();
    await page.keyboard.press('Control+`');
    await expect(page.locator('#pane-terminal')).toBeVisible();
    await expect(page.locator('#terminal-host .xterm')).toBeVisible();
    await page.waitForFunction(() => !!window.AgzosState?.term?.id, null, { timeout: 10000 });
    await expect(page.locator('#btn-term-new')).toBeVisible();
    expect(await visible()).toBe(false);

    // Ctrl+L dentro do xterm é do shell: não mexe no dock
    await page.locator('#terminal-host .xterm').click();
    await page.keyboard.press('Control+l');
    await page.waitForTimeout(200);
    expect(await visible()).toBe(false);
    await expect(page.locator('#pane-terminal')).toBeVisible();

    // Troca de abas: IA → terminal mantém xterm com tamanho e funcional
    await page.click('.bottom-tab[data-tab="ai"]');
    await expect(page.locator('#pane-ai')).toBeVisible();
    await expect(page.locator('#dock-sentinel')).toBeVisible();
    expect(await visible()).toBe(true);
    await page.click('.bottom-tab[data-tab="terminal"]');
    await expect(page.locator('#terminal-host .xterm')).toBeVisible();
    await page.waitForTimeout(150);
    const xr = await rect(page, '#terminal-host .xterm-screen');
    expect(xr.width).toBeGreaterThan(100);
    expect(xr.height).toBeGreaterThan(30);
    await page.locator('#terminal-host .xterm').click();
    await page.keyboard.type('echo dock-$((20+3))-ok');
    await page.keyboard.press('Enter');
    await expect.poll(() => bufferText(page), { timeout: 10000 }).toMatch(/^dock-23-ok\s*$/m);

    // Fechar o painel inferior e Ctrl+L reabre na aba IA
    await page.click('#btn-close-bottom');
    await expect(page.locator('#bottom-panel')).toBeHidden();
    await page.locator('#editor-host').click({ position: { x: 20, y: 20 } }).catch(() => {});
    await page.keyboard.press('Control+l');
    await expect(page.locator('#bottom-panel')).toBeVisible();
    await expect(page.locator('#pane-ai')).toBeVisible();
    await expect.poll(focusInPanel).toBe(true);

    // Voltar para a direita devolve o painel inferior ao terminal
    await page.evaluate(() => window.AgzosAiDock.setPosition('right', { show: true }));
    await expect(page.locator('.bottom-tab[data-tab="ai"]')).toBeHidden();
    await expect(page.locator('#right-dock')).toBeVisible();

    // Paleta: comando de mover
    await page.keyboard.press('Control+Shift+P');
    await page.locator('#cmd-input').fill('>Agzos IA: Mover para Esquerda');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.AgzosAiDock.getPosition())).toBe('left');
    await expect(page.locator('#panel-ai #dock-sentinel')).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
