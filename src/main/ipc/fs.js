/**
 * IPC: sistema de arquivos (fs:*). Operações restritas às raízes liberadas pelo guard.
 * exists/stat/homeDir não passam pelo guard (só checam metadados).
 */

const path = require('path');
const fsp = require('fs').promises;
const os = require('os');

// Heurística de binário (como git/VS Code): byte NUL nos primeiros 8 KB.
async function looksBinary(filePath) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

const MAX_BINARY_BYTES = 50 * 1024 * 1024;

function register(ipcMain, { guard, shell }) {
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

  // opts.detectBinary: devolve { binary: true, size } em vez de despejar bytes como texto.
  ipcMain.handle('fs:readFile', async (_evt, filePath, opts) => {
    if (!filePath) throw new Error('filePath required');
    guard.assertAllowed(filePath);
    const stat = await fsp.stat(filePath);
    const detect = !!(opts && opts.detectBinary);
    if (detect && stat.isFile() && await looksBinary(filePath)) {
      return { binary: true, size: stat.size, mtime: stat.mtimeMs };
    }
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error('Arquivo muito grande (>5MB). Abra pelo terminal.');
    }
    const content = await fsp.readFile(filePath, 'utf-8');
    const result = { content, size: stat.size, mtime: stat.mtimeMs };
    if (detect) result.binary = false;
    return result;
  });

  // Visualizadores de documentos (docx/xlsx): bytes crus, só dentro do guard.
  ipcMain.handle('fs:readBinary', async (_evt, p) => {
    if (typeof p !== 'string' || !p) throw new Error('path required');
    const real = guard.assertAllowed(p);
    const stat = await fsp.stat(real);
    if (stat.size > MAX_BINARY_BYTES) {
      throw new Error(`Arquivo muito grande para pré-visualizar (>${MAX_BINARY_BYTES / 1024 / 1024}MB).`);
    }
    const buf = await fsp.readFile(real);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  // Visualizadores: abrir no app padrão do SO / revelar na pasta (só dentro do guard).
  ipcMain.handle('fs:openPath', async (_evt, p) => {
    if (typeof p !== 'string' || !p) throw new Error('path required');
    const real = guard.assertAllowed(p);
    const err = await shell.openPath(real);
    if (err) throw new Error(err);
    return true;
  });

  ipcMain.handle('fs:reveal', async (_evt, p) => {
    if (typeof p !== 'string' || !p) throw new Error('path required');
    shell.showItemInFolder(guard.assertAllowed(p));
    return true;
  });

  // Arquivo solto do SO na janela. O preload obtém o caminho com
  // webUtils.getPathForFile(File), então o renderer não consegue forjar um caminho
  // arbitrário por aqui (só via File real de um drop). Só arquivos, nunca pastas.
  ipcMain.handle('fs:allowDropped', async (_evt, p) => {
    if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return null;
    let st;
    try { st = await fsp.stat(p); } catch { return null; }
    if (!st.isFile()) return null;
    guard.allow(p);
    return { path: p, isFile: true };
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

  ipcMain.handle('fs:findFiles', async (_evt, dirPath, maxResultsArg = 1000) => {
    if (!dirPath) return [];
    // Varre o caminho real validado pelo guard (não o dirPath cru do renderer).
    const rootDir = guard.assertAllowed(dirPath);
    const maxResults = Math.min(Math.max(Number(maxResultsArg) || 1000, 1), 5000);

    const results = [];
    const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '.vscode', '.idea']);

    async function scan(currentDir, relativePrefix = '', depth = 0) {
      if (depth > 12 || results.length >= maxResults) return;
      let entries;
      try {
        entries = await fsp.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;
        if (entry.name.startsWith('.') && entry.name !== '.gitignore' && entry.name !== '.env') continue;

        const relPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!ignoredDirs.has(entry.name)) {
            await scan(fullPath, relPath, depth + 1);
          }
        } else if (entry.isFile()) {
          results.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
          });
        }
      }
    }

    await scan(rootDir || dirPath);
    return results;
  });

  ipcMain.handle('fs:homeDir', () => os.homedir());
}

module.exports = { register };
