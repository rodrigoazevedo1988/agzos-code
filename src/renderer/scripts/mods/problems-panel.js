/**
 * Painel PROBLEMAS (#pane-problems): erros e avisos do arquivo ativo (marcadores do Monaco).
 * Clique numa linha leva ao ponto do erro. Com o Agzos Erros Claros ligado, mensagens do
 * TypeScript/JavaScript aparecem formatadas (tipos realçados com monaco.editor.colorize e
 * código do erro com link para a documentação).
 */

import { getActiveEditor, getMonaco } from '../editor.js';
import { isModEnabled, onModSettings } from './common.js';
import { formatTsMessage, tsErrorCode } from './format-ts-error.js';
import { ID as PRETTY_ID, isTsMarker } from './pretty-errors.js';

const State = window.AgzosState;
const SEVERITY = { 8: 'error', 4: 'warning', 2: 'info', 1: 'hint' };
const SEVERITY_LABEL = { error: 'Erro', warning: 'Aviso', info: 'Info', hint: 'Dica' };
const MAX_ITEMS = 500;

const pane = () => document.getElementById('pane-problems');
const basename = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function colorizeInto(node, text) {
  const monaco = getMonaco();
  node.textContent = text;
  monaco?.editor?.colorize(text, 'typescript', { tabSize: 2 })
    .then((html) => { if (node.isConnected || node.parentNode) node.innerHTML = html; })
    .catch(() => {});
}

function prettyMessage(message) {
  const wrap = el('div', 'problem-msg problem-msg-pretty');
  for (const block of formatTsMessage(message).blocks) {
    const line = el('div', 'problem-line');
    line.style.paddingLeft = `${block.indent * 14}px`;
    if (block.indent > 0) line.append(el('span', 'problem-chain', '↳ '));
    for (const part of block.parts) {
      if (part.type === 'type') {
        const code = el(part.multiline ? 'pre' : 'code', `problem-type${part.multiline ? ' multiline' : ''}`);
        colorizeInto(code, part.text);
        line.append(code);
      } else {
        line.append(document.createTextNode(part.text));
      }
    }
    wrap.append(line);
  }
  return wrap;
}

function render() {
  const host = pane();
  const editor = getActiveEditor();
  const monaco = getMonaco();
  if (!host || !monaco) return;
  const model = editor?.getModel();
  const markers = model && State.activePath
    ? monaco.editor.getModelMarkers({ resource: model.uri })
      .slice()
      .sort((a, b) => (b.severity - a.severity) || (a.startLineNumber - b.startLineNumber) || (a.startColumn - b.startColumn))
      .slice(0, MAX_ITEMS)
    : [];
  host.replaceChildren();
  if (!markers.length) {
    host.append(el('div', 'empty-state', 'Sem problemas.'));
    return;
  }
  const pretty = isModEnabled(PRETTY_ID);
  const list = el('div', 'problems-list');
  list.setAttribute('role', 'list');
  const file = basename(State.activePath);
  for (const m of markers) {
    const sev = SEVERITY[m.severity] || 'info';
    const item = el('div', `problem-item problem-${sev}`);
    item.setAttribute('role', 'listitem');
    item.tabIndex = 0;
    item.title = 'Ir para o problema';
    item.append(el('span', `problem-sev problem-sev-${sev}`, SEVERITY_LABEL[sev]));
    const body = el('div', 'problem-body');
    const usePretty = pretty && isTsMarker(m);
    body.append(usePretty ? prettyMessage(m.message) : el('div', 'problem-msg', m.message));
    const meta = el('div', 'problem-meta');
    meta.append(el('span', 'problem-file', file), el('span', 'problem-pos', ` [Ln ${m.startLineNumber}, Col ${m.startColumn}]`));
    if (m.source) meta.append(el('span', 'problem-source', ` ${m.source}`));
    const ref = usePretty ? tsErrorCode(m.code) : null;
    if (ref) {
      const link = el('a', 'problem-code', ref.label);
      link.href = ref.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = `Documentação do erro ${ref.label}`;
      link.addEventListener('click', (e) => e.stopPropagation());
      meta.append(document.createTextNode(' '), link);
    }
    body.append(meta);
    item.append(body);
    const go = () => {
      const ed = getActiveEditor();
      if (!ed) return;
      ed.setPosition({ lineNumber: m.startLineNumber, column: m.startColumn });
      ed.revealLineInCenterIfOutsideViewport(m.startLineNumber);
      ed.focus();
    };
    item.addEventListener('click', go);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    list.append(item);
  }
  host.append(list);
}

export function setupProblemsPanel() {
  const editor = getActiveEditor();
  const monaco = getMonaco();
  if (!editor || !monaco) return;
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  };
  monaco.editor.onDidChangeMarkers((uris) => {
    const model = editor.getModel();
    if (model && uris.some((u) => u.toString() === model.uri.toString())) schedule();
  });
  editor.onDidChangeModel(schedule);
  window.addEventListener('agzos:active-file-changed', schedule);
  onModSettings(schedule);
  schedule();
}
