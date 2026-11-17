import { getMonaco } from './editor.js';

export function showDiff({ title, original, modified, language, readOnly = false, applyLabel = 'Aplicar' }) {
  const monaco = getMonaco();
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'diff-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const dialog = document.createElement('div');
    dialog.className = 'diff-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const host = document.createElement('div');
    host.className = 'diff-editor';
    const actions = document.createElement('div');
    actions.className = 'diff-actions';
    const cancel = document.createElement('button');
    cancel.textContent = readOnly ? 'Fechar' : 'Descartar';
    actions.append(cancel);
    const apply = document.createElement('button');
    if (!readOnly) { apply.textContent = applyLabel; actions.append(apply); }
    dialog.append(heading, host, actions);
    overlay.append(dialog);
    document.body.append(overlay);
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(modified, language);
    const editor = monaco.editor.createDiffEditor(host, { automaticLayout: true, readOnly: true, originalEditable: false });
    editor.setModel({ original: originalModel, modified: modifiedModel });
    const close = (accepted) => {
      document.removeEventListener('keydown', onKey, true);
      editor.dispose(); originalModel.dispose(); modifiedModel.dispose(); overlay.remove();
      resolve(accepted);
    };
    const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(false); } };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close(false));
    apply.addEventListener('click', () => close(true));
    cancel.focus();
  });
}
