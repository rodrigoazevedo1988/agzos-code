/**
 * Agzos Code — hook afterPack do electron-builder, todas as plataformas.
 *
 * 1) Remove sujeira do macOS (`._*`, `.DS_Store`, `.AppleDouble/`) do pacote.
 *    Isso vale para Windows e Linux também: um build gerado a partir de uma
 *    pasta copiada do Mac levava `._Agzos Code.exe` e `._app.asar` junto.
 * 2) Garante o bit de execução do `spawn-helper` do node-pty. O tarball do npm
 *    entrega esse binário como `-rw-r--r--`, mas o node-pty o passa como
 *    `argv[0]` do `posix_spawn` no macOS — sem o bit, o terminal não abre.
 * 3) No macOS, assina o `.app` com a identidade local (ver after-pack-mac.js).
 *
 * Obs.: `.dll`/`.exe` de node_modules só são descartados quando o ALVO não é
 * Windows (app-builder-lib/appFileCopier.js#getNodeModuleExcludedExts). O build
 * Windows do CI roda em `windows-latest`, então os binários do ConPTY ficam.
 */

const fs = require('fs');
const path = require('path');
const { scrubAppleDouble } = require('./scrub-apple-double');
const afterPackMac = require('./after-pack-mac');

/**
 * Procura diretórios `app.asar.unpacked` a partir da saída do pack.
 *
 * O layout varia por plataforma: no macOS o `appOutDir` é `dist/mac-arm64` e o
 * código fica em `<App>.app/Contents/Resources/app.asar.unpacked`; no Windows
 * e no Linux é `<appOutDir>/resources/app.asar.unpacked`. Em vez de adivinhar,
 * percorremos a árvore com profundidade limitada.
 *
 * @param {string} appOutDir
 * @returns {string[]}
 */
function findUnpackedDirs(appOutDir) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'app.asar.unpacked') {
        found.push(full);
        continue;
      }
      // .app é diretório no macOS; node_modules também precisa ser visitado
      walk(full, depth + 1);
    }
  };
  walk(appOutDir, 0);
  return found;
}

/**
 * Deixa executáveis os `spawn-helper` do node-pty dentro do pacote.
 * Devolve a lista de caminhos ajustados.
 *
 * Cobre dois layouts: `prebuilds/<plat>-<arch>/` (Windows/macOS) e
 * `build/Release/` (Linux, onde o módulo é compilado do fonte).
 *
 * @param {string} appOutDir
 * @returns {string[]}
 */
function fixPtyHelperPermissions(appOutDir) {
  const adjusted = [];

  for (const root of findUnpackedDirs(appOutDir)) {
    const ptyDir = path.join(root, 'node_modules', 'node-pty');
    const searchDirs = [
      path.join(ptyDir, 'prebuilds'),
      path.join(ptyDir, 'build', 'Release'),
    ];

    const helpers = [];
    for (const dir of searchDirs) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // layout que não existe para a plataforma alvo
      }
      if (dir.endsWith('Release')) {
        helpers.push(path.join(dir, 'spawn-helper'));
      } else {
        for (const entry of entries) {
          if (entry.isDirectory()) helpers.push(path.join(dir, entry.name, 'spawn-helper'));
        }
      }
    }

    for (const helper of helpers) {
      let stat;
      try {
        stat = fs.statSync(helper);
      } catch {
        continue; // plataformas Windows não têm spawn-helper
      }
      const mode = stat.mode & 0o777;
      if ((mode & 0o111) !== 0o111) {
        fs.chmodSync(helper, mode | 0o755);
        adjusted.push(helper);
      }
    }
  }

  return adjusted;
}

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

  const adjusted = fixPtyHelperPermissions(context.appOutDir);
  if (adjusted.length > 0) {
    console.log(`[after-pack] ${adjusted.length} spawn-helper do node-pty marcado(s) como executável`);
  }

  if (context.electronPlatformName === 'darwin') {
    sign(context);
  }
}

module.exports = afterPack;
module.exports.afterPack = afterPack;
module.exports.fixPtyHelperPermissions = fixPtyHelperPermissions;
