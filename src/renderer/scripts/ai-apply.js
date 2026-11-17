import { getActiveEditor, openFile } from './editor.js';
import { showDiff } from './diff-view.js';
import { toast } from './toast.js';

let target = null;
export function captureAITarget() {
  const editor = getActiveEditor();
  const path = window.AgzosState.activePath;
  if (!path || !editor?.getModel()) return null;
  const selection = editor.getSelection();
  return { path, range: selection && !selection.isEmpty() ? {
    startLineNumber: selection.startLineNumber, startColumn: selection.startColumn,
    endLineNumber: selection.endLineNumber, endColumn: selection.endColumn,
  } : null };
}
export function setAITarget(value) { target = value; }
export function getAITarget() { return target || captureAITarget(); }

export async function showApplyDiff({ path, range, newText }) {
  const state = window.AgzosState;
  if (!path || !state.files.has(path)) { toast('O arquivo alvo não está aberto.', 'error'); return false; }
  if (state.activePath !== path) await openFile(path);
  const editor = getActiveEditor();
  const model = editor?.getModel();
  if (!model || state.activePath !== path) return false;
  const editRange = range || model.getFullModelRange();
  if (range && !model.validateRange(range).equalsRange(range)) {
    toast('A seleção alvo não existe mais no arquivo.', 'error'); return false;
  }
  const version = model.getVersionId();
  const accepted = await showDiff({ title: `Aplicar código — ${path}`, original: model.getValueInRange(editRange), modified: newText, language: model.getLanguageId() });
  if (!accepted) return false;
  if (state.activePath !== path || editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version) {
    toast('O arquivo mudou durante a revisão. Abra o diff novamente.', 'error'); return false;
  }
  model.pushStackElement();
  model.pushEditOperations([], [{ range: editRange, text: newText }], () => null);
  model.pushStackElement();
  return true;
}
