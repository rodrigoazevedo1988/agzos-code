/**
 * Agzos Snap — interface (renderer).
 *
 * Com seleção (linhas inteiras) ou o arquivo inteiro: colore o código com monaco.editor.colorize
 * no tema escolhido, extrai tokens { t, c, i, b, u } pelo estilo calculado e manda ao main só
 * dados estruturados (nunca HTML). O main monta a página (CSP sem scripts), devolve a prévia
 * (iframe sandbox="" com srcdoc) e exporta o PNG 2x por janela oculta + capturePage.
 */

import { registerModule } from '../modules-hub.js';
import { registerCommands } from '../command-palette.js';
import { getActiveEditor, getMonaco } from '../editor.js';
import { toast } from '../toast.js';
import {
  moduleEnabled, buildModuleToggle, openToolDialog, button, field, baseName,
} from './tool-common.js';

const State = window.AgzosState;
const KEY = 'snap';

// Cores do editor de cada tema (espelho de editor.js: editor.background/foreground/lineNumber).
const THEMES = {
  'agzos-dark': { label: 'Agzos Escuro', bg: '#0E0E0E', fg: '#E8E8E8', lineNumber: '#5A5A5A' },
  'agzos-light': { label: 'Agzos Claro', bg: '#FFFFFF', fg: '#1A1A1A', lineNumber: '#999999' },
};

function currentMonacoTheme() {
  return State.settings?.theme === 'agzos-light' ? 'agzos-light' : 'agzos-dark';
}

/** Linhas inteiras da seleção (ou do arquivo), sem linhas vazias no fim. → { text, startLine } */
export function snapSource(editor) {
  const model = editor?.getModel?.();
  if (!model) return null;
  const sel = editor.getSelection();
  let start = 1;
  let end = model.getLineCount();
  if (sel && !sel.isEmpty()) {
    start = sel.startLineNumber;
    end = sel.endColumn === 1 && sel.endLineNumber > start ? sel.endLineNumber - 1 : sel.endLineNumber;
  }
  const lines = [];
  for (let n = start; n <= end; n++) lines.push(model.getLineContent(n));
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  return { text: lines.join('\n'), startLine: start, languageId: model.getLanguageId() };
}

/** Converte o HTML do colorize (anexado ao documento para ler o estilo) em linhas de tokens. */
function tokensFromColorized(html) {
  const holder = document.createElement('div');
  holder.className = 'snap-measure monaco-editor';
  holder.setAttribute('aria-hidden', 'true');
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstChild;
  holder.append(...[...parsed.childNodes].map((n) => document.adoptNode(n)));
  document.body.append(holder);
  const lines = [[]];
  try {
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          const t = child.textContent.replace(/\u00a0/g, ' ');
          if (!t) continue;
          const cs = getComputedStyle(child.parentElement);
          lines[lines.length - 1].push({
            t,
            c: cs.color,
            i: cs.fontStyle === 'italic',
            b: Number.parseInt(cs.fontWeight, 10) >= 600,
            u: cs.textDecorationLine.includes('underline'),
          });
        } else if (child.nodeName === 'BR') {
          lines.push([]);
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child);
        }
      }
    };
    walk(holder);
  } finally {
    holder.remove();
  }
  return lines;
}

async function colorizeTokens(source, themeId) {
  const monaco = getMonaco();
  const original = currentMonacoTheme();
  const tabSize = State.settings?.editor?.tabSize || 2;
  // Aquece o tokenizador no tema atual: depois a troca de tema dura só o tempo do colorize.
  await monaco.editor.colorize(source.text, source.languageId, { tabSize });
  if (themeId !== original) monaco.editor.setTheme(themeId);
  try {
    const html = await monaco.editor.colorize(source.text, source.languageId, { tabSize });
    const lines = tokensFromColorized(html);
    const count = source.text.split('\n').length;
    return lines.slice(0, count);
  } finally {
    if (themeId !== original) monaco.editor.setTheme(original);
  }
}

function select(options, value) {
  const el = document.createElement('select');
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    el.append(o);
  }
  el.value = value;
  return el;
}

function checkbox(checked) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  return input;
}

