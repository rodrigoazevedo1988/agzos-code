/**
 * IPC: janelas (window:*) e app:quit. Cada ação vale para a janela que pediu
 * (evt.sender), nunca para uma "janela principal" global.
 * app:quit pergunta antes (confirmQuit(janela) → boolean, lib/quit-confirm.js);
 * window:close não pergunta.
 */

function register(ipcMain, { createWindow, fromWebContents, quit, confirmQuit }) {
  const winOf = (evt) => (evt?.sender ? fromWebContents(evt.sender) : null);

  ipcMain.handle('window:new', () => {
    createWindow();
    return true;
  });

  ipcMain.handle('window:close', (evt) => {
    winOf(evt)?.close();
    return true;
  });

  ipcMain.handle('window:toggleFullScreen', (evt) => {
    const win = winOf(evt);
    if (!win) return false;
    const next = !win.isFullScreen();
    win.setFullScreen(next);
    return next;
  });

  ipcMain.handle('window:toggleDevTools', (evt) => {
    winOf(evt)?.webContents.toggleDevTools();
    return true;
  });

  ipcMain.handle('app:quit', async (evt) => {
    if (typeof confirmQuit === 'function' && !(await confirmQuit(winOf(evt)))) return false;
    quit();
    return true;
  });
}

module.exports = { register };
