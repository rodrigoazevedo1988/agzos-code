const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

function register(ipcMain, { app }) {
  const directory = path.join(app.getPath('userData'), 'chats');
  const pending = new Map();
  const filename = (root) => path.join(directory, `${createHash('sha1').update(typeof root === 'string' && root ? root : 'global').digest('hex')}.json`);
  ipcMain.handle('chat:history:load', async (_event, root) => {
    const file = filename(root);
    await (pending.get(file) || Promise.resolve());
    try {
      const messages = JSON.parse(await fs.readFile(file, 'utf8'));
      return Array.isArray(messages) ? messages.slice(-200) : [];
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  });
  ipcMain.handle('chat:history:save', async (_event, root, messages) => {
    if (!Array.isArray(messages)) throw new TypeError('Histórico inválido');
    const file = filename(root);
    const data = JSON.stringify(messages.slice(-200).filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'));
    const operation = (pending.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, data, 'utf8');
      await fs.rename(temporary, file);
    });
    pending.set(file, operation);
    try { await operation; } finally { if (pending.get(file) === operation) pending.delete(file); }
  });
}
module.exports = { register };
