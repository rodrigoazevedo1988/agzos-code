/**
 * Planilhas (SheetJS) → modelo simples para a grade. Módulo puro: recebe o
 * workbook e o objeto XLSX por parâmetro (no Node o teste usa require('xlsx')).
 */

/** Acima disso a aba mostra aviso de planilha grande. */
export const LARGE_SHEET_CELLS = 50000;
/** Teto de células materializadas por aba (o resto fica de fora, com aviso). */
export const MAX_RENDER_CELLS = 2000000;

export function isLargeSheet(sheet) {
  return (sheet?.cells || 0) > LARGE_SHEET_CELLS;
}

/**
 * @returns {Array<{ name, rows: string[][], rowCount, colCount, cells, truncated }>}
 * rows/colunas contam a partir de A1 (como no Excel), com valores já formatados.
 */
export function workbookToSheets(wb, XLSX, { maxCells = MAX_RENDER_CELLS } = {}) {
  return (wb.SheetNames || []).map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws && ws['!ref'];
    if (!ref) return { name, rows: [], rowCount: 0, colCount: 0, cells: 0, truncated: false };
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r + 1;
    const colCount = range.e.c + 1;
    const cells = rowCount * colCount;
    const maxRows = Math.max(1, Math.floor(maxCells / Math.max(1, colCount)));
    const truncated = rowCount > maxRows;
    const lastRow = truncated ? maxRows - 1 : range.e.r;
    const rows = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
      range: { s: { r: 0, c: 0 }, e: { r: lastRow, c: range.e.c } },
    }).map((row) => {
      // Linhas vazias viram [] (sem as células de preenchimento do defval).
      let end = row.length;
      while (end > 0 && row[end - 1] === '') end--;
      return row.slice(0, end).map((v) => String(v));
    });
    return { name, rows, rowCount, colCount, cells, truncated };
  });
}
