/**
 * IPC: informações do app e links externos (app:*).
 */

function register(ipcMain, { app, shell, isDev, APP_NAME }) {
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
}

module.exports = { register };
