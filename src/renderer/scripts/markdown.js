import { lucideIcon } from './lucide.js';

const CODE_ACTIONS = [
  ['copy', 'Copiar', 'copy', 'Copiar código'],
  ['insert', 'Inserir', 'text-cursor-input', 'Inserir no cursor do editor'],
  ['apply', 'Aplicar', 'git-compare', 'Aplicar no arquivo com revisão de diff'],
];

/**
 * Renderiza Markdown e remove HTML potencialmente perigoso antes de exibi-lo.
 * Blocos de código ganham um cabeçalho (linguagem + ações). Os botões só usam
 * texto/ícones nossos; o conteúdo do modelo já passou pelo DOMPurify.
 */
export function renderMarkdown(text) {
  const container = document.createElement('div');
  container.innerHTML = window.DOMPurify.sanitize(window.marked.parse(String(text)));
  container.querySelectorAll('pre').forEach((pre, index) => {
    const code = pre.querySelector('code');
    const lang = (code?.className.match(/language-([\w+#.-]+)/) || [])[1] || '';
    const wrap = document.createElement('div');
    wrap.className = 'ai-code';
    const head = document.createElement('div');
    head.className = 'ai-code-head';
    const label = document.createElement('span');
    label.className = 'ai-code-lang';
    label.textContent = lang || 'texto';
    const toolbar = document.createElement('div');
    toolbar.className = 'ai-code-actions';
    for (const [action, text, icon, title] of CODE_ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-code-btn';
      button.dataset.codeIndex = String(index);
      button.dataset.codeAction = action;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.append(lucideIcon(icon, { size: 13 }));
      const span = document.createElement('span');
      span.textContent = text;
      button.append(span);
      toolbar.appendChild(button);
    }
    head.append(label, toolbar);
    pre.before(wrap);
    wrap.append(head, pre);
  });
  return container.innerHTML;
}
