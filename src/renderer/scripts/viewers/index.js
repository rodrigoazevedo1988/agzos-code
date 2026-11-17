/**
 * Abas de visualização: monta o visualizador certo dentro de #viewer-host
 * (camada sobre o Monaco em #editor-host). O editor chama showViewer/hideViewer.
 *
 * file: { path, viewer, size, mtime } — viewer ∈ image|video|audio|pdf|sheet|
 *       docx|external|binary|md-preview
 * ctx:  { openAsText(path), previewSide(path), getText(path) }
 */

import { el, fallbackScreen } from './common.js';
import { renderImage } from './image.js';
import { renderMedia } from './media.js';
import { renderPdf } from './pdf.js';
import { renderSheet } from './sheet.js';
import { renderMarkdownViewer } from './markdown-view.js';

let current = null;

function host() {
  let h = document.getElementById('viewer-host');
  if (!h) {
    h = el('div', { id: 'viewer-host', class: 'viewer-host' });
    h.hidden = true;
    document.getElementById('editor-host')?.append(h);
  }
  return h;
}

function build(file, ctx) {
  switch (file.viewer) {
    case 'image': return renderImage(file, ctx);
    case 'video':
    case 'audio': return renderMedia(file, ctx, file.viewer);
    case 'pdf': return renderPdf(file, ctx);
    case 'sheet': return renderSheet(file, ctx);
    case 'md-preview': return renderMarkdownViewer(file, ctx);
    case 'docx': return {
      element: fallbackScreen(file, ctx, {
        title: 'Formato sem pré-visualização',
        detail: 'Documentos Word/ODT ainda não são renderizados aqui (em breve). Abra no app padrão.',
        icon: 'file-text',
      }),
    };
    case 'binary': return {
      element: fallbackScreen(file, ctx, {
        kind: 'binary',
        title: 'Arquivo binário',
        detail: 'Este arquivo não parece ser texto. Abrir no editor pode mostrar caracteres ilegíveis — e salvar pode corrompê-lo.',
        icon: 'binary',
        allowText: true,
        textLabel: 'Abrir mesmo assim como texto',
      }),
    };
    default: return { element: fallbackScreen(file, ctx, {}) };
  }
}

export function showViewer(file, ctx) {
  hideViewer();
  const h = host();
  const view = build(file, ctx);
  h.replaceChildren(view.element);
  h.hidden = false;
  h.dataset.viewer = file.viewer;
  current = { path: file.path, dispose: view.dispose };
}

export function hideViewer() {
  try { current?.dispose?.(); } catch { /* ignora */ }
  current = null;
  const h = document.getElementById('viewer-host');
  if (h) {
    h.hidden = true;
    h.replaceChildren();
    delete h.dataset.viewer;
  }
}

export function viewerPath() {
  return current?.path || null;
}
