/**
 * IPC: informações do app e links externos (app:*).
 */

function register(ipcMain, { app, shell, isDev, APP_NAME, guard }) {
  ipcMain.handle('app:info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    isDev,
  }));

  ipcMain.handle('app:openExternal', (_evt, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  });

  // Revela no Finder/Explorer/gerenciador de arquivos, sem abrir o arquivo.
  ipcMain.handle('app:reveal', (_evt, p) => {
    if (typeof p !== 'string' || !p) return false;
    if (guard && !guard.isAllowed(p)) return false;
    shell.showItemInFolder(p);
    return true;
  });
}

module.exports = { register };
