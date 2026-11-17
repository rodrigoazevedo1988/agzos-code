/**
 * Agzos Formatador: "Formatar Documento" com o prettier (v3) embutido, num processo utilitário
 * (ipc/formatter.js → worker). Lê .prettierrc/.json/.yaml e "prettier" do package.json do
 * projeto; configs em código (.js/.mjs/.ts…) são ignoradas com aviso — nunca executa código
 * do projeto. Linguagens: JS/TS/JSX/TSX/JSON/CSS/SCSS/LESS/HTML/Markdown/YAML; nas demais
 * segue o formatador do Monaco. "Formatar ao salvar" por linguagem.
 * Opções: settings.modules.formatter = { enabled, formatOnSave: { <linguagem>: boolean } }.
 */

import { getActiveEditor, getMonaco, isUntitled, setFormatOnSaveCheck } from '../editor.js';
import { registerModule } from '../modules-hub.js';
import { toast } from '../toast.js';
import { modSettings, isModEnabled, onModSettings, mountModView } from './common.js';

const State = window.AgzosState;
const ID = 'formatter';
export const FORMATTER_LANGUAGES = ['javascript', 'typescript', 'json', 'css', 'scss', 'less', 'html', 'markdown', 'yaml'];

let providers = [];
const warned = new Set();

function cleanError(e) {
  return String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

/** Formatadores de documento do Monaco (CSS/HTML/JSON) ligados ou não. TS/JS só têm de trecho. */
function setBuiltinFormatting(monaco, on) {
  const { typescript, css, html, json } = monaco.languages;
  const all = [
    typescript?.typescriptDefaults, typescript?.javascriptDefaults,
    css?.cssDefaults, css?.scssDefaults, css?.lessDefaults, html?.htmlDefaults, json?.jsonDefaults,
  ];
  for (const defaults of all) {
    const mode = defaults?.modeConfiguration;
    if (!mode || !('documentFormattingEdits' in mode) || mode.documentFormattingEdits === on) continue;
    try {
      defaults.setModeConfiguration({ ...mode, documentFormattingEdits: on });
    } catch (e) {
      console.warn('[Formatador] modeConfiguration', e);
    }
  }
}

async function provideEdits(model, options, token) {
  const editor = getActiveEditor();
  const active = editor?.getModel() === model ? State.activePath : null;
  const path = active && !isUntitled(active) ? active : null;
  const text = model.getValue();
  try {
    const res = await window.agzos.formatter.format({
      path, text, languageId: model.getLanguageId(), tabSize: options.tabSize, insertSpaces: options.insertSpaces,
    });
    if (res.warning && !warned.has(res.warning)) {
      warned.add(res.warning);
      toast(res.warning, 'info', 8000);
    }
    if (token?.isCancellationRequested || model.isDisposed() || res.text === text) return [];
    return [{ range: model.getFullModelRange(), text: res.text }];
  } catch (e) {
    toast(`Agzos Formatador: ${cleanError(e)}`, 'error', 6000);
    return [];
  }
}

function sync() {
  const monaco = getMonaco();
  if (!monaco) return;
  const on = isModEnabled(ID);
  if (on && !providers.length) {
    setBuiltinFormatting(monaco, false);
    const provider = { displayName: 'Agzos Formatador (Prettier)', provideDocumentFormattingEdits: provideEdits };
    providers = FORMATTER_LANGUAGES.map((lang) => monaco.languages.registerDocumentFormattingEditProvider(lang, provider));
  } else if (!on && providers.length) {
    providers.forEach((d) => d.dispose());
    providers = [];
    setBuiltinFormatting(monaco, true);
  }
}

export function setupFormatter() {
  registerModule({
    id: ID,
    label: 'Agzos Formatador',
    icon: 'wand-sparkles',
    description: 'Formatação estilo Prettier embutida, com a config do projeto e formatar ao salvar.',
    open: (container) => mountModView(container, {
      id: ID,
      description: '"Formatar Documento" (Shift+Alt+F) usa o Prettier embutido em JS, TS, JSX, TSX, JSON, CSS, SCSS, LESS, HTML, Markdown e YAML; nas demais linguagens, o formatador do Monaco.',
      details: [
        'Lê .prettierrc, .prettierrc.json, .prettierrc.yaml e "prettier" do package.json.',
        'Configs em código (.prettierrc.js, prettier.config.mjs…) são ignoradas: nenhum código do projeto é executado.',
        '"Formatar ao salvar" por linguagem em Configurações → Módulos Agzos.',
      ],
    }),
  });
  setFormatOnSaveCheck((model) => {
    if (!model || !isModEnabled(ID)) return false;
    return modSettings(ID).formatOnSave?.[model.getLanguageId()] === true;
  });
  onModSettings(sync);
  sync();
}
