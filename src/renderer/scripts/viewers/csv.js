/**
 * Parser CSV/TSV simples (RFC 4180): aspas, aspas escapadas (""), delimitador e
 * quebras de linha dentro de aspas, CRLF, BOM. Módulo puro, testável em Node.
 */

const CANDIDATES = [',', ';', '\t', '|'];

/** Delimitador mais frequente na primeira linha (fora de aspas). */
export function detectDelimiter(text) {
  const counts = new Map(CANDIDATES.map((c) => [c, 0]));
  let inQuotes = false;
  for (let i = 0; i < text.length && i < 64 * 1024; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch) + 1);
  }
  let best = ',';
  let max = 0;
  for (const [c, n] of counts) if (n > max) { best = c; max = n; }
  return best;
}

/**
 * @returns {{ rows: string[][], truncated: boolean, totalRows: number, delimiter: string }}
 * Com maxRows, para de guardar linhas mas continua contando (totalRows).
 */
export function parseCsv(input, { delimiter, maxRows = Infinity } = {}) {
  let text = String(input ?? '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = delimiter || detectDelimiter(text);
  const rows = [];
  let total = 0;
  let row = [];
  let field = '';
  let inQuotes = false;
  let rowHasData = false;

  const endRow = () => {
    row.push(field);
    field = '';
    total++;
    if (rows.length < maxRows) rows.push(row);
    row = [];
    rowHasData = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; rowHasData = true; }
    else if (ch === delim) { row.push(field); field = ''; rowHasData = true; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else { field += ch; rowHasData = true; }
  }
  if (rowHasData || field !== '' || row.length) endRow();
  return { rows, truncated: total > rows.length, totalRows: total, delimiter: delim };
}
