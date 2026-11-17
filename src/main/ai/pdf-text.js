/**
 * Extração de texto de PDF com pdfjs-dist (build legacy, sem worker separado).
 * Roda no main sob demanda (import dinâmico: o pdfjs só carrega quando há PDF).
 *
 * extractPdfText(bytes, { maxPages = 50, maxChars = 200 KB })
 *   → { text, pages, totalPages, truncated }
 */

const path = require('path');
const { pathToFileURL } = require('url');

const MAX_PAGES = 50;
const MAX_CHARS = 200 * 1024;

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((pdfjs) => {
      // Sem Worker real no Node/Electron main: o pdfjs usa o "fake worker" a partir deste arquivo.
      const worker = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
      return pdfjs;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

async function extractPdfText(bytes, { maxPages = MAX_PAGES, maxChars = MAX_CHARS } = {}) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes);
  const standardFontDataUrl = `${pathToFileURL(path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')).href}/`;
  const task = pdfjs.getDocument({
    data, isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, standardFontDataUrl,
  });
  const doc = await task.promise;
  try {
    const totalPages = doc.numPages;
    const limit = Math.min(totalPages, maxPages);
    let text = '';
    let truncated = totalPages > maxPages;
    let pages = 0;
    for (let n = 1; n <= limit; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const lines = [];
      let line = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) { lines.push(line); line = ''; }
      }
      if (line) lines.push(line);
      page.cleanup();
      pages = n;
      text += `${n > 1 ? '\n\n' : ''}--- Página ${n} ---\n${lines.join('\n').trim()}`;
      if (text.length >= maxChars) { truncated = true; text = text.slice(0, maxChars); break; }
    }
    return { text, pages, totalPages, truncated };
  } finally {
    await doc.destroy().catch(() => {});
  }
}

module.exports = { extractPdfText, MAX_PAGES, MAX_CHARS };
