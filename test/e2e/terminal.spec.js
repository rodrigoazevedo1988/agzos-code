const { test, expect } = require('@playwright/test');
const { launchApp } = require('./helpers');

async function openTerminal(page) {
  await page.locator('#btn-toggle-terminal').click();
  await expect(page.locator('.xterm')).toBeVisible();
  await page.waitForFunction(() => !!window.AgzosState.term?.term, null, { timeout: 10000 });
  await page.evaluate(() => window.AgzosState.term.term.focus());
  return page.evaluate(() => window.AgzosState.term.mode);
}

function bufferText(page) {
  return page.evaluate(() => {
    const t = window.AgzosState.term.term;
    const buffer = t.buffer.active;
    let out = '';
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) out += line.translateToString(true) + '\n';
    }
    return out;
  });
}

test('terminal abre sem conflito AMD e executa um comando', async () => {
  const { app, page, errors } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const mode = await openTerminal(page);
    expect(['pty', 'pipe']).toContain(mode);
    expect(await page.locator('#fatal-overlay').count()).toBe(0);

    await page.keyboard.type('echo agzos-42');
    await page.keyboard.press('Enter');

    await expect.poll(() => bufferText(page)).toContain('agzos-42');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('a sessão informa o modo (pty real ou reduzido)', async () => {
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const mode = await openTerminal(page);
    // Em CI/ambientes sem /dev/ptmx o app deve degradar, nunca quebrar.
    expect(['pty', 'pipe']).toContain(mode);
    if (mode === 'pipe') {
      await expect.poll(() => bufferText(page)).toContain('Modo reduzido');
    } else {
      expect(await bufferText(page)).not.toContain('Modo reduzido');
    }
  } finally {
    await app.close();
  }
});

test('com pty: o que se digita aparece na tela e `cls` limpa', async () => {
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const mode = await openTerminal(page);
    test.skip(mode !== 'pty', 'pty real indisponível neste ambiente');

    // O echo local do pty é justamente o que faltava no modo pipe.
    await page.keyboard.type('echo eco-visivel-7');
    await expect.poll(() => bufferText(page)).toContain('echo eco-visivel-7');
    await page.keyboard.press('Enter');
    await expect.poll(() => bufferText(page)).toContain('eco-visivel-7');

    await page.keyboard.type('cls');
    await page.keyboard.press('Enter');
    // Depois de cls o conteúdo anterior não deve mais estar visível.
    await expect.poll(() => bufferText(page)).not.toContain('echo eco-visivel-7');
  } finally {
    await app.close();
  }
});

test('Enter não gera linha duplicada nem linha em branco extra', async () => {
  const { app, page } = await launchApp({
    settings: { welcomeSeen: true, onboardingCompleted: true },
  });
  try {
    const mode = await openTerminal(page);
    await page.keyboard.type('echo saida-unica-5');
    await page.keyboard.press('Enter');
    await expect.poll(() => bufferText(page)).toContain('saida-unica-5');

    const linhas = (await bufferText(page))
      .split('\n')
      .map((l) => l.trim())
      // No modo degradado o shell pode misturar prompt na mesma linha.
      .filter((l) => l.includes('saida-unica-5'))
      .map((l) => (l.match(/saida-unica-5/g) || []).length)
      .reduce((a, b) => a + b, 0);

    // Com pty: eco do comando + saída = 2. Sem pty: só a saída = 1.
    expect(linhas).toBe(mode === 'pty' ? 2 : 1);
  } finally {
    await app.close();
  }
});
