/**
 * Agzos Erros Claros: mensagens do TypeScript/JavaScript reformatadas no hover (tipos longos
 * quebrados e indentados, trechos de tipo realçados, código do erro com link para
 * https://typescript.tv/errors/). O painel Problemas (problems-panel.js) usa a mesma formatação.
 * Opção: settings.modules.prettyErrors.enabled.
 */

import { getMonaco } from '../editor.js';
import { registerModule } from '../modules-hub.js';
import { isModEnabled, mountModView } from './common.js';
import { tsErrorMarkdown } from './format-ts-error.js';

export const ID = 'prettyErrors';
const TS_OWNERS = new Set(['typescript', 'javascript']);

export function isTsMarker(marker) {
  return !!marker && TS_OWNERS.has(marker.owner);
}

function contains(marker, position) {
  const { lineNumber: l, column: c } = position;
  if (l < marker.startLineNumber || l > marker.endLineNumber) return false;
  if (l === marker.startLineNumber && c < marker.startColumn) return false;
  if (l === marker.endLineNumber && c > marker.endColumn) return false;
  return true;
}

export function setupPrettyErrors() {
  registerModule({
    id: ID,
    label: 'Agzos Erros Claros',
    icon: 'message-square-warning',
    description: 'Erros do TypeScript legíveis: tipos quebrados, realçados e com link para a documentação.',
    open: (container) => mountModView(container, {
      id: ID,
      description: 'Reformata as mensagens do TypeScript/JavaScript no hover e no painel Problemas: tipos longos quebrados e indentados, trechos de tipo realçados e o código do erro com link para a documentação.',
    }),
  });

  const monaco = getMonaco();
  if (!monaco) return;
  const provider = {
    provideHover(model, position) {
      if (!isModEnabled(ID)) return null;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri })
        .filter((m) => isTsMarker(m) && contains(m, position));
      if (!markers.length) return null;
      const first = markers[0];
      return {
        range: new monaco.Range(first.startLineNumber, first.startColumn, first.endLineNumber, first.endColumn),
        contents: markers.map((m) => ({ value: tsErrorMarkdown(m.message, m.code) })),
      };
    },
  };
  for (const lang of TS_OWNERS) monaco.languages.registerHoverProvider(lang, provider);
}
