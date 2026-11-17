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
const { generateTree, sourceFor } = require('../modules/tree/generate');
const { isRemote } = require('../workspace/provider-for');
const { normalizeModules } = require('../lib/settings');
const { guardResolver } = require('../lib/window-guards');

const CHANNELS = ['generate'];

function register(ipcMain, { guard, guardFor, settingsStore, source = null } = {}) {
  const guardOf = guardResolver({ guard, guardFor });

  ipcMain.handle('tree:generate', async (event, dir, opts = {}) => {
    if (!normalizeModules(settingsStore?.load?.()?.modules).tree.enabled) {
      throw new Error('A Agzos Árvore está desabilitada nas Configurações.');
    }
    const remote = isRemote(dir);
    if (typeof dir !== 'string' || !dir || dir.includes('\0') || (!remote && !path.isAbsolute(dir))) throw new Error('Caminho inválido');
    const abs = guardOf(event?.sender).assertAllowed(dir);
    // Pasta remota: stat e leitura pelo provider SSH da janela.
    const src = source || sourceFor(abs, event?.sender);
    if (remote) {
      const { providerFor } = require('../workspace/provider-for');
      let rst;
      try { rst = await providerFor(abs, event?.sender).stat(abs); } catch { throw new Error(`Pasta não encontrada: ${dir}`); }
      if (!rst.isDirectory) throw new Error(`${dir} não é uma pasta`);
    } else {
      let st;
      try { st = await fs.promises.stat(abs); } catch { throw new Error(`Pasta não encontrada: ${dir}`); }
      if (!st.isDirectory()) throw new Error(`${dir} não é uma pasta`);
    }
    const o = opts && typeof opts === 'object' ? opts : {};
    return generateTree(abs, {
      depth: o.depth, gitignore: o.gitignore, dirsOnly: o.dirsOnly, hidden: o.hidden,
    }, src);
  });
}

module.exports = { register, CHANNELS };
