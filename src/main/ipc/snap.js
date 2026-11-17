/**
 * IPC do Agzos Snap (window.agzos.snap).
 *
 * Canais:
 *   snap:html(payload) → { html }                         página da prévia (sem scripts, texto escapado)
 *   snap:export(payload, 'save'|'copy') → { ok, path?, width, height } | { ok: false, canceled: true }
 *     save: diálogo nativo "Salvar PNG" (o usuário escolhe o caminho); copy: clipboard.writeImage.
 * O payload é estruturado (tokens coloridos), nunca HTML (ver modules/snap/page.js).
 * deps: { settingsStore, getWindowFor, capture, clipboard, dialog }
 *   (`dialog` lido na hora da chamada: os e2e trocam dialog.showSaveDialog.)
 */

const fs = require('node:fs');
const { buildSnapHtml } = require('../modules/snap/page');
const { normalizeModules } = require('../lib/settings');

const CHANNELS = ['html', 'export'];

function register(ipcMain, {
  settingsStore, getWindowFor, capture, clipboard, dialog,
} = {}) {
  function ensureEnabled() {
    if (!normalizeModules(settingsStore?.load?.()?.modules).snap.enabled) {
      throw new Error('O Agzos Snap está desabilitado nas Configurações.');
    }
  }

  ipcMain.handle('snap:html', async (_event, payload) => {
    ensureEnabled();
    return { html: buildSnapHtml(payload) };
  });

  ipcMain.handle('snap:export', async (event, payload, action) => {
    ensureEnabled();
    if (action !== 'save' && action !== 'copy') throw new Error('Ação inválida');
    const html = buildSnapHtml(payload);
    const image = await capture(html);
    if (!image || image.isEmpty?.()) throw new Error('Não foi possível gerar a imagem.');
    const { width, height } = image.getSize();
    if (action === 'copy') {
      clipboard.writeImage(image);
      return { ok: true, width, height };
    }
    const win = getWindowFor?.(event);
    const opts = {
      title: 'Salvar imagem do código',
      defaultPath: 'agzos-snap.png',
      filters: [{ name: 'Imagem PNG', extensions: ['png'] }],
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (!r || r.canceled || !r.filePath) return { ok: false, canceled: true };
    const file = /\.png$/i.test(r.filePath) ? r.filePath : `${r.filePath}.png`;
    await fs.promises.writeFile(file, image.toPNG());
    return { ok: true, path: file, width, height };
  });
}

module.exports = { register, CHANNELS };
