/**
 * Planilhas: CSV/TSV (parser próprio) e xlsx/xlsm/xlsb/xls/ods (SheetJS, sob
 * demanda). Mesma grade com rolagem virtual e cabeçalho fixo; abas por planilha.
 * Acima de LARGE_SHEET_CELLS mostra aviso; acima de MAX_RENDER_CELLS corta linhas.
 */

import { el, actionButton, toolbar, spacer, fallbackScreen, externalButtons } from './common.js';
import { formatBytes } from './format.js';
import { sheetEngine } from './detect.js';
import { parseCsv } from './csv.js';
import { createGrid, columnName } from './grid.js';
import { workbookToSheets, isLargeSheet } from './sheet-model.js';
import { loadSheetJS } from './lazy-script.js';

const fmt = (n) => Number(n).toLocaleString('pt-BR');

async function loadCsv(file) {
  const { content } = await window.agzos.fs.readFile(file.path);
  const tsv = file.path.toLowerCase().endsWith('.tsv');
  const { rows } = parseCsv(content, { delimiter: tsv ? '\t' : undefined });
  const [header = [], ...data] = rows;
  const colCount = Math.max(header.length, ...data.map((r) => r.length), 0);
  return [{ name: null, header, rows: data, colCount, rowCount: data.length, cells: data.length * colCount, truncated: false, csv: true }];
}

async function loadWorkbook(file) {
  const [XLSX, bytes] = await Promise.all([loadSheetJS(), window.agzos.fs.readBinary(file.path)]);
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true, dense: false });
  return workbookToSheets(wb, XLSX).map((s) => ({
    ...s,
    header: Array.from({ length: s.colCount }, (_, i) => columnName(i)),
  }));
}

export function renderSheet(file, ctx) {
  const engine = sheetEngine(file.path);
  if (!engine) {
    return {
      element: fallbackScreen(file, ctx, {
        title: 'Formato sem pré-visualização',
        detail: 'Este formato de planilha ainda não é renderizado aqui. Abra no app padrão.',
        icon: 'file-spreadsheet',
      }),
    };
  }
  const root = el('div', { class: 'viewer viewer-sheet' });
  const body = el('div', { class: 'viewer-stage viewer-sheet-stage' }, el('div', { class: 'viewer-loading', text: 'Carregando…' }));
  const meta = el('span', { class: 'viewer-meta', text: formatBytes(file.size) });
  const tabsBar = el('div', { class: 'sheet-tabs', role: 'tablist', 'aria-label': 'Planilhas' });
  tabsBar.hidden = true;
  root.append(toolbar(meta, spacer(),
    engine === 'csv' ? actionButton('open-text', 'Abrir como texto', 'code', () => ctx.openAsText(file.path)) : null,
    ...externalButtons(file.path)), body, tabsBar);

  let cancelled = false;
  let grid = null;
  let sheets = [];

  function show(index) {
    grid?.dispose();
    const s = sheets[index];
    for (const [i, t] of [...tabsBar.children].entries()) t.setAttribute('aria-selected', String(i === index));
    const parts = [`${fmt(s.rowCount)} linhas`, `${fmt(s.colCount)} colunas`, formatBytes(file.size)];
    meta.textContent = parts.join(' · ');
    const children = [];
    if (isLargeSheet(s) || s.truncated) {
      const msg = s.truncated
        ? `Planilha muito grande (${fmt(s.cells)} células): mostrando as primeiras ${fmt(s.rows.length)} linhas.`
        : `Planilha grande: ${fmt(s.cells)} células. A rolagem pode ficar mais lenta.`;
      children.push(el('div', { class: 'viewer-warning', role: 'status' }, el('span', { text: msg })));
    }
    if (!s.colCount) {
      children.push(el('div', { class: 'viewer-loading', text: 'Planilha vazia.' }));
      grid = null;
    } else {
      grid = createGrid({ header: s.header, rows: s.rows, colCount: s.colCount, rowLabel: s.csv ? undefined : (i) => String(i + 1) });
      children.push(grid.element);
    }
    body.replaceChildren(...children);
  }

  (async () => {
    try {
      sheets = engine === 'csv' ? await loadCsv(file) : await loadWorkbook(file);
    } catch (e) {
      if (!cancelled && root.isConnected) {
        root.replaceWith(fallbackScreen(file, ctx, { title: 'Não foi possível ler a planilha', detail: e.message, icon: 'file-spreadsheet' }));
      }
      return;
    }
    if (cancelled) return;
    if (!sheets.length) { body.replaceChildren(el('div', { class: 'viewer-loading', text: 'Planilha vazia.' })); return; }
    if (engine !== 'csv') {
      tabsBar.hidden = false;
      tabsBar.replaceChildren(...sheets.map((s, i) => el('button', {
        type: 'button', class: 'sheet-tab', role: 'tab', 'aria-selected': 'false', 'data-sheet': String(i),
        text: s.name, onclick: () => show(i),
      })));
    }
    show(0);
  })();

  return { element: root, dispose: () => { cancelled = true; grid?.dispose(); } };
}
