/**
 * Agzos Marca-texto: comentários coloridos pelo marcador do início (! alerta, ? dúvida,
 * TODO/FIXME, * destaque, // riscado). Reconhece //, #, --, /* *\/ e <!-- --> conforme a
 * linguagem (highlight-tags.js). Lista editável em settings.modules.highlighter.tags
 * ("marcador=#cor"); as cores viram classes CSS geradas aqui.
 */

import { getActiveEditor, getMonaco } from '../editor.js';
import { registerModule } from '../modules-hub.js';
import { modSettings, isModEnabled, onModSettings, mountModView } from './common.js';
import { DEFAULT_TAGS, parseTags, findTaggedComments } from './highlight-tags.js';

const ID = 'highlighter';
const MAX_CHARS = 1024 * 1024; // arquivos maiores não são analisados
let collection = null;

function tagList() {
  const tags = modSettings(ID).tags;
  return Array.isArray(tags) ? tags : DEFAULT_TAGS;
}

/** Uma classe por marcador (índice na lista), com a cor configurada. */
function syncStyles(tags) {
  let style = document.getElementById('agzos-hl-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'agzos-hl-style';
    document.head.append(style);
  }
  style.textContent = tags.map((t, i) => (
    `.monaco-editor .agzos-hl-${i} { color: ${t.color} !important;${t.strike ? ' text-decoration: line-through;' : ''} }`
  )).join('\n');
}

function refresh() {
  const editor = getActiveEditor();
  const monaco = getMonaco();
  if (!editor || !monaco) return;
  if (!collection) collection = editor.createDecorationsCollection();
  const model = editor.getModel();
  if (!model || !isModEnabled(ID) || model.getValueLength() > MAX_CHARS) {
    collection.clear();
    return;
  }
  const list = tagList();
  const parsed = parseTags(list);
  syncStyles(parsed);
  const index = new Map(parsed.map((t, i) => [t.tag, i]));
  const ranges = findTaggedComments(model.getValue(), model.getLanguageId(), list);
  collection.set(ranges.map((r) => ({
    range: new monaco.Range(r.startLine, r.startColumn, r.endLine, r.endColumn),
    options: { description: 'agzos-highlighter', inlineClassName: `agzos-hl agzos-hl-${index.get(r.tag)}` },
  })));
}

export function setupHighlighter() {
  registerModule({
    id: ID,
    label: 'Agzos Marca-texto',
    icon: 'highlighter',
    description: 'Comentários coloridos por marcador: ! alerta, ? dúvida, TODO, * destaque, // riscado.',
    open: (container) => mountModView(container, {
      id: ID,
      description: 'Colore comentários pelo marcador do início. Funciona com //, #, --, /* */ e <!-- --> conforme a linguagem.',
      details: [
        '// ! alerta (vermelho)',
        '// ? dúvida (azul)',
        '// TODO / FIXME (laranja)',
        '// * destaque (verde)',
        '//// código antigo (riscado, cinza)',
        'Marcadores e cores editáveis em Configurações → Módulos Agzos.',
      ],
    }),
  });

  const editor = getActiveEditor();
  if (!editor || !getMonaco()) return;
  let timer = null;
  const schedule = (delay = 150) => {
    clearTimeout(timer);
    timer = setTimeout(refresh, delay);
  };
  editor.onDidChangeModel(() => schedule(0));
  editor.onDidChangeModelLanguage(() => schedule(0));
  editor.onDidChangeModelContent(() => schedule());
  onModSettings(() => schedule(0));
  schedule(0);
}
