/**
 * Agzos Code — hook afterPack do electron-builder (macOS).
 *
 * O electron-builder 26 não considera a identidade local "Rodrigo Dev Local"
 * como certificado válido de distribuição e pula a assinatura. Este hook
 * assina o .app empacotado com a identidade local para os testes no Mac.
 *
 * Em CI/máquina sem o certificado, apenas avisa. Developer ID + notarização
 * continuam sendo Fase 5.
 */

const path = require('path');
const { signApp } = require('./sign-mac-app');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const product = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${product}.app`);
  signApp(appPath);
};
