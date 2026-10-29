/**
 * Agzos Code — hook afterPack do electron-builder, todas as plataformas.
 *
 * 1) Remove sujeira do macOS (`._*`, `.DS_Store`, `.AppleDouble/`) do pacote.
 *    Isso vale para Windows e Linux também: um build gerado a partir de uma
 *    pasta copiada do Mac levava `._Agzos Code.exe` e `._app.asar` junto.
 * 2) No macOS, assina o `.app` com a identidade local (ver after-pack-mac.js).
 */

const { scrubAppleDouble } = require('./scrub-apple-double');
const afterPackMac = require('./after-pack-mac');

/**
 * @param {object} context contexto do electron-builder
 * @param {object} [deps] injeção para testes (`sign`)
 */
async function afterPack(context, deps = {}) {
  const sign = deps.sign || afterPackMac.signMacApp;

  const removed = scrubAppleDouble(context.appOutDir);
  if (removed.length > 0) {
    console.log(`[after-pack] ${removed.length} arquivo(s) do macOS removido(s) do pacote`);
  }

  if (context.electronPlatformName === 'darwin') {
    sign(context);
  }
}

module.exports = afterPack;
module.exports.afterPack = afterPack;
