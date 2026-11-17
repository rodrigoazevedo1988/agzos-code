/**
 * Peças compartilhadas pelos visualizadores: botões, barra de ferramentas,
 * rodapé e a tela de fallback ("Abrir no app padrão" / "Revelar na pasta").
 */

import { lucideIcon } from '../lucide.js';
import { toast } from '../toast.js';
import { formatBytes } from './format.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

export function basename(p) {
  return String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');
}

/** Botão de ação com ícone (data-action para testes/atalhos). */
export function actionButton(action, label, icon, onClick, { title, iconOnly = false } = {}) {
  const btn = el('button', {
    type: 'button',
    class: 'viewer-btn' + (iconOnly ? ' icon-only' : ''),
    'data-action': action,
    title: title || label,
    'aria-label': title || label,
    onclick: onClick,
  });
  if (icon) btn.append(lucideIcon(icon, { size: 14 }));
  if (!iconOnly) btn.append(el('span', { text: label }));
  return btn;
}

export async function openExternal(filePath) {
  try {
    await window.agzos.fs.openPath(filePath);
  } catch (e) {
    toast(`Não foi possível abrir no app padrão: ${e.message}`, 'error');
  }
}

export async function revealInFolder(filePath) {
  try {
    await window.agzos.fs.reveal(filePath);
  } catch (e) {
    toast(`Não foi possível revelar: ${e.message}`, 'error');
  }
}

export function externalButtons(filePath) {
  return [
    actionButton('open-external', 'Abrir no app padrão', 'square-arrow-out-up-right', () => openExternal(filePath)),
    actionButton('reveal', 'Revelar na pasta', 'folder-open', () => revealInFolder(filePath)),
  ];
}

/**
 * Tela cheia de aviso ("Formato sem pré-visualização", "Arquivo binário"…).
 * ctx.openAsText(path) entra como "Abrir como texto" se opts.allowText.
 */
export function fallbackScreen(file, ctx, { kind = 'external', title, detail, icon = 'file-question-mark', allowText = false, textLabel = 'Abrir como texto' } = {}) {
  const actions = [...externalButtons(file.path)];
  if (allowText) actions.push(actionButton('open-text', textLabel, 'code', () => ctx.openAsText(file.path)));
  return el('div', { class: 'viewer viewer-fallback', 'data-kind': kind },
    el('div', { class: 'viewer-fallback-card' },
      el('div', { class: 'viewer-fallback-icon' }, lucideIcon(icon, { size: 40, strokeWidth: 1.4 })),
      el('h2', { text: title || 'Formato sem pré-visualização' }),
      el('p', { class: 'viewer-fallback-name', text: basename(file.path) }),
      el('p', { class: 'viewer-fallback-meta', text: formatBytes(file.size) }),
      detail ? el('p', { class: 'viewer-fallback-detail', text: detail }) : null,
      el('div', { class: 'viewer-fallback-actions' }, actions),
    ));
}

export function toolbar(...items) {
  return el('div', { class: 'viewer-toolbar' }, items);
}

export const spacer = () => el('div', { class: 'viewer-spacer' });
