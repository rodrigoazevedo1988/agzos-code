/**
 * Grade com rolagem virtual (planilhas e CSV): cabeçalho fixo, número da
 * linha fixo à esquerda e só as linhas visíveis no DOM.
 * columnName/visibleWindow são puras (testadas em Node); createGrid usa DOM.
 */

export const ROW_HEIGHT = 24;

/** 0 → A, 25 → Z, 26 → AA … */
export function columnName(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function visibleWindow({ scrollTop, viewportHeight, rowHeight, rowCount, overscan = 8 }) {
  if (!rowCount) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(rowCount, first + Math.ceil(viewportHeight / rowHeight) + overscan);
  return { start, end, padTop: start * rowHeight, padBottom: (rowCount - end) * rowHeight };
}

/**
 * @param {{ header: string[], rows: string[][], colCount: number, rowLabel?: (i:number)=>string }} opts
 * @returns {{ element: HTMLElement, dispose: () => void }}
 */
export function createGrid({ header, rows, colCount, rowLabel = (i) => String(i + 1) }) {
  const scroller = document.createElement('div');
  scroller.className = 'viewer-grid';
  scroller.tabIndex = 0;
  const table = document.createElement('table');
  table.className = 'viewer-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'rownum';
  corner.textContent = '#';
  htr.append(corner);
  for (let c = 0; c < colCount; c++) {
    const th = document.createElement('th');
    th.textContent = header[c] ?? '';
    htr.append(th);
  }
  thead.append(htr);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  scroller.append(table);

  const spacer = (h) => {
    const tr = document.createElement('tr');
    tr.className = 'grid-spacer';
    tr.style.height = `${h}px`;
    return tr;
  };

  let last = '';
  function paint() {
    const w = visibleWindow({
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight || 600,
      rowHeight: ROW_HEIGHT,
      rowCount: rows.length,
    });
    const key = `${w.start}:${w.end}`;
    if (key === last) return;
    last = key;
    const frag = document.createDocumentFragment();
    if (w.padTop) frag.append(spacer(w.padTop));
    for (let i = w.start; i < w.end; i++) {
      const r = rows[i] || [];
      const tr = document.createElement('tr');
      tr.dataset.row = String(i);
      const n = document.createElement('td');
      n.className = 'rownum';
      n.textContent = rowLabel(i);
      tr.append(n);
      for (let c = 0; c < colCount; c++) {
        const td = document.createElement('td');
        td.textContent = r[c] ?? '';
        tr.append(td);
      }
      frag.append(tr);
    }
    if (w.padBottom) frag.append(spacer(w.padBottom));
    tbody.replaceChildren(frag);
  }

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; paint(); });
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const ro = new ResizeObserver(() => { last = ''; paint(); });
  ro.observe(scroller);
  paint();
  return { element: scroller, dispose: () => { ro.disconnect(); cancelAnimationFrame(raf); } };
}
