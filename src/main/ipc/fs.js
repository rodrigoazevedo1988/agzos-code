/**
 * IPC: sistema de arquivos (fs:*). Operações restritas às raízes liberadas no guard
 * da janela que pediu (event.sender).
 * exists/stat/homeDir não passam pelo guard (só checam metadados) — exceto em
 * caminho remoto, que exige o guard (cada chamada usa a conexão SSH da janela).
 *
 * Pasta remota (1.2.0): `ssh://…` vai ao provider SSH (workspace/provider-for.js);
 * o resto ao disco local, como antes.
 */

const { DEFAULT_FILES_EXCLUDE, normalizeFilesExclude, isExcludedName } = require('../lib/files-exclude');
const path = require('path');
const fsp = require('fs').promises;
const os = require('os');
const { guardResolver } = require('../lib/window-guards');
const { providerFor, isRemote } = require('../workspace/provider-for');
const remoteSearch = require('../remote/search');

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

/**
 * Tipo real da entrada. Links simbólicos, junctions do Windows e placeholders de
 * nuvem (OneDrive/Google Drive) não vêm como diretório no Dirent: segue com stat
 * para a pasta poder expandir. Link quebrado vira arquivo (abrir mostra o erro).
 */
async function describeEntry(dirPath, e) {
  const full = path.join(dirPath, e.name);
  let isDirectory = e.isDirectory();
  let isFile = e.isFile();
  const isLink = e.isSymbolicLink();
  if (isLink || (!isDirectory && !isFile)) {
    try {
      const st = await fsp.stat(full);
      isDirectory = st.isDirectory();
      isFile = st.isFile();
    } catch { /* link quebrado ou sem acesso: mantém o que o Dirent disse */ }
  }
  return { name: e.name, path: full, isDirectory, isFile, ...(isLink ? { isLink: true } : {}) };
}

async function looksBinaryRemote(prov, p) {
  const stream = await prov.createReadStream(p, { start: 0, end: 8191 });
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks).subarray(0, 8192).includes(0);
}

const LOCAL_ONLY = 'Indisponível em pasta remota.';

// Pastas pesadas fora do Quick Open (o Explorer continua mostrando).
const QUICK_OPEN_IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '.idea']);

/**
 * onDirRead(sender, dir): chamado após ler uma pasta local — o observador da janela passa a
 * vigiá-la (Linux observa só pastas já lidas; ver lib/workspace-watcher.js). Nunca quebra a leitura.
 * getFilesExclude(): nomes ocultos no Explorer/Quick Open (settings.files.exclude).
 */
