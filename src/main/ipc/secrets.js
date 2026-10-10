/**
 * IPC: cofre de segredos (secrets:*).
 * Não existe secrets:get: o valor nunca sai do main.
 */

function register(ipcMain, { store }) {
  ipcMain.handle('secrets:set', (_evt, key, value) => {
    if (typeof key !== 'string' || typeof value !== 'string' || !value) {
      throw new Error('Chave ou valor inválido');
    }
    store.set(key, value);
    return true;
  });
  ipcMain.handle('secrets:delete', (_evt, key) => {
    store.delete(String(key));
    return true;
  });
  ipcMain.handle('secrets:has', (_evt, key) => store.has(String(key)));
}

module.exports = { register };
