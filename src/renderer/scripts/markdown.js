/** Renderiza Markdown e remove HTML potencialmente perigoso antes de exibi-lo. */
export function renderMarkdown(text) {
  const container = document.createElement('div');
  container.innerHTML = window.DOMPurify.sanitize(window.marked.parse(String(text)));
  container.querySelectorAll('pre').forEach((pre, index) => {
    const toolbar = document.createElement('div');
    toolbar.className = 'ai-code-actions';
    for (const [action, label] of [['copy', 'Copiar'], ['apply', 'Aplicar']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.codeIndex = String(index);
      button.dataset.codeAction = action;
      button.textContent = label;
      toolbar.appendChild(button);
    }
    pre.before(toolbar);
  });
  return container.innerHTML;
}