function register(ipcMain, { guard, guardFor, shell, onDirRead, getFilesExclude = () => DEFAULT_FILES_EXCLUDE }) {
  const excluded = (name) => isExcludedName(name, normalizeFilesExclude(getFilesExclude()));
  // Guard da janela que pediu (várias janelas: lib/window-guards.js).
  const guardOf = guardResolver({ guard, guardFor });
  ipcMain.handle('fs:readDir', async (evt, dirPath) => {
    if (!dirPath) throw new Error('dirPath required');
    const real = guardOf(evt?.sender).assertAllowed(dirPath);
    if (isRemote(dirPath)) {
      const list = await providerFor(real, evt?.sender).readDir(real);
      return list.filter((e) => !excluded(e.name));
    }
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    try { onDirRead?.(evt?.sender, dirPath); } catch { /* observador é opcional */ }
    return Promise.all(entries
      .filter((e) => !excluded(e.name))
      .map((e) => describeEntry(dirPath, e)));
  });

  // opts.detectBinary: devolve { binary: true, size } em vez de despejar bytes como texto.
  ipcMain.handle('fs:readFile', async (evt, filePath, opts) => {
    if (!filePath) throw new Error('filePath required');
    const realPath = guardOf(evt?.sender).assertAllowed(filePath);
    const detect = !!(opts && opts.detectBinary);
    if (isRemote(filePath)) {
      const prov = providerFor(realPath, evt?.sender);
      const st = await prov.stat(realPath);
      if (detect && st.isFile && await looksBinaryRemote(prov, realPath)) {
        return { binary: true, size: st.size, mtime: st.mtime };
      }
      if (st.size > 5 * 1024 * 1024) throw new Error('Arquivo muito grande (>5MB). Abra pelo terminal.');
      const content = await prov.readFile(realPath, 'utf-8');
      const result = { content, size: st.size, mtime: st.mtime };
      if (detect) result.binary = false;
      return result;
    }
    const stat = await fsp.stat(filePath);
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
  ipcMain.handle('fs:readBinary', async (evt, p) => {
    if (typeof p !== 'string' || !p) throw new Error('path required');
    const real = guardOf(evt?.sender).assertAllowed(p);
    const prov = providerFor(real, evt?.sender);
    const stat = await prov.stat(real);
    if (stat.size > MAX_BINARY_BYTES) {
      throw new Error(`Arquivo muito grande para pré-visualizar (>${MAX_BINARY_BYTES / 1024 / 1024}MB).`);
    }
    const buf = await prov.readBinary(real);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  // Visualizadores: abrir no app padrão do SO / revelar na pasta (só dentro do guard).
  ipcMain.handle('fs:openPath', async (evt, p) => {
    if (typeof p !== 'string' || !p) throw new Error('path required');
    const real = guardOf(evt?.sender).assertAllowed(p);
    if (isRemote(real)) throw new Error(LOCAL_ONLY);
    const err = await shell.openPath(real);
    if (err) throw new Error(err);
    return true;
  });

  ipcMain.handle('fs:reveal', async (evt, p) => {
    if (typeof p !== 'string' || !p) throw new Error('path required');
    const real = guardOf(evt?.sender).assertAllowed(p);
    if (isRemote(real)) throw new Error(LOCAL_ONLY);
    shell.showItemInFolder(real);
    return true;
  });

  // Arquivo solto do SO na janela. O preload obtém o caminho com
  // webUtils.getPathForFile(File), então o renderer não consegue forjar um caminho
  // arbitrário por aqui (só via File real de um drop). Só arquivos, nunca pastas.
  ipcMain.handle('fs:allowDropped', async (evt, p) => {
    if (typeof p !== 'string' || !p || !path.isAbsolute(p)) return null;
    let st;
    try { st = await fsp.stat(p); } catch { return null; }
    if (!st.isFile()) return null;
    guardOf(evt?.sender).allow(p);
    return { path: p, isFile: true };
  });

  ipcMain.handle('fs:writeFile', async (evt, filePath, content) => {
    if (!filePath) throw new Error('filePath required');
    const real = guardOf(evt?.sender).assertAllowed(filePath);
    if (isRemote(real)) { await providerFor(real, evt?.sender).writeFile(real, String(content ?? '')); return true; }
    await fsp.writeFile(filePath, content, 'utf-8');
    return true;
  });

  ipcMain.handle('fs:mkdir', async (evt, dirPath) => {
    const real = guardOf(evt?.sender).assertAllowed(dirPath);
    if (isRemote(real)) { await providerFor(real, evt?.sender).mkdir(real); return true; }
    await fsp.mkdir(dirPath, { recursive: true });
    return true;
  });

  ipcMain.handle('fs:exists', async (evt, p) => {
    if (isRemote(p)) {
      const g = guardOf(evt?.sender);
      if (!g.isAllowed(p)) return false;
      try { return await providerFor(g.assertAllowed(p), evt?.sender).exists(g.assertAllowed(p)); } catch { return false; }
    }
    try { await fsp.access(p); return true; } catch { return false; }
  });

  ipcMain.handle('fs:stat', async (evt, p) => {
    if (isRemote(p)) {
      const g = guardOf(evt?.sender);
      if (!g.isAllowed(p)) return null;
      try {
        const real = g.assertAllowed(p);
        const s = await providerFor(real, evt?.sender).stat(real);
        return { isDirectory: s.isDirectory, isFile: s.isFile, size: s.size, mtime: s.mtime };
      } catch { return null; }
    }
    try {
      const s = await fsp.stat(p);
      return { isDirectory: s.isDirectory(), isFile: s.isFile(), size: s.size, mtime: s.mtimeMs };
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:delete', async (evt, p) => {
    const real = guardOf(evt?.sender).assertAllowed(p);
    if (isRemote(real)) {
      // Nunca a raiz liberada inteira por engano: o guard já limita ao workspace.
      await providerFor(real, evt?.sender).remove(real);
      return true;
    }
    await fsp.rm(p, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle('fs:rename', async (evt, oldP, newP) => {
    const a = guardOf(evt?.sender).assertAllowed(oldP);
    const b = guardOf(evt?.sender).assertAllowed(newP);
    if (isRemote(a) || isRemote(b)) {
      if (!isRemote(a) || !isRemote(b) || providerFor(a, evt?.sender) !== providerFor(b, evt?.sender)) {
        throw new Error('Mover entre o disco local e o host remoto não é suportado.');
      }
      await providerFor(a, evt?.sender).rename(a, b);
      return true;
    }
    await fsp.rename(oldP, newP);
    return true;
  });

  ipcMain.handle('fs:findFiles', async (evt, dirPath, maxResultsArg = 1000) => {
    if (!dirPath) return [];
    // Varre o caminho real validado pelo guard (não o dirPath cru do renderer).
    const rootDir = guardOf(evt?.sender).assertAllowed(dirPath);
    if (isRemote(rootDir)) return findFilesRemote(rootDir, maxResultsArg, evt?.sender);
    const maxResults = Math.min(Math.max(Number(maxResultsArg) || 1000, 1), 5000);

    const results = [];
    const ignoredDirs = QUICK_OPEN_IGNORED_DIRS;

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
        if (excluded(entry.name)) continue;

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

  // Quick Open remoto: `rg --files` no host (ou `find`), limite 20 mil.
  async function findFilesRemote(rootUri, maxResultsArg, sender) {
    const prov = providerFor(rootUri, sender);
    const maxResults = Math.min(Math.max(Number(maxResultsArg) || 1000, 1), remoteSearch.LIST_LIMIT);
    const res = await prov.execRaw(remoteSearch.buildListScript(prov.pathOf(rootUri), remoteSearch.LIST_LIMIT), { timeoutMs: 60_000 });
    const out = [];
    for (const rel of remoteSearch.parseFileList(res.stdout)) {
      if (out.length >= maxResults) break;
      const segs = rel.split('/');
      if (segs.some((seg) => excluded(seg) || QUICK_OPEN_IGNORED_DIRS.has(seg))) continue;
      out.push({ name: segs[segs.length - 1], path: prov.join(rootUri, rel), relativePath: rel });
    }
    return out;
  }

  // Busca em arquivos no host remoto (`rg --json` ou `grep -rIn`). Local: o renderer
  // continua varrendo pelo fs:readFile → { unsupported: true }.
  ipcMain.handle('fs:searchText', async (evt, rootPath, query, opts = {}) => {
    if (typeof rootPath !== 'string' || !rootPath) throw new Error('rootPath required');
    if (typeof query !== 'string' || query.length < 2 || query.length > 500) return { hits: [] };
    const root = guardOf(evt?.sender).assertAllowed(rootPath);
    if (!isRemote(root)) return { unsupported: true, hits: [] };
    const prov = providerFor(root, evt?.sender);
    const max = Math.min(Math.max(Number(opts?.max) || remoteSearch.SEARCH_LIMIT, 1), 1000);
    const res = await prov.execRaw(remoteSearch.buildSearchScript(prov.pathOf(root), query, max), { timeoutMs: 60_000 });
    const hits = remoteSearch.parseSearchOutput(res.stdout, max).map((h) => ({ file: prov.join(root, h.rel), line: h.line, text: h.text }));
    return { hits };
  });
}

module.exports = { register };
