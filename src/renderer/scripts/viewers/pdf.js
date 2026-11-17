/**
 * PDF no visualizador embutido do Chromium (webPreferences.plugins: true).
 * O iframe aponta para agzos-file://…pdf; CSP libera frame-src agzos-file:.
 */

import { el, toolbar, spacer, externalButtons } from './common.js';
import { formatBytes } from './format.js';
import { toFileUrl } from './paths.js';

export function renderPdf(file) {
  const frame = el('iframe', { title: 'Visualização do PDF', src: toFileUrl(file.path, file.mtime) });
  const root = el('div', { class: 'viewer viewer-pdf', 'data-loaded': 'false' },
    toolbar(el('span', { class: 'viewer-meta', text: formatBytes(file.size) }), spacer(), ...externalButtons(file.path)),
    el('div', { class: 'viewer-stage viewer-pdf-stage' }, frame));
  frame.addEventListener('load', () => { root.dataset.loaded = 'true'; });
  return { element: root };
}
