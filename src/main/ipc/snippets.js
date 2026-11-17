/**
 * IPC dos Snippets (window.agzos.snippets). Biblioteca em userData/snippets.json.
 *
 * Canais (todos `snippets:*`):
 *   list({ query?, category? }?) → { snippets, categories }
 *   get(id) → snippet | null · save(input) → snippet · remove(id) → { removed }
 *   duplicate(id) → snippet · restoreDefaults() → { restored }
 *   import(text?) → { added, updated, skipped } | { canceled }   (sem texto: diálogo de abrir)
 *   export() → { path } | { canceled }                           (diálogo de salvar; arquivo 0600)
 *   render(id, { jsx? }?) → { text, language }    variáveis trocadas (+ HTML → JSX se jsx)
 *   interpolate(body) → string                     prévia ao vivo do editor de snippet
 *   tailwind() → string                            @tailwindcss/browser vendorizado, para o srcdoc
 *                                                  das miniaturas (`</script` escapado)
 * Nenhum canal recebe caminho do renderer: import/export só leem/gravam o arquivo escolhido
 * no diálogo nativo. Mudanças avisam todas as janelas com `snippets:changed`.
 *
 * deps: { settingsStore, userDataDir, dialog?, getWindowFor?, broadcast?, tailwindPath?, store? }
 */

const fs = require('node:fs');
const path = require('node:path');
const { normalizeModules } = require('../lib/settings');
const { createSnippetStore } = require('../modules/snippets/store');
const { loadSeed } = require('../modules/snippets/seed');
const { interpolate } = require('../modules/snippets/interpolate');
const { renderSnippet } = require('../modules/snippets/render');
const { configureSnippets } = require('../modules/snippets/runtime');

const CHANNELS = [
  'list', 'get', 'save', 'remove', 'duplicate', 'restoreDefaults', 'import', 'export', 'render', 'interpolate', 'tailwind',
];
const MAX_IMPORT = 5 * 1024 * 1024;
const DEFAULT_TAILWIND = path.join(__dirname, '..', '..', 'renderer', 'vendor', 'tailwind', 'tailwind.global.js');
const JSON_FILTERS = [{ name: 'Snippets (JSON)', extensions: ['json'] }];

function defaultBroadcast(channel, payload) {
  try {
    const { webContents } = require('electron');
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) wc.send(channel, payload);
    }
  } catch { /* fora do Electron (testes) */ }
}

function register(ipcMain, {
  settingsStore, userDataDir, dialog, getWindowFor, broadcast = defaultBroadcast, tailwindPath = DEFAULT_TAILWIND, store: injected,
} = {}) {
  const store = injected || createSnippetStore({ file: path.join(userDataDir, 'snippets.json'), seed: loadSeed() });
  const variables = () => normalizeModules(settingsStore?.load?.()?.modules).snippets.variables;
  configureSnippets({ store, variables });
  store.onChange(() => broadcast('snippets:changed', {}));

  let tailwindCache = null;
  const getDialog = () => dialog || require('electron').dialog;
  const parentOf = (sender) => (typeof getWindowFor === 'function' && sender ? getWindowFor(sender) : undefined);
  const withParent = (win, opts) => (win ? [win, opts] : [opts]);

  function handlersFor(sender) {
    return {
      list: (opts = {}) => {
        const all = store.list();
        const categories = [...new Set(all.map((s) => s.category))];
        const o = opts && typeof opts === 'object' ? opts : {};
        return { snippets: store.list({ query: String(o.query || ''), category: String(o.category || '') }), categories };
      },
      get: (id) => store.get(String(id)),
      save: (input) => store.save(input),
      remove: (id) => ({ removed: store.remove(String(id)) }),
      duplicate: (id) => store.duplicate(String(id)),
      restoreDefaults: () => store.restoreDefaults(),
      import: async (text) => {
        if (typeof text === 'string') {
          if (text.length > MAX_IMPORT) throw new Error('Arquivo grande demais (máx. 5 MB)');
          return store.importData(text);
        }
        const res = await getDialog().showOpenDialog(...withParent(parentOf(sender), {
          title: 'Importar snippets', properties: ['openFile'], filters: JSON_FILTERS,
        }));
        if (res.canceled || !res.filePaths?.length) return { canceled: true };
        const file = res.filePaths[0];
        if (fs.statSync(file).size > MAX_IMPORT) throw new Error('Arquivo grande demais (máx. 5 MB)');
        return store.importData(fs.readFileSync(file, 'utf8'));
      },
      export: async () => {
        const res = await getDialog().showSaveDialog(...withParent(parentOf(sender), {
          title: 'Exportar snippets', defaultPath: 'snippets-agzos.json', filters: JSON_FILTERS,
        }));
        if (res.canceled || !res.filePath) return { canceled: true };
        fs.writeFileSync(res.filePath, JSON.stringify(store.exportData(), null, 2), { encoding: 'utf8', mode: 0o600 });
        try { fs.chmodSync(res.filePath, 0o600); } catch {}
        return { path: res.filePath };
      },
      render: (id, opts = {}) => {
        const snippet = store.get(String(id));
        if (!snippet) throw new Error('Snippet não encontrado');
        return { text: renderSnippet(snippet, variables(), { jsx: Boolean(opts?.jsx) }), language: snippet.language };
      },
      interpolate: (body) => interpolate(body, variables()),
      tailwind: () => {
        if (tailwindCache === null) tailwindCache = fs.readFileSync(tailwindPath, 'utf8').replace(/<\/script/gi, '<\\/script');
        return tailwindCache;
      },
    };
  }

  for (const name of CHANNELS) {
    ipcMain.handle(`snippets:${name}`, async (e, ...args) => handlersFor(e?.sender)[name](...args));
  }
  return { store, handlers: handlersFor(null) };
}

module.exports = { register, CHANNELS };
