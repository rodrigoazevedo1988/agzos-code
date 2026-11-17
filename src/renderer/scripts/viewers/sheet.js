/**
 * CSV/TSV como tabela (parser próprio). Acima de MAX_ROWS mostra só o começo,
 * com aviso e "Abrir como texto". xlsx/xls/ods ainda caem no fallback.
 */

import { el, actionButton, toolbar, spacer, fallbackScreen, externalButtons } from './common.js';
import { formatBytes } from './format.js';
import { extOf } from './detect.js';
import { parseCsv } from './csv.js';

export const MAX_ROWS = 5000;

export function renderSheet(file, ctx) {
  const ext = extOf(file.path);
  if (ext !== 'csv' && ext !== 'tsv') {
    return {
      element: fallbackScreen(file, ctx, {
        title: 'Formato sem pré-visualização',
        detail: 'Planilhas Excel/ODS ainda não são renderizadas aqui (em breve). Abra no app padrão.',
        icon: 'file-spreadsheet',
      }),
    };
  }
  const root = el('div', { class: 'viewer viewer-sheet' });
  const body = el('div', { class: 'viewer-stage viewer-sheet-stage' }, el('div', { class: 'viewer-loading', text: 'Carregando…' }));
  const meta = el('span', { class: 'viewer-meta', text: formatBytes(file.size) });
  root.append(toolbar(meta, spacer(),
    actionButton('open-text', 'Abrir como texto', 'code', () => ctx.openAsText(file.path)),
    ...externalButtons(file.path)), body);

  let cancelled = false;
  (async () => {
    let text;
    try {
      ({ content: text } = await window.agzos.fs.readFile(file.path));
    } catch (e) {
      if (!cancelled) root.replaceWith(fallbackScreen(file, ctx, { title: 'Não foi possível ler o arquivo', detail: e.message, icon: 'file-spreadsheet' }));
      return;
    }
    if (cancelled) return;
    const { rows, truncated, totalRows } = parseCsv(text, { delimiter: ext === 'tsv' ? '\t' : undefined, maxRows: MAX_ROWS + 1 });
    const [header = [], ...data] = rows;
    const cols = Math.max(header.length, ...data.map((r) => r.length), 0);
    meta.textContent = `${Math.max(0, totalRows - 1)} linhas · ${cols} colunas · ${formatBytes(file.size)}`;

    const thead = el('thead', {}, el('tr', {}, el('th', { class: 'rownum', text: '#' }),
      Array.from({ length: cols }, (_, i) => el('th', { text: header[i] ?? '' }))));
    const tbody = el('tbody');
    const frag = document.createDocumentFragment();
    data.forEach((r, idx) => {
      const tr = document.createElement('tr');
      const n = document.createElement('td');
      n.className = 'rownum';
      n.textContent = String(idx + 1);
      tr.append(n);
      for (let i = 0; i < cols; i++) {
        const td = document.createElement('td');
        td.textContent = r[i] ?? '';
        tr.append(td);
      }
      frag.append(tr);
    });
    tbody.append(frag);
    const children = [];
    if (truncated) {
      children.push(el('div', { class: 'viewer-warning', role: 'status' },
        el('span', { text: `Arquivo grande: mostrando as primeiras ${MAX_ROWS} de ${totalRows - 1} linhas.` }),
        actionButton('open-text-warning', 'Abrir como texto', 'code', () => ctx.openAsText(file.path))));
    }
    children.push(el('table', { class: 'viewer-table' }, thead, tbody));
    body.replaceChildren(...children);
  })();

  return { element: root, dispose: () => { cancelled = true; } };
}