export async function openSnapDialog() {
  if (!moduleEnabled(KEY)) { toast('O Agzos Snap está desabilitado nas Configurações.', 'info'); return null; }
  const editor = getActiveEditor();
  const source = State.activePath ? snapSource(editor) : null;
  if (!source || !source.text.trim()) { toast('Abra um arquivo (ou selecione um trecho) para capturar.', 'info'); return null; }

  const ui = openToolDialog({ title: 'Agzos Snap', className: 'snap-dialog' });
  const theme = select(Object.entries(THEMES).map(([id, t]) => [id, t.label]), currentMonacoTheme());
  const background = select([['gradient', 'Gradiente Agzos'], ['solid', 'Sólido'], ['transparent', 'Transparente']], 'gradient');
  const solid = document.createElement('input');
  solid.type = 'color';
  solid.value = '#1a1a1a';
  const padding = document.createElement('input');
  padding.type = 'number';
  padding.min = '0';
  padding.max = '128';
  padding.value = '48';
  const frame = checkbox(true);
  const title = document.createElement('input');
  title.type = 'text';
  title.value = baseName(State.activePath || '');
  title.maxLength = 120;
  const lineNumbers = checkbox(true);
  const watermark = checkbox(State.settings?.modules?.snap?.watermark !== false);

  const solidField = field('Cor do fundo', solid);
  const options = document.createElement('div');
  options.className = 'snap-options';
  options.append(
    field('Tema', theme), field('Fundo', background), solidField, field('Padding', padding),
    field('Moldura de janela', frame), field('Título', title), field('Números de linha', lineNumbers),
    field('Marca d\'água "Agzos Code"', watermark),
  );
  const preview = document.createElement('iframe');
  preview.className = 'snap-preview';
  // Sem scripts e sem mesma origem: a prévia não executa nada nem acessa o app.
  preview.setAttribute('sandbox', '');
  preview.title = 'Prévia do Agzos Snap';
  const info = document.createElement('div');
  info.className = 'snap-info';
  ui.body.append(options, preview, info);

  const tokensByTheme = new Map();
  async function payload() {
    const t = theme.value in THEMES ? theme.value : 'agzos-dark';
    if (!tokensByTheme.has(t)) tokensByTheme.set(t, await colorizeTokens(source, t));
    const pad = Number.parseInt(padding.value, 10);
    return {
      lines: tokensByTheme.get(t),
      theme: { bg: THEMES[t].bg, fg: THEMES[t].fg, lineNumber: THEMES[t].lineNumber },
      background: background.value,
      solidColor: solid.value,
      padding: Number.isInteger(pad) ? pad : 48,
      frame: frame.checked,
      title: title.value,
      lineNumbers: lineNumbers.checked,
      startLine: source.startLine,
      watermark: watermark.checked,
      fontSize: State.settings?.editor?.fontSize || State.settings?.fontSize || 14,
    };
  }

  let seq = 0;
  async function refresh() {
    const my = ++seq;
    solidField.hidden = background.value !== 'solid';
    try {
      const { html } = await window.agzos.snap.html(await payload());
      if (my !== seq) return;
      preview.srcdoc = html;
      info.textContent = '';
    } catch (e) {
      if (my === seq) info.textContent = `Erro: ${e.message}`;
    }
  }
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
  for (const el of [theme, background, solid, padding, frame, title, lineNumbers, watermark]) {
    el.addEventListener(el.type === 'text' || el.type === 'number' || el.type === 'color' ? 'input' : 'change', schedule);
  }
  ui.onClose(() => { clearTimeout(timer); seq++; });

  let busy = false;
  async function exportImage(action) {
    if (busy) return;
    busy = true;
    info.textContent = 'Gerando imagem…';
    try {
      const r = await window.agzos.snap.exportImage(await payload(), action);
      if (r?.canceled) { info.textContent = ''; return; }
      info.textContent = `${r.width} × ${r.height} px`;
      toast(action === 'copy' ? 'Imagem copiada.' : `Imagem salva: ${baseName(r.path)}`, 'success', 2000);
    } catch (e) {
      info.textContent = '';
      toast(`Agzos Snap: ${e.message}`, 'error');
    } finally {
      busy = false;
    }
  }
  ui.actions.append(
    button('Fechar', { onClick: () => ui.close() }),
    button('Copiar imagem', { onClick: () => exportImage('copy') }),
    button('Salvar PNG', { primary: true, onClick: () => exportImage('save') }),
  );
  refresh();
  return ui;
}

export function setupSnap() {
  registerCommands([{
    id: 'agzos.snap.capture',
    label: 'Agzos Snap: Capturar código',
    run: () => openSnapDialog(),
  }]);
  getActiveEditor()?.addAction?.({
    id: 'agzos.snap.capture',
    label: 'Agzos Snap: Capturar código',
    contextMenuGroupId: '9_agzos',
    contextMenuOrder: 5,
    run: () => openSnapDialog(),
  });
  registerModule({
    id: KEY,
    label: 'Agzos Snap',
    icon: 'camera',
    description: 'Transforma o código selecionado numa imagem bonita (PNG) para compartilhar.',
    open(view) {
      const p = document.createElement('p');
      p.className = 'tool-mod-desc';
      p.textContent = 'Selecione um trecho (ou use o arquivo inteiro) e escolha "Agzos Snap: Capturar código" '
        + 'na paleta ou no menu do editor. Exporte em PNG (2x) ou copie a imagem.';
      const go = button('Capturar arquivo atual', { primary: true, onClick: () => openSnapDialog() });
      view.append(buildModuleToggle(KEY), p, go);
    },
  });
}
