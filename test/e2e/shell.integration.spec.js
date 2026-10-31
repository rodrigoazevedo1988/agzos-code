const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp } = require('./helpers');

const READY = { welcomeSeen: true, onboardingCompleted: true };

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('segunda instância foca e restaura a janela que já estava aberta', async () => {
  const { app, errors } = await launchApp({ settings: READY });
  try {
    // Sem gerenciador de janelas (CI/Xvfb) minimize()/blur() podem ser no-op,
    // então observamos as chamadas que o handler faz na janela existente.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html'));
      global.__agzosCalls = { restore: 0, show: 0, focus: 0 };
      w.restore = () => { global.__agzosCalls.restore += 1; };
      w.show = () => { global.__agzosCalls.show += 1; };
      w.focus = () => { global.__agzosCalls.focus += 1; };
      w.isMinimized = () => true; // força o ramo de restore()
    });

    // O que o Electron emite no processo primário quando se abre o app de novo.
    // Emitir o evento exercita exatamente o mesmo handler.
    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('second-instance', {}, [], process.cwd(), {});
    });

    await expect.poll(() => app.evaluate(() => global.__agzosCalls)).toEqual({
      restore: 1, show: 1, focus: 1,
    });

    // A segunda instância não deve criar uma janela nova.
    expect(app.windows().length).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('segunda instância não restaura janela que não está minimizada', async () => {
  const { app, errors } = await launchApp({ settings: READY });
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('renderer/index.html'));
      global.__agzosCalls = { restore: 0, show: 0, focus: 0 };
      w.restore = () => { global.__agzosCalls.restore += 1; };
      w.show = () => { global.__agzosCalls.show += 1; };
      w.focus = () => { global.__agzosCalls.focus += 1; };
      w.isMinimized = () => false;
    });

    await app.evaluate(({ app: electronApp }) => {
      electronApp.emit('second-instance', {}, [], process.cwd(), {});
    });

    await expect.poll(() => app.evaluate(() => global.__agzosCalls)).toEqual({
      restore: 0, show: 1, focus: 1,
    });
    expect(app.windows().length).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('app:reveal aceita caminho da workspace e recusa fora dela', async () => {
  const root = tmpDir('agzos-reveal-');
  const dentro = path.join(root, 'arquivo.txt');
  fs.writeFileSync(dentro, 'x');
  const fora = path.join(os.tmpdir(), `agzos-fora-${Date.now()}.txt`);
  fs.writeFileSync(fora, 'x');

  const { app, page, errors } = await launchApp({ settings: READY });
  try {
    await app.evaluate((_electron, dir) => global.__agzosAllowRoot(dir), root);

    // Sem gerenciador de arquivos (CI/Xvfb), `shell.showItemInFolder` pode
    // bloquear e o invoke nunca voltaria. O efeito observado é a chamada.
    await app.evaluate(({ shell }) => {
      global.__revealed = [];
      shell.showItemInFolder = (p) => { global.__revealed.push(p); };
    });

    // Caminho liberado: revelar deve ser aceito.
    expect(await page.evaluate((p) => window.agzos.app.reveal(p), dentro)).toBe(true);
    expect(await app.evaluate(() => global.__revealed)).toEqual([dentro]);

    // Fora da raiz liberada: o guard barra antes de tocar no gerenciador.
    expect(await page.evaluate((p) => window.agzos.app.reveal(p), fora)).toBe(false);

    // Entradas inválidas também são recusadas sem exceção.
    expect(await page.evaluate(() => window.agzos.app.reveal(''))).toBe(false);
    expect(await page.evaluate(() => window.agzos.app.reveal(null))).toBe(false);

    // Só a chamada do caminho permitido chegou ao gerenciador de arquivos.
    expect(await app.evaluate(() => global.__revealed)).toHaveLength(1);

    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fora, { force: true });
  }
});

test('revelar pelo menu de contexto do Explorer chama o IPC', async () => {
  const root = tmpDir('agzos-reveal-ui-');
  const arquivo = path.join(root, 'app.js');
  fs.writeFileSync(arquivo, 'console.log(1);\n');

  const { app, page, errors } = await launchApp({ settings: READY });
  try {
    await app.evaluate((_electron, dir) => global.__agzosAllowRoot(dir), root);
    expect(await page.evaluate((d) => window.agzos.workspace.open(d), root)).toBe(true);

    // O objeto do preload é congelado pelo contextBridge, então observamos o
    // shell do processo principal — que é justamente o efeito real do "Revelar".
    await app.evaluate(({ shell }) => {
      global.__revealed = [];
      shell.showItemInFolder = (p) => { global.__revealed.push(p); };
    });

    const ok = await page.evaluate((p) => window.agzos.app.reveal(p), arquivo);
    expect(ok).toBe(true);
    expect(await app.evaluate(() => global.__revealed)).toContain(arquivo);

    // Fora da raiz liberada o guard barra antes de chegar ao gerenciador.
    expect(await page.evaluate(() => window.agzos.app.reveal('/nao-liberado/x.txt'))).toBe(false);
    expect(await app.evaluate(() => global.__revealed)).toHaveLength(1);

    expect(errors).toEqual([]);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
