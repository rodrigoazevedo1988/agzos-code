const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

const SHOTS = process.env.AGZOS_E2E_SHOTS || null;

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

function scrollState(page) {
  return page.evaluate(() => ({
    scrolling: document.scrollingElement ? document.scrollingElement.scrollTop : 0,
    body: document.body.scrollTop,
    main: document.getElementById('main').scrollTop,
    workbench: document.getElementById('workbench-body').scrollTop,
    innerHeight: window.innerHeight,
  }));
}

async function expectChromeInViewport(page) {
  const s = await scrollState(page);
  expect(s.scrolling).toBe(0);
  expect(s.body).toBe(0);
  expect(s.main).toBe(0);
  expect(s.workbench).toBe(0);
  const top = await rect(page, '#topbar');
  expect(top.top).toBe(0);
  const status = await rect(page, '#statusbar');
  expect(status.height).toBeGreaterThan(0);
  expect(status.bottom).toBeLessThanOrEqual(s.innerHeight + 0.5);
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

test('layout do workbench: editor ocupa a área e terminal redimensiona/move', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));

    // 1) Terminal fechado: editor-host ocupa a maior parte da janela
    await expect(page.locator('#bottom-panel')).toBeHidden();
    await expect(page.locator('#panel-resizer')).toBeHidden();
    const host0 = await rect(page, '#editor-host');
    expect(host0.height).toBeGreaterThan(win.h * 0.5);
    const welcome0 = await rect(page, '#welcome');
    expect(welcome0.height).toBeGreaterThan(win.h * 0.5);
    const monaco0 = await rect(page, '#editor-host .monaco-editor');
    expect(monaco0.height).toBeGreaterThan(win.h * 0.5);
    await expectChromeInViewport(page);
    await shot(page, '01-closed');

    // 2) Abre terminal embaixo
    await page.click('#btn-toggle-terminal');
    await expect(page.locator('#bottom-panel')).toBeVisible();
    await expect(page.locator('#panel-resizer')).toBeVisible();
    // xterm precisa montar mesmo com o loader AMD do Monaco presente
    await expect(page.locator('#terminal-host .xterm')).toBeVisible();
    await page.waitForTimeout(300); // fit + foco
    const host1 = await rect(page, '#editor-host');
    const panel1 = await rect(page, '#bottom-panel');
    expect(host1.height).toBeGreaterThan(100);
    expect(panel1.height).toBeGreaterThan(50);
    expect(panel1.top).toBeGreaterThanOrEqual(host1.bottom - 1);
    await expectChromeInViewport(page);
    await shot(page, '02-bottom');

    // 3) Arrastar o splitter para cima aumenta o painel
    await drag(page, '#panel-resizer', 0, -120);
    const panel2 = await rect(page, '#bottom-panel');
    expect(panel2.height).toBeGreaterThan(panel1.height + 60);
    const host2 = await rect(page, '#editor-host');
    expect(host2.height).toBeGreaterThan(50);
    await expectChromeInViewport(page);
    await shot(page, '03-bottom-dragged');

    // 4) Mover para a direita
    await page.click('#btn-pos-terminal');
    await expect(page.locator('#workbench-body')).toHaveClass(/panel-right/);
    const host3 = await rect(page, '#editor-host');
    const panel3 = await rect(page, '#bottom-panel');
    expect(panel3.width).toBeGreaterThan(100);
    expect(panel3.left).toBeGreaterThanOrEqual(host3.right - 1);
    expect(host3.width).toBeGreaterThan(100);
    expect(host3.height).toBeGreaterThan(win.h * 0.5);
    expect(panel3.height).toBeGreaterThan(win.h * 0.5);
    await expectChromeInViewport(page);
    await shot(page, '04-right');

    // 5) Arrastar o splitter para a esquerda aumenta a largura
    await drag(page, '#panel-resizer', -120, 0);
    const panel4 = await rect(page, '#bottom-panel');
    expect(panel4.width).toBeGreaterThan(panel3.width + 60);
    await expectChromeInViewport(page);
    await shot(page, '05-right-dragged');

    // 6) Maximizar e restaurar
    await page.click('#btn-maximize-bottom');
    await expect(page.locator('#workbench-body')).toHaveClass(/panel-maximized/);
    await expect(page.locator('#editor-area')).toBeHidden();
    const body = await rect(page, '#workbench-body');
    const panel5 = await rect(page, '#bottom-panel');
    expect(panel5.width).toBeGreaterThan(body.width - 2);
    expect(panel5.height).toBeGreaterThan(body.height - 2);
    await expectChromeInViewport(page);
    await shot(page, '06-maximized');
    await page.click('#btn-maximize-bottom');
    await expect(page.locator('#workbench-body')).not.toHaveClass(/panel-maximized/);
    await expect(page.locator('#editor-area')).toBeVisible();

    // 7) Voltar para baixo: largura inline não pode vazar
    await page.click('#btn-pos-terminal');
    await expect(page.locator('#workbench-body')).toHaveClass(/panel-bottom/);
    const host6 = await rect(page, '#editor-host');
    const panel6 = await rect(page, '#bottom-panel');
    expect(Math.abs(panel6.width - host6.width)).toBeLessThan(2);
    expect(host6.height).toBeGreaterThan(50);
    await expectChromeInViewport(page);
    await shot(page, '07-back-bottom');

    // 8) Fechar esconde painel e splitter
    await page.click('#btn-close-bottom');
    await expect(page.locator('#bottom-panel')).toBeHidden();
    await expect(page.locator('#panel-resizer')).toBeHidden();
    const host7 = await rect(page, '#editor-host');
    expect(host7.height).toBeGreaterThan(win.h * 0.5);
    await expectChromeInViewport(page);

    expect(errors).toEqual([]);
  } finally {
    await app.close();
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

for (const mode of ['pty', 'pipe']) {
  test(`terminal executa comandos digitados (modo ${mode})`, async () => {
    const { app, page, errors } = await launchApp({
      settings: { welcomeSeen: true, onboardingCompleted: true, terminal: { fontSize: 13, scrollback: 2500 } },
      env: mode === 'pipe' ? { AGZOS_TERM_NO_PTY: '1' } : { AGZOS_TERM_NO_PTY: '' },
    });
    try {
      await page.click('#btn-toggle-terminal');
      await expect(page.locator('#terminal-host .xterm')).toBeVisible();
      await page.waitForFunction(() => !!window.AgzosState?.term?.id, null, { timeout: 10000 });
      const info = await page.evaluate(() => ({
        mode: window.AgzosState.term.mode,
        scrollback: window.AgzosState.term.term.options.scrollback,
      }));
      expect(info.mode).toBe(mode);
      expect(info.scrollback).toBe(2500);

      await page.locator('#terminal-host .xterm').click();
      await page.keyboard.type('echo agzos-$((40+2))-ok');
      await page.keyboard.press('Enter');
      // A saída (não o eco do comando) só aparece se o shell executou a linha.
      await expect.poll(() => bufferText(page), { timeout: 10000 }).toMatch(/agzos-42-ok/);

      // Backspace corrige a linha antes do Enter
      await page.keyboard.type('echo agzos-bsX');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('-done');
      await page.keyboard.press('Enter');
      await expect.poll(() => bufferText(page), { timeout: 10000 }).toMatch(/^agzos-bs-done\s*$/m);

      // Reiniciar não duplica a saída (listeners únicos)
      await page.click('#btn-term-more');
      await page.click('#term-more-menu [data-term-action="restart"]');
      await page.waitForTimeout(500);
      await page.locator('#terminal-host .xterm').click();
      await page.keyboard.type('echo dup-$((1+1))-check');
      await page.keyboard.press('Enter');
      await expect.poll(() => bufferText(page), { timeout: 10000 }).toMatch(/dup-2-check/);
      await page.waitForTimeout(300);
      const text = await bufferText(page);
      expect(text.match(/^dup-2-check\s*$/gm) || []).toHaveLength(1);

      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });
}

test('terminal: Ctrl+C copia seleção, Ctrl+V cola, Ctrl+C sem seleção interrompe', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    await page.click('#btn-toggle-terminal');
    await page.waitForFunction(() => !!window.AgzosState?.term?.id, null, { timeout: 10000 });
    await page.locator('#terminal-host .xterm').click();
    await page.keyboard.type('echo clip-$((1+1))-src');
    await page.keyboard.press('Enter');
    await expect.poll(() => bufferText(page), { timeout: 10000 }).toMatch(/^clip-2-src\s*$/m);

    // seleciona tudo e copia com Ctrl+C
    await page.evaluate(() => window.AgzosState.term.term.selectAll());
    await page.keyboard.press('Control+c');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toMatch(/clip-2-src/);
    expect(await page.evaluate(() => window.AgzosState.term.term.hasSelection())).toBe(false);

    // cola com Ctrl+V
    await app.evaluate(({ clipboard }) => clipboard.writeText('echo colado-$((2+3))-ok'));
    await page.keyboard.press('Control+v');
    await page.keyboard.press('Enter');
    await expect.poll(() => bufferText(page), { timeout: 10000 }).toMatch(/^colado-5-ok\s*$/m);

    // Ctrl+C sem seleção vai para o shell (interrompe sleep)
    await page.keyboard.type('sleep 30; echo nao-deveria');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+c');
    await page.keyboard.type('echo depois-$((3+4))');
    await page.keyboard.press('Enter');
    await expect.poll(() => bufferText(page), { timeout: 10000 }).toMatch(/^depois-7\s*$/m);
    expect(await bufferText(page)).not.toMatch(/^nao-deveria/m);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
