/**
 * Agzos Snap — renderiza a página numa janela oculta e captura em PNG (2x).
 *
 * Janela sem preload, sandbox, sem Node, sem navegação; a página (modules/snap/page.js) tem CSP
 * sem scripts. A medida do `#snap` é lida por executeJavaScript (não roda script da página).
 * Escala: zoom = 2 / fator da tela, para a imagem sair com 2 pixels por pixel CSS.
 */

const MAX_CSS = 4000;

function createCapture({ BrowserWindow, screen }) {
  return async function capture(html) {
    const scale = screen?.getPrimaryDisplay?.()?.scaleFactor || 1;
    const zoom = 2 / scale;
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      frame: false,
      transparent: true,
      paintWhenInitiallyHidden: true,
      webPreferences: {
        sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false,
        javascript: true, images: false, webgl: false, zoomFactor: zoom,
      },
    });
    try {
      const wc = win.webContents;
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      wc.on('will-navigate', (e) => e.preventDefault());
      await win.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`);
      wc.setZoomFactor(zoom);
      const rect = await wc.executeJavaScript(
        '(() => { const r = document.getElementById("snap").getBoundingClientRect();'
        + ' return { w: Math.ceil(r.width), h: Math.ceil(r.height) }; })()',
        true,
      );
      // Medida em pixels CSS já com zoom aplicado ao layout → converte para pixels de janela (DIP).
      const w = Math.min(MAX_CSS, Math.max(1, Math.round(rect.w)));
      const h = Math.min(MAX_CSS, Math.max(1, Math.round(rect.h)));
      const dipW = Math.ceil(w * zoom);
      const dipH = Math.ceil(h * zoom);
      win.setContentSize(dipW, dipH);
      await new Promise((r) => setTimeout(r, 120));
      return await wc.capturePage({ x: 0, y: 0, width: dipW, height: dipH }, { stayHidden: true });
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  };
}

module.exports = { createCapture };
