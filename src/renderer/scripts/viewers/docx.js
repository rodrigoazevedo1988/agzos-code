/**
 * .docx renderizado com docx-preview (somente leitura). Bytes via fs:readBinary
 * (guard); imagens embutidas como data: (useBase64URL) — sem mudar a CSP.
 * Links do documento nunca navegam a janela: http(s) abre no navegador.
 */

import { el, actionButton, toolbar, spacer, fallbackScreen, externalButtons } from './common.js';
import { formatBytes } from './format.js';
import { loadDocxPreview } from './lazy-script.js';

const STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function renderDocx(file, ctx) {
  const content = el('div', { class: 'docx-host' }, el('div', { class: 'viewer-loading', text: 'Carregando documento…' }));
  const stage = el('div', { class: 'viewer-stage viewer-docx-stage' }, content);
  const zoomLabel = el('span', { class: 'viewer-zoom-label', text: '100%' });
  const root = el('div', { class: 'viewer viewer-docx', 'data-zoom': '1' });
  let zoom = 1;

  function setZoom(z) {
    zoom = Math.min(STEPS[STEPS.length - 1], Math.max(STEPS[0], z));
    content.style.zoom = String(zoom);
    root.dataset.zoom = String(zoom);
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  const step = (dir) => {
    const next = dir > 0 ? STEPS.find((s) => s > zoom + 1e-6) : [...STEPS].reverse().find((s) => s < zoom - 1e-6);
    if (next) setZoom(next);
  };
  function fitWidth() {
    const page = content.querySelector('section.docx');
    if (!page) return;
    const natural = page.offsetWidth + 40;
    setZoom(Math.max(STEPS[0], Math.min(3, (stage.clientWidth - 24) / natural)));
  }

  root.append(
    toolbar(
      actionButton('zoom-fit', 'Ajustar à largura', 'scan', fitWidth),
      actionButton('zoom-100', '100%', null, () => setZoom(1)),
      actionButton('zoom-out', 'Diminuir', 'zoom-out', () => step(-1), { iconOnly: true, title: 'Diminuir zoom' }),
      zoomLabel,
      actionButton('zoom-in', 'Aumentar', 'zoom-in', () => step(1), { iconOnly: true, title: 'Aumentar zoom' }),
      el('span', { class: 'viewer-meta', text: 'Somente leitura', title: formatBytes(file.size) }),
      spacer(),
      ...externalButtons(file.path),
    ),
    stage,
  );

  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    step(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  content.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (/^https?:/i.test(href)) window.agzos.app.openExternal(href);
    else if (href.startsWith('#')) content.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView();
  });

  let cancelled = false;
  (async () => {
    try {
      const [docx, bytes] = await Promise.all([loadDocxPreview(), window.agzos.fs.readBinary(file.path)]);
      if (cancelled) return;
      const body = el('div');
      await docx.renderAsync(bytes, body, null, {
        className: 'docx',
        inWrapper: true,
        ignoreLastRenderedPageBreak: true,
        breakPages: true,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        experimental: false,
      });
      if (cancelled) return;
      content.replaceChildren(...body.childNodes);
      root.dataset.loaded = 'true';
      // Página mais larga que a aba → começa ajustada à largura.
      const page = content.querySelector('section.docx');
      if (page && page.offsetWidth + 48 > stage.clientWidth) fitWidth();
    } catch (e) {
      if (cancelled || !root.isConnected) return;
      root.replaceWith(fallbackScreen(file, ctx, {
        title: 'Não foi possível exibir o documento',
        detail: `${e.message || e}. Abra no app padrão.`,
        icon: 'file-text',
      }));
    }
  })();

  return { element: root, dispose: () => { cancelled = true; } };
}
