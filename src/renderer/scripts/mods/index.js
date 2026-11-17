/**
 * Módulos Agzos de editor (1.2.0). Chamado pelo app.js depois do setupEditor();
 * a falha de um módulo não derruba os outros.
 */

import { setupInlineErrors } from './inline-errors.js';
import { setupPrettyErrors } from './pretty-errors.js';
import { setupProblemsPanel } from './problems-panel.js';
import { setupHighlighter } from './highlighter.js';

export function setupEditorMods() {
  for (const [name, setup] of [
    ['Erros na Linha', setupInlineErrors],
    ['Erros Claros', setupPrettyErrors],
    ['Painel Problemas', setupProblemsPanel],
    ['Marca-texto', setupHighlighter],
  ]) {
    try {
      setup();
    } catch (e) {
      console.error(`[Módulos] ${name} falhou:`, e);
    }
  }
}
