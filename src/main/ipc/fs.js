/**
 * IPC: sistema de arquivos (fs:*). Operações restritas às raízes liberadas pelo guard.
 * exists/stat/homeDir não passam pelo guard (só checam metadados).
 *
 * readFile devolve encoding/EOL/binário; writeFile grava na mesma codificação
 * quando o renderer informa. A escrita é atômica (tmp + rename).
 */

const path = require('path');
const fsp = require('fs').promises;
const os = require('os');
const { decodeBuffer, encodeBuffer, normalizeEol } = require('../lib/file-encoding');

const MAX_FILE_SIZE = 5 * 1024 * 1024;

async function writeFileAtomic(target, data) {
  const tmp = `${target}.agzos-tmp-${process.pid}-${Date.now()}`;
  let mode;
  try {
    mode = (await fsp.stat(target)).mode;
  } catch {
    mode = null;
  }
  try {
    await fsp.writeFile(tmp, data);
    if (mode) await fsp.chmod(tmp, mode);
    await fsp.rename(tmp, target);
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

function register(ipcMain, { guard }) {
  ipcMain.handle('fs:readDir', async (_evt, dirPath) => {
    if (!dirPath) throw new Error('dirPath required');
    guard.assertAllowed(dirPath);
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      path: path.join(dirPath, e.name),
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
      hidden: e.name.startsWith('.'),
    }));
  });

  ipcMain.handle('fs:readFile', async (_evt, filePath, options = {}) => {
    if (!filePath) throw new Error('filePath required');
    guard.assertAllowed(filePath);
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error('Arquivo muito grande (>5MB). Abra pelo terminal.');
    }
    const buf = await fsp.readFile(filePath);
    const meta = decodeBuffer(buf, { encoding: options?.encoding });
    return {
      content: meta.text,
      size: stat.size,
      mtime: stat.mtimeMs,
      encoding: meta.encoding,
      eol: meta.eol,
      binary: meta.binary,
      readOnly: meta.readOnly,
      bom: meta.bom,
    };
  });

  ipcMain.handle('fs:writeFile', async (_evt, filePath, content, options = {}) => {
    if (!filePath) throw new Error('filePath required');
    guard.assertAllowed(filePath);
    const encoding = options?.encoding || 'utf8';
    const eol = options?.eol || null;
    const bom = !!options?.bom;
    const text = eol ? normalizeEol(content, eol) : String(content);
    const data = encodeBuffer(text, { encoding, bom });
    await writeFileAtomic(filePath, data);
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
    if (guard.isRoot(p)) throw new Error('Não é possível excluir a raiz da pasta aberta.');
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
