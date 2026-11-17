/**
 * Fixtures de Office geradas na hora (sem binários no repositório):
 * .docx mínimo com título, parágrafo, tabela, link e imagem embutida (jszip);
 * .xlsx com 2 abas e uma planilha grande (SheetJS).
 */
const fs = require('fs');
const JSZip = require('jszip');
const XLSX = require('xlsx');

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
  + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
  + 'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
  + 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
  + 'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function imageRun(rid, cx, cy) {
  return `<w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="img"/>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="img.png"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>`
    + '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

async function writeDocx(file, png) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'
    + '<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/" TargetMode="External"/>'
    + '</Relationships>');
  zip.file('word/media/image1.png', png);
  const p = (text, bold) => `<w:p><w:r>${bold ? '<w:rPr><w:b/><w:sz w:val="40"/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>`
    + p('Relatório Agzos', true)
    + p('Parágrafo de teste do visualizador DOCX.')
    + `<w:tbl><w:tr>${cell('Item')}${cell('Qtd')}</w:tr><w:tr>${cell('Parafuso')}${cell('12')}</w:tr></w:tbl>`
    + '<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>link externo</w:t></w:r></w:hyperlink></w:p>'
    + `<w:p>${imageRun('rIdImg', 304800, 228600)}</w:p>`
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    + '</w:body></w:document>');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
}

function writeXlsx(file) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Produto', 'Preço'], ['Café', 12.5], ['Pão', 3]]), 'Vendas');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nota'], ['segunda aba']]), 'Notas');
  XLSX.writeFile(wb, file);
}

function writeLargeXlsx(file) {
  const rows = Array.from({ length: 6000 }, (_, i) => Array.from({ length: 10 }, (_, c) => i * 10 + c));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Grande');
  XLSX.writeFile(wb, file);
}

function writeOds(file) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['ods', 'ok']]), 'Plan1');
  XLSX.writeFile(wb, file, { bookType: 'ods' });
}

module.exports = { writeDocx, writeXlsx, writeLargeXlsx, writeOds };
