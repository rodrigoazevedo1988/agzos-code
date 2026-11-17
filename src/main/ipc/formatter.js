/**
 * IPC do Agzos Formatador (window.agzos.formatter).
 *
 * formatter:format({ path, text, languageId, tabSize?, insertSpaces? })
 *   → { text, parser, configFile?, warning? }
 * O caminho passa pelo path-guard da janela que pediu (guardFor(sender)). A config do Prettier
 * é lida com readPrettierConfig (só JSON/YAML/package.json; código do projeto nunca executa),
 * subindo da pasta do arquivo até a raiz da janela. A formatação roda no processo utilitário
 * (workerHost, handler 'formatter.format'). Sem caminho (arquivo sem título): só a linguagem.
 * deps: { guard | guardFor, getWindowRoot?, settingsStore, workerHost }
 */

const path = require('path');
const { guardResolver } = require('../lib/window-guards');
const { readPrettierConfig, optionsForFile, CANDIDATES } = require('../modules/formatter/config');
const { isRemote, parseRemoteUri, providerFor, toRemoteUri } = require('../workspace/provider-for');

const MAX_REMOTE_CONFIG = 256 * 1024;

/**
 * Pasta remota: lê do host (provider da janela) os candidatos de config entre a pasta do
 * arquivo e a raiz, e devolve um io em memória (POSIX) para readPrettierConfig.
 * Só texto JSON/YAML é interpretado; nada do projeto executa.
 */
async function remoteConfigIo(prov, dirPath, rootPath) {
  const files = new Map();
  let cur = dirPath;
  for (let i = 0; i < 64; i++) {
    for (const cand of CANDIDATES) {
      const p = path.posix.join(cur, cand.name);
      try {
        const st = await prov.stat(toRemoteUri(prov.authority, p));
        if (!st.isFile) continue;
        const text = st.size > MAX_REMOTE_CONFIG || cand.kind === 'code' || cand.kind === 'unsupported'
          ? '' : await prov.readFile(toRemoteUri(prov.authority, p), 'utf8');
        files.set(p, { size: st.size, text });
      } catch { /* não existe */ }
    }
    if (cur === rootPath || cur === '/') break;
    cur = path.posix.dirname(cur);
  }
  return {
    path: path.posix,
    stat: (p) => {
      const f = files.get(p);
      if (!f) throw Object.assign(new Error('não encontrado'), { code: 'ENOENT' });
      return { isFile: true, size: f.size };
    },
    readFile: (p) => files.get(p).text,
  };
}

const MAX_TEXT = 4 * 1024 * 1024;

function isInside(root, p) {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function register(ipcMain, { guard, guardFor, getWindowRoot, settingsStore, workerHost } = {}) {
  const guardOf = guardResolver({ guard, guardFor });

  ipcMain.handle('formatter:format', async (event, req = {}) => {
    const settings = settingsStore.load();
    if (settings?.modules?.formatter?.enabled === false) {
      throw new Error('O Agzos Formatador está desabilitado nas Configurações.');
    }
    const { text, languageId } = req || {};
    if (typeof text !== 'string' || text.length > MAX_TEXT) throw new Error('Texto inválido para formatar');
    const base = {};
    if (Number.isInteger(req.tabSize) && req.tabSize > 0 && req.tabSize <= 32) base.tabWidth = req.tabSize;
    if (typeof req.insertSpaces === 'boolean') base.useTabs = !req.insertSpaces;

    let filepath = null;
    let project = {};
    let configFile;
    let warning;
    if (typeof req.path === 'string' && req.path) {
      if (req.path.includes('\0')) throw new Error('Caminho inválido');
      filepath = guardOf(event.sender).assertAllowed(req.path);
      const root = typeof getWindowRoot === 'function' ? getWindowRoot(event.sender) : null;
      if (isRemote(filepath)) {
        const prov = providerFor(filepath, event.sender);
        const filePosix = parseRemoteUri(filepath).path;
        const dirPosix = path.posix.dirname(filePosix);
        const rootPosix = root && isRemote(root) && parseRemoteUri(root).authority === prov.authority ? parseRemoteUri(root).path : null;
        const inside = rootPosix && (dirPosix === rootPosix || dirPosix.startsWith(`${rootPosix === '/' ? '' : rootPosix}/`));
        const io = await remoteConfigIo(prov, dirPosix, inside ? rootPosix : dirPosix);
        const found = readPrettierConfig(dirPosix, { ...(inside ? { root: rootPosix } : {}), io });
        if (found.config) {
          project = optionsForFile(found.config, filePosix, path.posix.dirname(found.file), path.posix);
          configFile = toRemoteUri(prov.authority, found.file);
        }
        if (found.warning) warning = found.warning;
        const out = await workerHost.call('formatter.format', {
          text, filepath: filePosix, languageId, options: { ...base, ...project },
        });
        return { text: out.text, parser: out.parser, ...(configFile ? { configFile } : {}), ...(warning ? { warning } : {}) };
      }
      const dir = path.dirname(filepath);
      const found = readPrettierConfig(dir, root && isInside(root, dir) ? { root } : {});
      if (found.config) {
        project = optionsForFile(found.config, filepath, path.dirname(found.file));
        configFile = found.file;
      }
      if (found.warning) warning = found.warning;
    }
    const out = await workerHost.call('formatter.format', {
      text, filepath, languageId, options: { ...base, ...project },
    });
    return { text: out.text, parser: out.parser, ...(configFile ? { configFile } : {}), ...(warning ? { warning } : {}) };
  });
}

module.exports = { register };
