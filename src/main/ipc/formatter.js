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
const { readPrettierConfig, optionsForFile } = require('../modules/formatter/config');

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
