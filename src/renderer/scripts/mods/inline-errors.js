/**
 * Agzos Erros na Linha: mostra a mensagem do erro/aviso no fim da linha (decoração `after`
 * do Monaco, cor por severidade, truncada com reticências; o hover mostra a mensagem inteira).
 * Opções em settings.modules.inlineErrors: { enabled, severities, onlyCursorLine }.
 */

import { getActiveEditor, getMonaco } from '../editor.js';
import { registerModule } from '../modules-hub.js';
import { modSettings, isModEnabled, onModSettings, mountModView } from './common.js';
import { inlineErrorItems } from './inline-errors-core.js';

const ID = 'inlineErrors';
let collection = null;

function escapeMarkdown(text) {
  return String(text).replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&');
}

function refresh() {
  const editor = getActiveEditor();
  const monaco = getMonaco();
  if (!editor || !monaco) return;
  if (!collection) collection = editor.createDecorationsCollection();
  const model = editor.getModel();
  if (!model || !isModEnabled(ID)) {
    collection.clear();
    return;
  }
  const cfg = modSettings(ID);
  const items = inlineErrorItems(monaco.editor.getModelMarkers({ resource: model.uri }), {
    severities: cfg.severities,
    onlyCursorLine: cfg.onlyCursorLine === true,
    cursorLine: editor.getPosition()?.lineNumber ?? null,
  });
  const lineCount = model.getLineCount();
  collection.set(items.filter((it) => it.line <= lineCount).map((it) => {
    const col = model.getLineMaxColumn(it.line);
    return {
      range: new monaco.Range(it.line, col, it.line, col),
      options: {
        description: 'agzos-inline-error',
        showIfCollapsed: true,
        after: {
          content: `\u2003${it.text}`,
          inlineClassName: `agzos-inline-error agzos-inline-error-${it.severity}`,
          cursorStops: monaco.editor.InjectedTextCursorStops?.None,
        },
        hoverMessage: { value: escapeMarkdown(it.message).replace(/\n/g, '  \n') },
      },
    };
  }));
}

export function setupInlineErrors() {
  registerModule({
    id: ID,
    label: 'Agzos Erros na Linha',
    icon: 'triangle-alert',
    description: 'Mostra a mensagem de erros e avisos no fim da linha, sem passar o mouse.',
    open: (container) => mountModView(container, {
      id: ID,
      description: 'Mostra a mensagem de erros e avisos no fim da própria linha, com a cor da severidade. Passe o mouse para ver a mensagem inteira.',
      details: ['Severidades e "só na linha do cursor" em Configurações → Módulos Agzos.'],
    }),
  });

  const editor = getActiveEditor();
  const monaco = getMonaco();
  if (!editor || !monaco) return;
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 60);
  };
  monaco.editor.onDidChangeMarkers((uris) => {
    const model = editor.getModel();
    if (model && uris.some((u) => u.toString() === model.uri.toString())) schedule();
  });
  editor.onDidChangeModel(schedule);
  editor.onDidChangeCursorPosition(() => {
    if (modSettings(ID).onlyCursorLine === true) schedule();
  });
  onModSettings(schedule);
  schedule();
}
