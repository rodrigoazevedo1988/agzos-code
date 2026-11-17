/**
 * Renderização de Markdown para documentação (pré-visualização na aba e ao lado).
 * marked + DOMPurify (via markdown.js); depois do sanitize: imagens relativas →
 * agzos-file://, ids nos títulos, realce de código pelo Monaco (colorize) e
 * links tratados por clique (externos no navegador, relativos no editor).
 */

import { sanitizeMarkdown } from '../markdown.js';
import { el, actionButton, toolbar, spacer, basename } from './common.js';
import { resolveMarkdownPath, toFileUrl } from './paths.js';

const State = window.AgzosState;

export function slugify(text) {
  return String(text || '').trim().toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

function languageFor(monaco, hint) {
  if (!monaco || !hint) return null;
  const h = hint.toLowerCase();
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.id === h || (lang.aliases || []).some((a) => a.toLowerCase() === h) || (lang.extensions || []).includes(`.${h}`)) return lang.id;
  }
  return null;
}

async function highlight(container) {
  const monaco = window.monaco;
  if (!monaco?.editor?.colorize) return;
  for (const code of container.querySelectorAll('pre > code')) {
    const hint = (code.className.match(/language-([\w+#.-]+)/) || [])[1];
    const lang = languageFor(monaco, hint);
    if (!lang) continue;
    try {
      // colorize escapa o texto e só gera <span class="mtkN">; seguro para innerHTML.
      const html = await monaco.editor.colorize(code.textContent, lang, { tabSize: 2 });
      if (code.isConnected) { code.innerHTML = html; code.classList.add('md-colorized'); }
    } catch { /* sem realce */ }
  }
}

/** Preenche `container` com o Markdown renderizado. */
export function renderMarkdownInto(container, text, { filePath, workspaceRoot = State?.workspaceRoot } = {}) {
  container.innerHTML = sanitizeMarkdown(text);
  container.classList.add('md-doc');

  for (const img of container.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    const abs = resolveMarkdownPath(filePath, src, workspaceRoot);
    if (abs) img.src = toFileUrl(abs);
    else if (/^https?:/i.test(src)) img.title = `Imagem remota não carregada: ${src}`;
  }

  const seen = new Map();
  for (const h of container.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    let id = slugify(h.textContent);
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    if (n) id = `${id}-${n}`;
    h.id = id;
  }

  for (const a of container.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^https?:/i.test(href)) a.title = href;
  }

  if (!container.dataset.linksBound) {
    container.dataset.linksBound = '1';
    container.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || !container.contains(a)) return;
      e.preventDefault();
      const href = a.getAttribute('href');
      if (href.startsWith('#')) {
        const target = container.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`);
        target?.scrollIntoView({ block: 'start' });
        return;
      }
      if (/^https?:/i.test(href)) { window.agzos.app.openExternal(href); return; }
      const abs = resolveMarkdownPath(container.dataset.filePath, href, State?.workspaceRoot);
      if (abs) window.AgzosEditor?.openFile(abs);
    });
  }
  container.dataset.filePath = filePath || '';
  highlight(container);
}

/** Pré-visualização na própria aba (o modelo continua aberto por baixo). */
export function renderMarkdownViewer(file, ctx) {
  const doc = el('article', { class: 'md-doc' });
  const stage = el('div', { class: 'viewer-stage viewer-md-stage' }, doc);
  const root = el('div', { class: 'viewer viewer-markdown' },
    toolbar(
      el('span', { class: 'viewer-meta', text: `Pré-visualização: ${basename(file.path)}` }),
      spacer(),
      actionButton('md-preview-side', 'Abrir ao lado', 'columns-2', () => ctx.previewSide(file.path)),
      actionButton('open-text', 'Abrir como texto', 'code', () => ctx.openAsText(file.path)),
    ),
    stage);
  renderMarkdownInto(doc, ctx.getText(file.path), { filePath: file.path });
  return { element: root };
}
