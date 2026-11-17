const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const load = (m) => import(`../../src/renderer/scripts/viewers/${m}.js`);

test('documentEngine: só .docx/.docm/.dotx são renderizados', async () => {
  const { documentEngine } = await load('detect');
  assert.equal(documentEngine('/a/Relatório.DOCX'), 'docx');
  assert.equal(documentEngine('/a/x.docm'), 'docx');
  assert.equal(documentEngine('/a/x.dotx'), 'docx');
  for (const ext of ['doc', 'odt', 'rtf', 'pptx', 'txt']) assert.equal(documentEngine(`x.${ext}`), null, ext);
});

test('sheetEngine: csv/tsv pelo parser próprio, planilhas pelo SheetJS', async () => {
  const { sheetEngine, detectViewer } = await load('detect');
  assert.equal(sheetEngine('a.csv'), 'csv');
  assert.equal(sheetEngine('a.TSV'), 'csv');
  for (const ext of ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods']) {
    assert.equal(sheetEngine(`a.${ext}`), 'sheetjs', ext);
    assert.equal(detectViewer(`a.${ext}`), 'sheet', ext);
  }
  assert.equal(sheetEngine('a.numbers'), null);
});

test('columnName gera letras de coluna do Excel', async () => {
  const { columnName } = await load('grid');
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(27), 'AB');
  assert.equal(columnName(701), 'ZZ');
  assert.equal(columnName(702), 'AAA');
});

test('visibleWindow calcula a janela de linhas da rolagem virtual', async () => {
  const { visibleWindow } = await load('grid');
  assert.deepEqual(visibleWindow({ scrollTop: 0, viewportHeight: 100, rowHeight: 20, rowCount: 1000, overscan: 2 }),
    { start: 0, end: 7, padTop: 0, padBottom: (1000 - 7) * 20 });
  assert.deepEqual(visibleWindow({ scrollTop: 400, viewportHeight: 100, rowHeight: 20, rowCount: 1000, overscan: 2 }),
    { start: 18, end: 27, padTop: 18 * 20, padBottom: (1000 - 27) * 20 });
  // fim da lista
  const w = visibleWindow({ scrollTop: 19950, viewportHeight: 100, rowHeight: 20, rowCount: 1000, overscan: 2 });
  assert.equal(w.end, 1000);
  assert.equal(w.padBottom, 0);
  assert.deepEqual(visibleWindow({ scrollTop: 0, viewportHeight: 100, rowHeight: 20, rowCount: 0 }),
    { start: 0, end: 0, padTop: 0, padBottom: 0 });
});

function workbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['nome', 'valor'], ['Ana', 10], ['Bia', 2.5]]), 'Vendas');
  const ws2 = XLSX.utils.aoa_to_sheet([['x'], [], ['fim']]);
  XLSX.utils.book_append_sheet(wb, ws2, 'Notas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'Vazia');
  return XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

test('workbookToSheets lista as abas com linhas formatadas', async () => {
  const { workbookToSheets } = await load('sheet-model');
  const sheets = workbookToSheets(workbook(), XLSX);
  assert.deepEqual(sheets.map((s) => s.name), ['Vendas', 'Notas', 'Vazia']);
  assert.deepEqual(sheets[0].rows, [['nome', 'valor'], ['Ana', '10'], ['Bia', '2.5']]);
  assert.equal(sheets[0].rowCount, 3);
  assert.equal(sheets[0].colCount, 2);
  assert.equal(sheets[0].cells, 6);
  assert.deepEqual(sheets[1].rows, [['x'], [], ['fim']]);
  assert.equal(sheets[2].rowCount, 0);
  assert.equal(sheets[2].colCount, 0);
});

test('workbookToSheets corta linhas acima de maxCells e marca truncated', async () => {
  const { workbookToSheets } = await load('sheet-model');
  const aoa = Array.from({ length: 100 }, (_, i) => [i, i * 2, i * 3, i * 4]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Grande');
  const [s] = workbookToSheets(wb, XLSX, { maxCells: 40 });
  assert.equal(s.truncated, true);
  assert.equal(s.rows.length, 10);
  assert.equal(s.rowCount, 100);
  assert.equal(s.cells, 400);
});

test('LARGE_SHEET_CELLS marca o aviso de planilha grande em ~50 mil células', async () => {
  const { LARGE_SHEET_CELLS, isLargeSheet } = await load('sheet-model');
  assert.equal(LARGE_SHEET_CELLS, 50000);
  assert.equal(isLargeSheet({ cells: 50001 }), true);
  assert.equal(isLargeSheet({ cells: 50000 }), false);
});
