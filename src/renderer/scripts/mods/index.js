/**
 * Módulos Agzos de editor (1.2.0). Chamado pelo app.js depois do setupEditor();
 * a falha de um módulo não derruba os outros.
 */

import { setupInlineErrors } from './inline-errors.js';

export function setupEditorMods() {
  for (const [name, setup] of [
    ['Erros na Linha', setupInlineErrors],
  ]) {
    try {
      setup();
    } catch (e) {
      console.error(`[Módulos] ${name} falhou:`, e);
    }
  }
}
