/**
 * Visualizador de imagens: <img> via agzos-file:// (SVG também — nunca inline
 * no DOM, então scripts/estilos do SVG não rodam no app). Zoom ajustar/100%/±,
 * Ctrl+roda, fundo xadrez e rodapé com dimensões e tamanho.
 */

import { el, actionButton, toolbar, spacer, fallbackScreen, externalButtons } from './common.js';
import { formatBytes } from './format.js';
import { extOf } from './detect.js';
import { toFileUrl } from './paths.js';

const MIN = 0.05;
const MAX = 32;
const STEP = 1.25;

export function renderImage(file, ctx) {
  const ext = extOf(file.path);
  const img = el('img', { alt: '', draggable: 'false', src: toFileUrl(file.path, file.mtime) });
  const stage = el('div', { class: 'viewer-stage checker' }, img);
  const zoomLabel = el('span', { class: 'viewer-zoom-label', text: '—' });
  const footer = el('div', { class: 'viewer-footer' });
  const root = el('div', { class: 'viewer viewer-image', 'data-zoom': 'fit' });

  let mode = 'fit';
  let scale = 1;

  function fitScale() {
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    const sw = Math.max(1, stage.clientWidth - 32);
    const sh = Math.max(1, stage.clientHeight - 32);
    return Math.min(1, sw / w, sh / h);
  }

  function apply() {
    if (!img.naturalWidth) return;
    const s = mode === 'fit' ? fitScale() : scale;
    img.style.width = `${Math.max(1, Math.round(img.naturalWidth * s))}px`;
    img.style.height = `${Math.max(1, Math.round(img.naturalHeight * s))}px`;
    root.dataset.zoom = mode === 'fit' ? 'fit' : String(Math.round(scale * 1000) / 1000);
    zoomLabel.textContent = `${Math.round(s * 100)}%${mode === 'fit' ? ' (ajustado)' : ''}`;
  }

  function setScale(next) {
    const current = mode === 'fit' ? fitScale() : scale;
    scale = Math.min(MAX, Math.max(MIN, typeof next === 'function' ? next(current) : next));
    mode = 'zoom';
    apply();
  }

  const bar = toolbar(
    actionButton('zoom-fit', 'Ajustar', 'scan', () => { mode = 'fit'; apply(); }, { title: 'Ajustar à janela' }),
    actionButton('zoom-100', '100%', null, () => setScale(1), { title: 'Tamanho real' }),
    actionButton('zoom-out', 'Diminuir', 'zoom-out', () => setScale((s) => s / STEP), { iconOnly: true, title: 'Diminuir zoom' }),
    zoomLabel,
    actionButton('zoom-in', 'Aumentar', 'zoom-in', () => setScale((s) => s * STEP), { iconOnly: true, title: 'Aumentar zoom' }),
    spacer(),
    ext === 'svg' ? actionButton('open-text', 'Abrir como texto', 'code', () => ctx.openAsText(file.path)) : null,
    ...externalButtons(file.path),
  );

  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setScale((s) => (e.deltaY < 0 ? s * 1.1 : s / 1.1));
  }, { passive: false });

  img.addEventListener('load', () => {
    footer.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${formatBytes(file.size)} · ${ext.toUpperCase()}`;
    apply();
  });
  img.addEventListener('error', () => {
    root.replaceWith(fallbackScreen(file, ctx, {
      title: 'Não foi possível exibir a imagem',
      detail: 'O arquivo pode estar corrompido ou em um formato que o Chromium não decodifica.',
      icon: 'file-image',
      allowText: ext === 'svg',
    }));
  });

  const ro = new ResizeObserver(() => { if (mode === 'fit') apply(); });
  ro.observe(stage);

  root.append(bar, stage, footer);
  return { element: root, dispose: () => ro.disconnect() };
}
