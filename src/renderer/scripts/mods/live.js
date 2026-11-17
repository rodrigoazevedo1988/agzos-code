/**
 * Agzos Ao Vivo — interface (renderer).
 *
 * "Abrir com Agzos Ao Vivo" no menu de contexto (pasta ou .html), paleta e card no hub.
 * Status bar `#status-live` ("Ao Vivo :5500"): clique abre no navegador ou para.
 * Salvar um arquivo avisa o main (live:fileSaved), que recarrega os navegadores (SSE).
 * O servidor aparece na aba PORTAS por ser uma porta em escuta como outra qualquer.
 */

import { registerModule } from '../modules-hub.js';
import { registerCommands, showPicker } from '../command-palette.js';
import { registerContextMenuItems } from '../file-tree.js';
import { toast } from '../toast.js';
import { moduleEnabled, buildModuleToggle, button } from './tool-common.js';

const State = window.AgzosState;
const KEY = 'liveServer';
const api = () => window.agzos?.live;

let status = { running: false };
let viewEl = null;

const isHtml = (p) => typeof p === 'string' && /\.html?$/i.test(p);

function statusEl() { return document.getElementById('status-live'); }

function render() {
  const el = statusEl();
  if (el) {
    el.hidden = !status.running;
    el.textContent = status.running ? `Ao Vivo :${status.port}` : '';
    el.title = status.running ? `Agzos Ao Vivo em ${status.url} (clique para abrir ou parar)` : '';
  }
  if (viewEl?.isConnected) renderView(viewEl);
}

function setStatus(next) {
  status = next && next.running ? next : { running: false };
  render();
}

export async function startLive(target) {
  if (!moduleEnabled(KEY)) { toast('O Agzos Ao Vivo está desabilitado nas Configurações.', 'info'); return null; }
  const where = target || (isHtml(State.activePath) ? State.activePath : State.workspaceRoot);
  if (!where) { toast('Abra uma pasta ou um arquivo .html para usar o Agzos Ao Vivo.', 'info'); return null; }
  try {
    const r = await api().start(where);
    setStatus(await api().status());
    toast(`Agzos Ao Vivo em ${r.url}`, 'success', 2500);
    return r;
  } catch (e) {
    toast(`Agzos Ao Vivo: ${e.message}`, 'error');
    return null;
  }
}

export async function stopLive() {
  try { await api().stop(); } catch { /* já parado */ }
  setStatus({ running: false });
}

function statusMenu() {
  showPicker({
    title: status.running ? `Agzos Ao Vivo — ${status.url}` : 'Agzos Ao Vivo',
    items: [
      { label: 'Abrir no navegador', run: () => api().open() },
      { label: 'Parar Agzos Ao Vivo', run: () => stopLive() },
    ],
  });
}

function renderView(view) {
  view.replaceChildren();
  const p = document.createElement('p');
  p.className = 'tool-mod-desc';
  p.textContent = 'Servidor local (127.0.0.1) que serve a pasta do projeto e recarrega o navegador ao salvar. '
    + 'Use "Abrir com Agzos Ao Vivo" no menu de contexto de um .html ou de uma pasta.';
  const state = document.createElement('p');
  state.className = 'tool-mod-desc live-state';
  state.textContent = status.running ? `Rodando em ${status.url}` : 'Parado.';
  const actions = document.createElement('div');
  actions.className = 'live-actions';
  if (status.running) {
    actions.append(button('Abrir no navegador', { onClick: () => api().open() }), button('Parar', { onClick: () => stopLive() }));
  } else {
    actions.append(button('Abrir pasta do projeto', { primary: true, onClick: () => startLive(State.workspaceRoot) }));
  }
  view.append(buildModuleToggle(KEY), p, state, actions);
}

export function setupLive() {
  registerContextMenuItems((node) => (moduleEnabled(KEY) && (node.isDirectory || isHtml(node.path))
    ? [{ label: 'Abrir com Agzos Ao Vivo', run: () => startLive(node.path) }]
    : []));
  registerCommands([
    { id: 'agzos.live.start', label: 'Agzos Ao Vivo: Abrir', run: () => startLive() },
    { id: 'agzos.live.stop', label: 'Agzos Ao Vivo: Parar', run: () => stopLive() },
  ]);
  registerModule({
    id: KEY,
    label: 'Agzos Ao Vivo',
    icon: 'radio',
    description: 'Servidor local com recarga automática do navegador ao salvar.',
    open(view) {
      viewEl = view;
      renderView(view);
    },
  });

  const el = statusEl();
  if (el) {
    el.addEventListener('click', statusMenu);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); statusMenu(); }
    });
  }
  api()?.onChanged?.((s) => setStatus(s));
  window.addEventListener('agzos:file-saved', (e) => {
    const p = e.detail?.path;
    if (status.running && p) api().fileSaved(p).catch(() => {});
  });
  window.addEventListener('agzos:modules-settings', () => {
    if (status.running && !moduleEnabled(KEY)) stopLive();
  });
  api()?.status?.().then(setStatus).catch(() => {});
}
