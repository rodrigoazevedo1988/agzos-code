/**
 * IPC: sistema de arquivos (fs:*). Operações restritas às raízes liberadas pelo guard.
 * exists/stat/homeDir não passam pelo guard (só checam metadados).
 */

const path = require('path');
const fsp = require('fs').promises;
const os = require('os');

function register(ipcMain, { guard }) {
  ipcMain.handle('fs:readDir', async (_evt, dirPath) => {
    if (!dirPath) throw new Error('dirPath required');
    guard.assertAllowed(dirPath);
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => !e.name.startsWith('.') || e.name === '.gitignore')
      .map((e) => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }));
  });

  ipcMain.handle('fs:readFile', async (_evt, filePath) => {
    if (!filePath) throw new Error('filePath required');
    guard.assertAllowed(filePath);
    const stat = await fsp.stat(filePath);
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error('Arquivo muito grande (>5MB). Abra pelo terminal.');
    }
    const content = await fsp.readFile(filePath, 'utf-8');
    return { content, size: stat.size, mtime: stat.mtimeMs };
  });

  ipcMain.handle('fs:writeFile', async (_evt, filePath, content) => {
    if (!filePath) throw new Error('filePath required');
    guard.assertAllowed(filePath);
    await fsp.writeFile(filePath, content, 'utf-8');
    return true;
  });

  ipcMain.handle('fs:mkdir', async (_evt, dirPath) => {
    guard.assertAllowed(dirPath);
    await fsp.mkdir(dirPath, { recursive: true });
    return true;
  });

  ipcMain.handle('fs:exists', async (_evt, p) => {
    try { await fsp.access(p); return true; } catch { return false; }
  });

  ipcMain.handle('fs:stat', async (_evt, p) => {
    try {
      const s = await fsp.stat(p);
      return { isDirectory: s.isDirectory(), isFile: s.isFile(), size: s.size, mtime: s.mtimeMs };
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:delete', async (_evt, p) => {
    guard.assertAllowed(p);
    await fsp.rm(p, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle('fs:rename', async (_evt, oldP, newP) => {
    guard.assertAllowed(oldP);
    guard.assertAllowed(newP);
    await fsp.rename(oldP, newP);
    return true;
  });

  ipcMain.handle('fs:homeDir', () => os.homedir());
}

module.exports = { register };
