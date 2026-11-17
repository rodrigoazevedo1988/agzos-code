/**
 * IPC da Agzos Árvore (window.agzos.tree).
 *
 * Canal: tree:generate(dir, { depth, gitignore, dirsOnly, hidden }) → { text, count, truncated }
 * A pasta passa pelo path-guard da janela que pediu (guardFor(sender)); limite de 5 mil entradas.
 * Copiar/Inserir/Criar ARVORE.md ficam no renderer (ARVORE.md é gravado por fs:writeFile, também guardado).
 *
 * Ponto de troca para pasta remota: `source` (ver modules/tree/generate.js) — hoje a fonte local.
 * deps: { guard | guardFor, settingsStore, source? }
 */

const fs = require('node:fs');
const path = require('node:path');
const { generateTree, localSource } = require('../modules/tree/generate');
const { normalizeModules } = require('../lib/settings');
const { guardResolver } = require('../lib/window-guards');

const CHANNELS = ['generate'];

function register(ipcMain, { guard, guardFor, settingsStore, source = localSource } = {}) {
  const guardOf = guardResolver({ guard, guardFor });

  ipcMain.handle('tree:generate', async (event, dir, opts = {}) => {
    if (!normalizeModules(settingsStore?.load?.()?.modules).tree.enabled) {
      throw new Error('A Agzos Árvore está desabilitada nas Configurações.');
    }
    if (typeof dir !== 'string' || !dir || dir.includes('\0') || !path.isAbsolute(dir)) throw new Error('Caminho inválido');
    const abs = guardOf(event?.sender).assertAllowed(dir);
    let st;
    try { st = await fs.promises.stat(abs); } catch { throw new Error(`Pasta não encontrada: ${dir}`); }
    if (!st.isDirectory()) throw new Error(`${dir} não é uma pasta`);
    const o = opts && typeof opts === 'object' ? opts : {};
    return generateTree(abs, {
      depth: o.depth, gitignore: o.gitignore, dirsOnly: o.dirsOnly, hidden: o.hidden,
    }, source);
  });
}

module.exports = { register, CHANNELS };
