/**
 * IPC: logs e diagnóstico (logs:*).
 */

const path = require('path');

function register(ipcMain, { shell, logger }) {
  ipcMain.handle('logs:open', async () => {
    const dir = path.dirname(logger.filePath);
    const err = await shell.openPath(dir);
    return { ok: !err, path: dir, error: err || null };
  });

  ipcMain.on('log:write', (_evt, level, message) => {
    if (!['info', 'warn', 'error'].includes(level)) return;
    logger[level](`[renderer] ${String(message).slice(0, 2000)}`);
  });
}

module.exports = { register };
