/**
 * IPC: diálogos nativos (dialog:*). Caminho escolhido pelo usuário é liberado no guard.
 */

function register(ipcMain, { dialog, getMainWindow, guard }) {
  ipcMain.handle('dialog:openFolder', async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Abrir Pasta',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    guard.allow(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:openFile', async () => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title: 'Abrir Arquivo',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    guard.allow(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async (_evt, defaultPath) => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, {
      title: 'Salvar Como',
      defaultPath,
    });
    if (result.canceled || !result.filePath) return null;
    guard.allow(result.filePath);
    return result.filePath;
  });
}

module.exports = { register };
