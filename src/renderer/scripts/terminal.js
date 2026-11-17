/**
 * Terminal — gerenciador multi-sessão (xterm.js + IPC com o shell do sistema).
 *
 * Suporta:
 *  - Várias sessões, cada uma com o próprio shell (perfis: bash, zsh, pwsh, cmd, WSL…)
 *  - Divisão lado a lado (grupos) com divisores arrastáveis
 *  - Lista lateral de sessões (aparece com mais de uma sessão)
 *  - Aba PORTAS: portas TCP em escuta, abrir no navegador / copiar endereço
 *  - Posições flexíveis: inferior (bottom) ou lateral direita (right), maximizar
 *  - Redimensionamento suave via splitter, fonte/scrollback das configurações
 *
 * O estado puro (sessões/grupos/ordem) vive em terminal-sessions.js.
 */

import { toast } from './toast.js';
import { lucideIcon } from './lucide.js';
import { matchShortcut } from './keymap.js';
import {
  createSessionStore, defaultTitle, resizeSplit, portUrl, portHostLabel, normalizePorts,
} from './terminal-sessions.js';

const State = window.AgzosState;

const store = createSessionStore();
const byTermId = new Map(); // id do processo no main → sessão
const orphans = new Map(); // dados/exit que chegaram antes do term:create responder
let pendingSpawns = 0;
let ipcBound = false;
let xtermLoaded = null;
let started = false; // initTerminal já rodou (painel aberto ao menos uma vez)
let autoCreating = null;
let profilesCache = null;
const OUTPUT_BUFFER_CHARS = 20000;
const ORPHAN_MAX_CHARS = 64 * 1024;

let currentPosition = 'bottom'; // 'bottom' | 'right'
let isMaximized = false;
let panelBound = false;
// Tamanho escolhido pelo usuário em cada posição (px); null = padrão do CSS.
const panelSize = { bottom: null, right: null };
const LIST_COLLAPSED_KEY = 'agzos.terminal.listCollapsed';

/** Lista de sessões recolhida (só ícones). Preferência local; nunca lança. */
function readListCollapsed() {
  try { return localStorage.getItem(LIST_COLLAPSED_KEY) === '1'; } catch { return false; }
}
let listCollapsed = readListCollapsed();

export function isTerminalListCollapsed() { return listCollapsed; }

export function setTerminalListCollapsed(value) {
  listCollapsed = !!value;
  try { localStorage.setItem(LIST_COLLAPSED_KEY, listCollapsed ? '1' : '0'); } catch { /* ignora */ }
  renderList();
  requestAnimationFrame(() => fitVisible());
}

const FALLBACK_PROFILE = { id: null, label: 'Terminal', shell: '', icon: 'terminal' };
// Atalhos que o xterm não deve consumir (seguem para o handler global em app.js).
const PASSTHROUGH_ACTIONS = new Set(['terminal.toggle', 'terminal.new', 'terminal.split', 'terminal.prev', 'terminal.next']);

const SHELL_ICONS = {
  powershell: 'chevrons-right',
  cmd: 'square-chevron-right',
  bash: 'terminal',
  wsl: 'server',
  remote: 'chevrons-left-right',
  terminal: 'square-terminal',
};

const $ = (id) => document.getElementById(id);
const isMac = () => navigator.platform.toLowerCase().includes('mac');

// ANSI escape bytes are control characters by design and must be stripped before context is sent.
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|P[^\x1B]*\x1B\\|[@-_])/g, '');
}

function rememberOutput(session, text) {
  session.output = (session.output + stripAnsi(text)).slice(-OUTPUT_BUFFER_CHARS);
}

/** Saída recente (sem ANSI) da sessão ativa — contexto para a IA. */
export function getRecentOutput(maxChars = 4000) {
  const limit = Math.max(0, Number.isFinite(maxChars) ? Math.floor(maxChars) : 4000);
  const s = store.active();
  return limit && s ? s.output.slice(-limit) : '';
}

/* --------------------------------------------------------------------------
   Carregamento do xterm
   -------------------------------------------------------------------------- */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Falha ao carregar script ${src}`));
    document.head.appendChild(s);
  });
}

function loadStyle(href) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // CSS não deve bloquear execução do script
    document.head.appendChild(link);
  });
}

// O loader AMD do Monaco define window.define; os bundles UMD do xterm veem
// `define.amd` e se registram como módulo anônimo (erro "Can only have one
// anonymous define call per script file") em vez de expor window.Terminal.
// Com o loader presente, carregamos o xterm por ele; sem ele, via <script>.
function loadAmd(paths) {
  return new Promise((resolve, reject) => {
    window.require.config({ paths });
    window.require(Object.keys(paths), (...mods) => resolve(mods), reject);
  });
}

async function loadXterm() {
  if (xtermLoaded) return xtermLoaded;
  xtermLoaded = (async () => {
    await loadStyle('vendor/xterm/xterm.css');
    if (typeof window.define === 'function' && window.define.amd && typeof window.require?.config === 'function') {
      const [xterm, fit] = await loadAmd({
        'agzos-xterm': 'vendor/xterm/xterm',
        'agzos-xterm-fit': 'vendor/xterm/addon/fit',
      });
      window.Terminal = window.Terminal || xterm.Terminal;
      window.FitAddon = window.FitAddon || fit;
    } else {
      await loadScript('vendor/xterm/xterm.js');
      await loadScript('vendor/xterm/addon/fit.js');
    }
  })();
  xtermLoaded.catch(() => { xtermLoaded = null; });
  return xtermLoaded;
}

/** Carrega o xterm; devolve { Terminal, FitAddon } ou null (com toast). */
async function ensureXterm() {
  try {
    await loadXterm();
  } catch (err) {
    console.error('Erro ao carregar xterm:', err);
    toast('Não foi possível carregar o motor do terminal.', 'error');
    return null;
  }
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;
  if (!Terminal || !FitAddon) {
    toast('xterm.js não pôde ser inicializado.', 'error');
    return null;
  }
  return { Terminal, FitAddon };
}

/* --------------------------------------------------------------------------
   Tema / opções do xterm
   -------------------------------------------------------------------------- */

const XTERM_THEMES = {
  dark: {
    background: '#0E0E0E', foreground: '#E8E8E8', cursor: '#D10A11', cursorAccent: '#0E0E0E',
    selectionBackground: '#D10A1144',
    black: '#000000', red: '#D10A11', green: '#9ECE6A', yellow: '#E0AF68',
    blue: '#7AA2F7', magenta: '#BB9AF7', cyan: '#7DCFFF', white: '#E8E8E8',
    brightBlack: '#6A6A6A', brightRed: '#FF3B42', brightGreen: '#B9E08A', brightYellow: '#F0C98A',
    brightBlue: '#9AB8FF', brightMagenta: '#D0B8FF', brightCyan: '#A6E1FF', brightWhite: '#FFFFFF',
  },
  light: {
    background: '#FFFFFF', foreground: '#1A1A1A', cursor: '#D10A11', cursorAccent: '#FFFFFF',
    selectionBackground: '#D10A1129',
    black: '#1A1A1A', red: '#C4060D', green: '#2E7D32', yellow: '#946200',
    blue: '#1F5FBF', magenta: '#8E3FAF', cyan: '#00798A', white: '#8A8A8A',
    brightBlack: '#5E5E5E', brightRed: '#E0161D', brightGreen: '#3C9A41', brightYellow: '#B07A00',
    brightBlue: '#2F74DB', brightMagenta: '#A552C9', brightCyan: '#0B8FA3', brightWhite: '#3A3A3A',
  },
  monokai: {
    background: '#272822', foreground: '#F8F8F2', cursor: '#D10A11', cursorAccent: '#272822',
    selectionBackground: '#D10A1140',
    black: '#272822', red: '#F92672', green: '#A6E22E', yellow: '#E6DB74',
    blue: '#66D9EF', magenta: '#AE81FF', cyan: '#A1EFE4', white: '#F8F8F2',
    brightBlack: '#75715E', brightRed: '#FF4F8B', brightGreen: '#BEF05A', brightYellow: '#F2EA9A',
    brightBlue: '#8BE6F7', brightMagenta: '#C6A5FF', brightCyan: '#C1F6EE', brightWhite: '#FFFFFF',
  },
};

function currentXtermTheme() {
  const cls = document.body.classList;
  if (cls.contains('theme-agzos-light')) return XTERM_THEMES.light;
  if (cls.contains('theme-monokai')) return XTERM_THEMES.monokai;
  return XTERM_THEMES.dark;
}

function validFontSize(size) {
  return Number.isFinite(size) && size >= 6 && size <= 72;
}

function termOptions() {
  const fontSize = validFontSize(State.settings?.terminal?.fontSize) ? State.settings.terminal.fontSize : 13;
  const scrollbackSetting = Number(State.settings?.terminal?.scrollback);
  const scrollback = Number.isFinite(scrollbackSetting) && scrollbackSetting >= 0
    ? Math.min(Math.floor(scrollbackSetting), 100000)
    : 1000;
  return {
    cursorBlink: true,
    fontSize,
    scrollback,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
    theme: currentXtermTheme(),
    allowProposedApi: true,
    convertEol: true,
  };
}

/* --------------------------------------------------------------------------
   Perfis
   -------------------------------------------------------------------------- */

/** Perfis de shell detectados pelo main ({ profiles, defaultId }); tolera main antigo. */
/** Pasta remota aberta: perfil "SSH: <host>" (shell no host, na raiz) vira o padrão. */
function withRemoteProfile(res) {
  const root = State.workspaceRoot;
  if (typeof root !== 'string' || !root.startsWith('ssh://') || !res?.profiles) return res;
  const authority = root.slice(6).split('/')[0];
  const remote = { id: 'ssh-remote', label: `SSH: ${authority}`, shell: 'ssh', icon: 'remote', remote: root };
  return { ...res, profiles: [remote, ...res.profiles.filter((p) => p.id !== 'ssh-remote')], defaultId: 'ssh-remote', fallback: false };
}

export async function getTerminalProfiles(opts = {}) {
  return withRemoteProfile(await loadTerminalProfiles(opts));
}

async function loadTerminalProfiles({ force = false } = {}) {
  if (profilesCache && !force) return profilesCache;
  try {
    const fn = window.agzos?.term?.profiles;
    if (typeof fn === 'function') {
      const res = await fn();
      const profiles = (Array.isArray(res?.profiles) ? res.profiles : []).filter((p) => p && p.id);
      if (profiles.length) {
        const defaultId = profiles.some((p) => p.id === res.defaultId) ? res.defaultId : profiles[0].id;
        profilesCache = { profiles, defaultId };
        return profilesCache;
      }
    }
  } catch (err) {
    console.warn('[terminal] perfis indisponíveis:', err);
  }
  return { profiles: [FALLBACK_PROFILE], defaultId: null, fallback: true };
}

function shellIconName(profile) {
  return SHELL_ICONS[profile?.icon] || SHELL_ICONS.terminal;
}

function shellIcon(profile, size = 14) {
  const span = document.createElement('span');
  span.className = 'term-shell-icon';
  span.dataset.shell = profile?.icon || 'terminal';
  span.appendChild(lucideIcon(shellIconName(profile), { size, strokeWidth: 2 }));
  return span;
}

/* --------------------------------------------------------------------------
   IPC (listeners únicos, roteados por id do processo)
   -------------------------------------------------------------------------- */

function stashOrphan(termId, patch) {
  if (!pendingSpawns) return; // ninguém vai reclamar (ex.: saída tardia de sessão morta)
  const o = orphans.get(termId) || { data: '', exit: undefined };
  if (patch.data) o.data = (o.data + patch.data).slice(-ORPHAN_MAX_CHARS);
  if (patch.exit !== undefined) o.exit = patch.exit;
  orphans.set(termId, o);
  while (orphans.size > 16) orphans.delete(orphans.keys().next().value);
}

function handleExit(session, code) {
  if (session.termId) byTermId.delete(session.termId);
  session.termId = null;
  session.exited = true;
  session.exitCode = code;
  session.xterm.write(`\r\n\x1b[31m[Processo encerrou com código ${code}]\x1b[0m \x1b[2mEnter reinicia\x1b[0m\r\n`);
  if (session.id === store.activeSessionId) syncState();
  renderList();
  renderChip();
}

// Listeners globais (window resize + IPC) uma única vez por renderer.
function bindIpcOnce() {
  if (ipcBound) return;
  ipcBound = true;

  window.addEventListener('resize', scheduleFit);

  window.agzos.term.onData((id, data) => {
    const s = byTermId.get(id);
    if (!s) { stashOrphan(id, { data }); return; }
    rememberOutput(s, data);
    s.xterm.write(data);
  });

  window.agzos.term.onExit((id, code) => {
    const s = byTermId.get(id);
    if (!s) { stashOrphan(id, { exit: code }); return; }
    handleExit(s, code);
  });

  // Troca de tema (classe no body) repinta todas as sessões.
  new MutationObserver(() => {
    const theme = currentXtermTheme();
    for (const s of store.ordered()) {
      try { s.xterm.options.theme = theme; } catch {}
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  const host = $('terminal-host');
  if (host && typeof ResizeObserver === 'function') new ResizeObserver(scheduleFit).observe(host);
}

/* --------------------------------------------------------------------------
   Sessões
   -------------------------------------------------------------------------- */

function syncState() {
  const s = store.active();
  State.term = s ? { id: s.termId, term: s.xterm, fitAddon: s.fit, mode: s.mode, sessionId: s.id } : null;
}

let fitScheduled = false;
function scheduleFit() {
  if (fitScheduled) return;
  fitScheduled = true;
  requestAnimationFrame(() => {
    fitScheduled = false;
    fitVisible();
  });
}

/** Refaz o fit de todas as sessões visíveis (grupo ativo). */
function fitVisible() {
  const panel = $('bottom-panel');
  if (!panel || panel.hidden) return;
  for (const s of store.visible()) {
    if (s.host.offsetWidth > 0 && s.host.offsetHeight > 0) {
      try { s.fit.fit(); } catch {}
    }
  }
}

function focusActive() {
  const s = store.active();
  if (s) s.xterm.focus();
}

function wireSession(session) {
  const { xterm, host } = session;
  xterm.onData((data) => {
    if (session.exited) {
      if (/\r/.test(data)) restartSession(session);
      return;
    }
    if (session.termId) window.agzos.term.write(session.termId, data);
  });
  // fit() muda cols/rows; o pty precisa saber (senão vim/less quebram).
  xterm.onResize(({ cols, rows }) => {
    if (session.termId) window.agzos.term.resize(session.termId, cols, rows);
  });
  setupClipboard(xterm, host);
  // Clicar/focar uma metade do split a torna a sessão ativa.
  host.addEventListener('focusin', () => {
    if (store.activeSessionId !== session.id && store.has(session.id)) activateTerminal(session.id, { focus: false });
  });
}

async function spawnSession(session) {
  const { xterm } = session;
  pendingSpawns += 1;
  let res;
  try {
    const opts = { cwd: State.workspaceRoot || null };
    if (session.ssh) opts.ssh = { ...session.ssh };
    else if (session.profile?.id === 'ssh-remote') opts.remote = session.profile.remote || State.workspaceRoot;
    else if (session.profile?.id) opts.profileId = session.profile.id;
    res = await window.agzos.term.create(xterm.cols || 80, xterm.rows || 24, opts);
  } catch (e) {
    toast(`Não foi possível iniciar o terminal: ${e.message}`, 'error');
    res = null;
  } finally {
    pendingSpawns -= 1;
  }
  if (session.disposed) {
    if (res?.id) window.agzos.term.kill(res.id).catch(() => {});
    return;
  }
  const { id, error, warning, mode, code } = res || {};
  if (error && typeof code === 'string' && code.startsWith('ssh-')) toast(error, 'error', 8000);
  else if (error) toast(`Aviso do terminal: ${error}`, 'error');
  else if (warning) toast(`Terminal: ${warning}`, 'info', 6000);
  if (!id) {
    session.exited = true;
    if (session.ssh && error) xterm.write(`\x1b[31m[${error}]\x1b[0m\r\n`);
    xterm.write('\x1b[31m[Não foi possível iniciar o shell]\x1b[0m \x1b[2mEnter tenta de novo\x1b[0m\r\n');
    renderList();
    renderChip();
    return;
  }
  session.termId = id;
  session.exited = false;
  session.mode = mode || 'pipe';
  session.cwd = res.cwd || null;
  session.shell = res.shell || session.profile?.shell || '';
  // pty já entrega \r\n; no modo pipe o main converte, mas mantemos o
  // convertEol como rede de segurança só nesse modo (no pty quebra TUIs).
  xterm.options.convertEol = session.mode !== 'pty';
  // O main pode ter caído no perfil padrão (shell do perfil inexistente).
  if (!session.ssh && res.profileId && res.profileId !== session.profile?.id) {
    const p = profilesCache?.profiles.find((x) => x.id === res.profileId);
    if (p) {
      session.profile = p;
      if (!session.renamed) session.title = defaultTitle(p.label, store.ordered().filter((x) => x !== session).map((x) => x.title));
    }
  }
  byTermId.set(id, session);
  const o = orphans.get(id);
  if (o) {
    orphans.delete(id);
    if (o.data) { rememberOutput(session, o.data); xterm.write(o.data); }
    if (o.exit !== undefined) handleExit(session, o.exit);
  }
  if (session.id === store.activeSessionId) syncState();
  renderList();
  renderChip();
}

/**
 * Cria uma sessão (perfil padrão ou `profileId`). Com `split`, divide o grupo
 * ativo. Abre o painel na aba TERMINAL se preciso. Devolve a sessão ou null.
 *
 * `ssh` ({ alias } | { user, host, port }) cria uma sessão do cliente ssh do
 * sistema; o main valida e monta os argumentos. `title` sobrepõe o título.
 * O perfil "SSH…" (picker) sem `ssh` abre o seletor de conexão remota.
 */
export async function createTerminal({ profileId = null, split = false, focus = true, ssh = null, title = null } = {}) {
  setupTerminalPanel();
  const { profiles, defaultId } = await getTerminalProfiles();
  let profile = null;
  if (ssh) {
    const name = ssh.alias || ssh.host || 'remoto';
    profile = { id: 'ssh', label: title || `SSH: ${name}`, shell: 'ssh', icon: 'remote' };
  } else {
    profile = profileId ? profiles.find((p) => p.id === profileId) : null;
    if (profile?.picker) {
      const m = await import('./ssh.js');
      m.openRemotePicker();
      return null;
    }
    if (profileId && !profile) toast('Perfil de terminal não encontrado; usando o padrão.', 'info');
    if (!profile) profile = profiles.find((p) => p.id === defaultId && !p.picker) || profiles.find((p) => !p.picker) || FALLBACK_PROFILE;
  }
  const lib = await ensureXterm();
  if (!lib) return null;
  bindIpcOnce();

  const host = document.createElement('div');
  host.className = 'term-instance';
  const xterm = new lib.Terminal(termOptions());
  const fit = new lib.FitAddon();
  xterm.loadAddon(fit);
  const id = store.nextId();
  host.dataset.sessionId = id;
  const session = {
    id, termId: null, xterm, fit, host, profile, ssh: ssh ? { ...ssh } : null,
    title: defaultTitle(profile.label, store.ordered().map((s) => s.title)),
    mode: null, output: '', exited: false, disposed: false, weight: 1,
  };
  store.add(session, { split });
  layoutGroups();
  syncState();

  // Garante painel visível na aba do terminal antes do open/fit.
  const panel = $('bottom-panel');
  if (panel && (panel.hidden || getActiveBottomTab() !== 'terminal')) {
    if (getActiveBottomTab() !== 'terminal' && focus) selectBottomTab('terminal', { focus: false });
    if (focus || panel.hidden) setBottomPanelVisible(true);
  }

  xterm.open(host);
  wireSession(session);
  renderAll();
  await new Promise((r) => requestAnimationFrame(() => r()));
  fitVisible();
  await spawnSession(session);
  if (session.disposed) return null;
  fitVisible();
  if (focus && getActiveBottomTab() === 'terminal' && store.activeSessionId === session.id) xterm.focus();
  return session;
}

/**
 * Envia um comando ao terminal (Executar Tarefa, Executar Arquivo Ativo,
 * Executar Texto Selecionado). Usa o terminal ativo ou cria um (newTerminal
 * sempre cria). Mostra o painel na aba TERMINAL. Devolve true se enviou.
 */
export async function runInTerminal(text, { newTerminal = false } = {}) {
  let session = newTerminal ? null : store.active();
  if (session && (session.exited || !session.termId)) session = null;
  if (session) {
    if (getActiveBottomTab() !== 'terminal') selectBottomTab('terminal', { focus: false });
    setBottomPanelVisible(true);
    activateTerminal(session.id, { focus: true });
  } else {
    session = await createTerminal({ focus: true });
  }
  if (!session?.termId) {
    toast('Não foi possível abrir um terminal para executar o comando.', 'error');
    return false;
  }
  // `text` pode ser uma função (sessão) → comando, para montar as aspas conforme o shell
  // da sessão que vai rodar. Erro na montagem (caminho inseguro) → toast, nada é escrito.
  let built = text;
  if (typeof text === 'function') {
    try {
      built = text({ shell: session.ssh ? 'ssh' : (session.shell || session.profile?.shell || ''), ssh: !!session.ssh });
    } catch (err) {
      toast(err?.message || String(err), 'error', 6000);
      return false;
    }
  }
  const payload = String(built).replace(/\r?\n$/, '');
  await window.agzos.term.write(session.termId, `${payload}\r`);
  return true;
}

/** Divide o terminal ativo (cria uma sessão ao lado, mesmo perfil). */
export function splitTerminal({ profileId } = {}) {
  const active = store.active();
  if (!profileId && active?.ssh) return createTerminal({ ssh: active.ssh, split: true });
  return createTerminal({ profileId: profileId || (active?.ssh ? null : active?.profile?.id) || null, split: !!active });
}

/** Mata a sessão (ativa por padrão). A última fecha o painel. */
export async function killTerminal(id = store.activeSessionId) {
  const s = store.get(id);
  if (!s) return;
  s.disposed = true;
  const termId = s.termId;
  if (termId) byTermId.delete(termId);
  s.termId = null;
  s.host.remove();
  // O xterm agenda refresh do viewport em requestAnimationFrame e não cancela
  // no dispose ("reading 'dimensions'" ao matar sessões em sequência): deixa o
  // frame pendente rodar antes de descartar.
  requestAnimationFrame(() => { try { s.xterm.dispose(); } catch {} });
  store.remove(id);
  layoutGroups();
  syncState();
  if (!store.size) {
    renderAll();
    closeBottomPanel();
  } else {
    renderAll();
    scheduleFit();
    if (getActiveBottomTab() === 'terminal' && !$('bottom-panel')?.hidden) setTimeout(focusActive, 0);
  }
  if (termId) {
    try { await window.agzos.term.kill(termId); } catch {}
  }
}

/** Torna a sessão ativa (mostra o grupo dela). */
export function activateTerminal(id, { focus = true } = {}) {
  if (!store.activate(id)) return;
  syncState();
  renderAll();
  scheduleFit();
  if (focus) setTimeout(focusActive, 0);
}

/** Próxima (dir=1) ou anterior (dir=-1) sessão, circular. */
export function focusNextTerminal(dir = 1) {
  if (store.size < 2) return;
  const id = store.cycle(dir);
  activateTerminal(id, { focus: true });
}

export function renameTerminal(id, title) {
  if (!store.rename(id, title)) return false;
  renderList();
  renderChip();
  return true;
}

/** Snapshot das sessões (debug/e2e). */
export function listTerminals() {
  return store.rows().map((r) => ({
    id: r.session.id,
    termId: r.session.termId,
    title: r.session.title,
    profileId: r.session.profile?.id || null,
    ssh: r.session.ssh ? { ...r.session.ssh } : null,
    groupId: r.groupId,
    groupSize: r.groupSize,
    active: r.active,
    exited: !!r.session.exited,
    mode: r.session.mode,
  }));
}

function bufferOf(id) {
  const s = store.get(id);
  if (!s) return '';
  const buf = s.xterm.buffer.active;
  const lines = [];
  for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) || '');
  return lines.join('\n');
}

async function restartSession(session) {
  const old = session.termId;
  session.termId = null;
  if (old) {
    byTermId.delete(old);
    try { await window.agzos.term.kill(old); } catch {}
  }
  if (session.disposed) return;
  session.exited = false;
  session.xterm.reset();
  session.xterm.write('\x1b[33mReiniciando terminal…\x1b[0m\r\n');
  renderList();
  await spawnSession(session);
}

export async function initTerminal() {
  // Toolbar e splitter não dependem do xterm: ligamos antes de carregá-lo.
  setupTerminalPanel();
  started = true;
  await ensureSession();
}

/** Garante ao menos uma sessão (painel aberto sem sessões cria uma). */
function ensureSession() {
  if (store.size) return Promise.resolve(store.active());
  if (!autoCreating) {
    autoCreating = createTerminal({ focus: getActiveBottomTab() === 'terminal' })
      .finally(() => { autoCreating = null; });
  }
  return autoCreating;
}

export function clearTerminal() {
  const s = store.active();
  if (s) {
    s.xterm.clear();
    s.xterm.focus();
  }
}

export async function restartTerminal() {
  const s = store.active();
  if (!s) {
    await initTerminal();
    return;
  }
  await restartSession(s);
}

/* --------------------------------------------------------------------------
   Render: grupos, lista lateral, nome no toolbar
   -------------------------------------------------------------------------- */

function groupEl(groupId) {
  const host = $('terminal-host');
  let el = host?.querySelector(`.term-group[data-group-id="${groupId}"]`);
  if (!el && host) {
    el = document.createElement('div');
    el.className = 'term-group';
    el.dataset.groupId = groupId;
    host.appendChild(el);
  }
  return el;
}

// Reconstrói a estrutura dos grupos (ordem das sessões + divisores) e
// remove grupos vazios. Mover nós não recria o xterm.
function layoutGroups() {
  const host = $('terminal-host');
  if (!host) return;
  const groups = store.groups;
  const alive = new Set(groups.map((g) => g.id));
  host.querySelectorAll('.term-group').forEach((el) => { if (!alive.has(el.dataset.groupId)) el.remove(); });
  for (const g of groups) {
    const el = groupEl(g.id);
    const wanted = [];
    g.sessionIds.forEach((sid, i) => {
      if (i > 0) wanted.push(null); // divisor
      wanted.push(store.get(sid).host);
    });
    const current = [...el.children];
    const same = current.length === wanted.length
      && current.every((c, i) => (wanted[i] === null ? c.classList.contains('term-divider') : c === wanted[i]));
    if (!same) {
      el.querySelectorAll(':scope > .term-divider').forEach((d) => d.remove());
      wanted.forEach((node) => {
        if (node === null) {
          const d = document.createElement('div');
          d.className = 'term-divider';
          d.setAttribute('role', 'separator');
          d.setAttribute('aria-orientation', 'vertical');
          d.addEventListener('mousedown', (e) => startSplitDrag(e, d));
          el.appendChild(d);
        } else {
          el.appendChild(node);
        }
      });
    }
    el.classList.toggle('is-split', g.sessionIds.length > 1);
  }
}

function renderGroups() {
  const host = $('terminal-host');
  if (!host) return;
  const activeGroup = store.activeGroupId;
  host.querySelectorAll('.term-group').forEach((el) => { el.hidden = el.dataset.groupId !== activeGroup; });
  for (const s of store.ordered()) {
    s.host.classList.toggle('active', s.id === store.activeSessionId);
    s.host.style.flex = `${s.weight} 1 0`;
  }
}

function renderList() {
  const list = $('term-sessions');
  const pane = $('pane-terminal');
  if (!list) return;
  const many = store.size > 1;
  list.hidden = !many;
  pane?.classList.toggle('has-session-list', many);
  list.classList.toggle('collapsed', listCollapsed);
  if (!many) { list.replaceChildren(); return; }
  const editing = list.querySelector('.term-rename-input');
  if (editing) return; // não destrói o campo de renomear em uso
  // Linhas reaproveitadas por sessão: o duplo clique precisa cair no mesmo nó
  // dos dois cliques (o primeiro clique ativa e re-renderiza a lista).
  const prev = new Map([...list.children].map((el) => [el.dataset.sessionId, el]));
  const rows = store.rows().map((r) => {
    const s = r.session;
    const row = prev.get(s.id) || createRow(s.id);
    row.classList.toggle('active', r.active);
    row.classList.toggle('exited', !!s.exited);
    row.classList.toggle('in-split', r.groupSize > 1);
    row.setAttribute('aria-selected', String(r.active));
    row.tabIndex = r.active ? 0 : -1;
    row.title = [s.title, s.shell || s.profile?.shell, s.cwd].filter(Boolean).join('\n');
    const sig = JSON.stringify([r.glyph, s.title, !!s.exited, s.profile?.icon]);
    if (row.dataset.sig !== sig) {
      row.dataset.sig = sig;
      const glyph = document.createElement('span');
      glyph.className = 'term-session-glyph';
      glyph.textContent = r.glyph;
      glyph.setAttribute('aria-hidden', 'true');

      const title = document.createElement('span');
      title.className = 'term-session-title';
      title.textContent = s.title;

      const kill = document.createElement('button');
      kill.className = 'term-session-kill';
      kill.title = 'Matar terminal';
      kill.tabIndex = -1;
      kill.setAttribute('aria-label', `Matar ${s.title}`);
      kill.appendChild(lucideIcon('trash', { size: 13 }));
      kill.addEventListener('click', (e) => { e.stopPropagation(); killTerminal(s.id); });

      const parts = [glyph, shellIcon(s.profile, 14), title];
      if (s.exited) {
        const st = document.createElement('span');
        st.className = 'term-session-status';
        st.textContent = 'encerrado';
        parts.push(st);
      }
      parts.push(kill);
      row.replaceChildren(...parts);
    }
    return row;
  });
  list.replaceChildren(listToggle(), ...rows);
}

function listToggle() {
  let btn = $('term-list-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'term-list-toggle';
    btn.className = 'term-list-toggle';
    btn.type = 'button';
    btn.tabIndex = -1;
    btn.addEventListener('click', (e) => { e.stopPropagation(); setTerminalListCollapsed(!listCollapsed); });
  }
  const label = listCollapsed ? 'Expandir nomes dos terminais' : 'Recolher nomes dos terminais';
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.setAttribute('aria-expanded', String(!listCollapsed));
  btn.replaceChildren(lucideIcon(listCollapsed ? 'chevrons-left' : 'chevrons-right', { size: 13 }));
  return btn;
}

function createRow(id) {
  const row = document.createElement('div');
  row.className = 'term-session-row';
  row.dataset.sessionId = id;
  row.setAttribute('role', 'option');
  row.addEventListener('click', () => {
    if (store.activeSessionId !== id) activateTerminal(id);
    else focusActive();
  });
  row.addEventListener('dblclick', (e) => { e.preventDefault(); beginRename(id); });
  row.addEventListener('keydown', (e) => {
    if (e.target !== row) return;
    if (e.key === 'Enter') activateTerminal(id);
    else if (e.key === 'F2') beginRename(id);
    else if (e.key === 'Delete') killTerminal(id);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const sib = e.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
      sib?.focus();
    }
  });
  return row;
}

function renderChip() {
  const name = $('term-active-name');
  const icon = $('term-active-icon');
  const s = store.active();
  if (name) name.textContent = s ? s.title : 'Terminal';
  if (icon) icon.replaceChildren(shellIcon(s?.profile, 13));
  const chip = $('term-active');
  if (chip) chip.title = s ? [s.title, s.shell || s.profile?.shell, s.cwd].filter(Boolean).join('\n') : '';
  // Botão remoto da status bar (ssh.js) acompanha a sessão ativa.
  window.dispatchEvent(new CustomEvent('agzos:terminal-active', {
    detail: s ? { id: s.id, title: s.title, ssh: s.ssh ? { ...s.ssh } : null, exited: !!s.exited } : null,
  }));
}

function renderAll() {
  renderGroups();
  renderList();
  renderChip();
}

function beginRename(id = store.activeSessionId) {
  const s = store.get(id);
  if (!s) return;
  const row = document.querySelector(`#term-sessions .term-session-row[data-session-id="${id}"]`);
  const target = row && !$('term-sessions').hidden ? row.querySelector('.term-session-title') : $('term-active-name');
  if (!target) return;
  const input = document.createElement('input');
  input.className = 'term-rename-input';
  input.value = s.title;
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Nome do terminal');
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) store.rename(id, input.value);
    input.remove();
    target.hidden = false;
    renderList();
    renderChip();
    if (getActiveBottomTab() === 'terminal') focusActive();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
  target.hidden = true;
  target.after(input);
  input.focus();
  input.select();
}

function startSplitDrag(e, divider) {
  const a = divider.previousElementSibling;
  const b = divider.nextElementSibling;
  const sa = store.get(a?.dataset.sessionId);
  const sb = store.get(b?.dataset.sessionId);
  if (!sa || !sb) return;
  e.preventDefault();
  const startX = e.clientX;
  const wa = a.offsetWidth;
  const wb = b.offsetWidth;
  const weightA = sa.weight;
  const weightB = sb.weight;
  document.body.classList.add('resizing-col');
  divider.classList.add('dragging');
  const move = (ev) => {
    const r = resizeSplit({ wa, wb, weightA, weightB, dx: ev.clientX - startX });
    sa.weight = r.weightA;
    sb.weight = r.weightB;
    renderGroups();
    scheduleFit();
  };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    document.body.classList.remove('resizing-col');
    divider.classList.remove('dragging');
    scheduleFit();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
}

/* --------------------------------------------------------------------------
   Clipboard
   -------------------------------------------------------------------------- */

/**
 * Decide o que fazer com uma tecla no terminal (puro, testável):
 * 'copy' | 'paste' | null (segue para o shell).
 * Padrão de IDE: Ctrl+C copia só se houver seleção (senão é SIGINT);
 * Ctrl+Shift+C copia; Ctrl+V / Ctrl+Shift+V / Shift+Insert colam; Cmd no macOS.
 */
export function clipboardAction(e, hasSelection, isMacPlatform = false) {
  if (e.type !== 'keydown') return null;
  const key = String(e.key || '').toLowerCase();
  const code = e.code || '';
  const isC = key === 'c' || code === 'KeyC';
  const isV = key === 'v' || code === 'KeyV';
  if (isMacPlatform && e.metaKey && !e.ctrlKey && !e.altKey) {
    if (isC && hasSelection) return 'copy';
    if (isV) return 'paste';
    return null;
  }
  if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && (key === 'insert' || code === 'Insert')) return 'paste';
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  if (isC && (e.shiftKey || hasSelection)) return 'copy';
  if (isV) return 'paste';
  return null;
}

async function copySelection(t) {
  const text = t.getSelection();
  if (!text) return;
  try { await window.agzos.term.clipboardWrite(text); } catch { /* ignora */ }
  t.clearSelection();
}

async function pasteClipboard(t) {
  try {
    const text = await window.agzos.term.clipboardRead();
    if (text) t.paste(text); // respeita bracketed paste do shell
  } catch { /* ignora */ }
}

function setupClipboard(t, host) {
  const mac = isMac();
  t.attachCustomKeyEventHandler((e) => {
    // Atalhos do gerenciador de terminais não vão para o shell.
    if (e.type === 'keydown') {
      const action = matchShortcut(e, { isMac: mac });
      if (action && PASSTHROUGH_ACTIONS.has(action)) return false;
    }
    const action = clipboardAction(e, t.hasSelection(), mac);
    if (!action) return true;
    e.preventDefault();
    if (action === 'copy') copySelection(t);
    else pasteClipboard(t);
    return false;
  });
  // Botão direito: copia se houver seleção, senão cola (como no Windows Terminal).
  host.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (t.hasSelection()) copySelection(t);
    else pasteClipboard(t);
  });
}

/* --------------------------------------------------------------------------
   Posição / maximizar / abas / visibilidade do painel
   -------------------------------------------------------------------------- */

export function toggleTerminalPosition(targetPos) {
  const nextPos = targetPos || (currentPosition === 'bottom' ? 'right' : 'bottom');
  currentPosition = nextPos;
  applyPanelSize();

  const workbench = $('workbench-body');
  const btnPos = $('btn-pos-terminal');

  if (workbench) {
    if (nextPos === 'right') {
      workbench.classList.add('panel-right');
      workbench.classList.remove('panel-bottom');
      if (btnPos) {
        btnPos.innerHTML = lucideIcon('panel-bottom', { size: 14 }).outerHTML;
        btnPos.title = 'Mover Painel para Baixo';
      }
    } else {
      workbench.classList.add('panel-bottom');
      workbench.classList.remove('panel-right');
      if (btnPos) {
        btnPos.innerHTML = lucideIcon('panel-right', { size: 14 }).outerHTML;
        btnPos.title = 'Mover Painel para a Direita';
      }
    }
  }

  setTimeout(fitVisible, 100);
}

export function toggleTerminalMaximize() {
  isMaximized = !isMaximized;
  const workbench = $('workbench-body');
  const btnMax = $('btn-maximize-bottom');

  if (workbench) {
    workbench.classList.toggle('panel-maximized', isMaximized);
  }

  if (btnMax) {
    btnMax.innerHTML = lucideIcon(isMaximized ? 'minimize-2' : 'maximize-2', { size: 14 }).outerHTML;
    btnMax.title = isMaximized ? 'Restaurar Tamanho' : 'Maximizar Painel';
  }

  setTimeout(fitVisible, 100);
}

/** Aba ativa do painel inferior ('terminal' | 'ports' | 'output' | 'problems' | 'ai'). */
export function getActiveBottomTab() {
  return document.querySelector('.bottom-tab.active')?.dataset.tab || 'terminal';
}

/** Seleciona uma aba do painel inferior; voltar ao terminal refaz o fit do xterm. */
export function selectBottomTab(name, { focus = true } = {}) {
  const tab = document.querySelector(`.bottom-tab[data-tab="${name}"]`);
  if (!tab) return;
  document.querySelectorAll('.bottom-tab').forEach((t) => {
    t.classList.toggle('active', t === tab);
    t.setAttribute('aria-selected', String(t === tab));
  });
  document.querySelectorAll('.bottom-pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
  const panel = $('bottom-panel');
  if (panel) panel.dataset.activeTab = name;
  try { tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
  closeMenu();
  updatePortsPolling();
  if (name === 'terminal') {
    if (started && !store.size && panel && !panel.hidden) ensureSession();
    setTimeout(() => {
      fitVisible();
      if (focus) focusActive();
    }, 50);
  }
}

/** Mostra/esconde o painel inferior (e o splitter) sem mexer na aba ativa. */
export function setBottomPanelVisible(visible) {
  const panel = $('bottom-panel');
  if (!panel) return;
  panel.hidden = !visible;
  State.bottomHidden = panel.hidden;
  const resizer = $('panel-resizer');
  if (resizer) resizer.hidden = panel.hidden;
  if (!visible) closeMenu();
  updatePortsPolling();
  if (visible) {
    // Painel reaberto depois de matar a última sessão: cria uma nova.
    if (started && !store.size && getActiveBottomTab() === 'terminal') ensureSession();
    setTimeout(() => {
      if (getActiveBottomTab() === 'terminal') fitVisible();
    }, 60);
  }
}

export function closeBottomPanel() {
  setBottomPanelVisible(false);
}

// Ctrl+`: abre o painel na aba TERMINAL; se o painel já está aberto em outra
// aba (ex.: AGZOS IA), só volta para o terminal em vez de fechar.
export function toggleTerminal() {
  const panel = $('bottom-panel');
  if (!panel) return;
  if (!panel.hidden && getActiveBottomTab() !== 'terminal') {
    selectBottomTab('terminal');
    return;
  }
  const opening = panel.hidden;
  if (opening && getActiveBottomTab() !== 'terminal') selectBottomTab('terminal', { focus: false });
  setBottomPanelVisible(opening);

  if (opening) {
    setTimeout(() => {
      fitVisible();
      focusActive();
    }, 60);
  }
}

export function focusTerminal() {
  const panel = $('bottom-panel');
  if (!panel) return;
  if (getActiveBottomTab() !== 'terminal') selectBottomTab('terminal', { focus: false });
  setBottomPanelVisible(true);

  setTimeout(() => {
    fitVisible();
    focusActive();
  }, 60);
}

export function applyTerminalFontSize(size) {
  if (!validFontSize(size)) return;
  for (const s of store.ordered()) s.xterm.options.fontSize = size;
  fitVisible();
}

// Aplica só a dimensão da posição atual; a outra volta ao CSS
// (senão um height inline quebra o layout lateral e vice-versa).
function applyPanelSize() {
  const panel = $('bottom-panel');
  if (!panel) return;
  const size = panelSize[currentPosition];
  panel.style.height = currentPosition === 'bottom' && size ? `${size}px` : '';
  panel.style.width = currentPosition === 'right' && size ? `${size}px` : '';
}

/* --------------------------------------------------------------------------
   Menus suspensos (perfis, mais ações)
   -------------------------------------------------------------------------- */

let openMenuState = null;

function closeMenu() {
  if (!openMenuState) return;
  const { el, anchor, cleanup } = openMenuState;
  openMenuState = null;
  cleanup();
  el.remove();
  anchor.setAttribute('aria-expanded', 'false');
  anchor.classList.remove('open');
}

/** items: [{ label, icon?, iconEl?, hint?, action?, run } | { separator: true } | { heading }] */
function openMenu(anchor, items, { id, focusFirst = false } = {}) {
  if (openMenuState?.anchor === anchor) { closeMenu(); return; }
  closeMenu();
  const el = document.createElement('div');
  el.className = 'term-menu';
  if (id) el.id = id;
  el.setAttribute('role', 'menu');
  el.tabIndex = -1;
  const buttons = [];
  for (const it of items) {
    if (it.separator) {
      const sep = document.createElement('div');
      sep.className = 'term-menu-sep';
      sep.setAttribute('role', 'separator');
      el.appendChild(sep);
      continue;
    }
    if (it.heading) {
      const h = document.createElement('div');
      h.className = 'term-menu-heading';
      h.textContent = it.heading;
      el.appendChild(h);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'term-menu-item';
    b.setAttribute('role', 'menuitem');
    if (it.action) b.dataset.termAction = it.action;
    if (it.profileId) b.dataset.profileId = it.profileId;
    const ic = document.createElement('span');
    ic.className = 'term-menu-icon';
    if (it.iconEl) ic.appendChild(it.iconEl);
    else if (it.icon) ic.appendChild(lucideIcon(it.icon, { size: 14 }));
    const label = document.createElement('span');
    label.className = 'term-menu-label';
    label.textContent = it.label;
    b.append(ic, label);
    if (it.hint) {
      const hint = document.createElement('span');
      hint.className = 'term-menu-hint';
      hint.textContent = it.hint;
      b.appendChild(hint);
    }
    b.addEventListener('click', () => { closeMenu(); it.run(); });
    el.appendChild(b);
    buttons.push(b);
  }
  document.body.appendChild(el);

  // Alinha à direita do botão; abre para cima se não couber embaixo.
  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  const left = Math.max(6, Math.min(window.innerWidth - mw - 6, r.right - mw));
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 6) top = Math.max(6, r.top - mh - 4);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const i = buttons.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
      buttons[n]?.focus();
    }
  };
  const onBlur = () => closeMenu();
  window.addEventListener('mousedown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onBlur);
  openMenuState = {
    el,
    anchor,
    cleanup: () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
    },
  };
  anchor.setAttribute('aria-expanded', 'true');
  anchor.classList.add('open');
  // Aberto pelo teclado: foca o primeiro item; pelo mouse só o menu (setas funcionam).
  if (focusFirst) buttons[0]?.focus({ preventScroll: true });
  else el.focus({ preventScroll: true });
}

async function openProfilesMenu(anchor, { focusFirst = false } = {}) {
  const { profiles, defaultId, fallback } = await getTerminalProfiles();
  const items = [{ heading: 'Novo terminal' }];
  for (const p of profiles) {
    items.push({
      label: p.label,
      iconEl: shellIcon(p, 14),
      hint: p.id === defaultId && !fallback ? 'padrão' : '',
      action: 'new-profile',
      profileId: p.id || '',
      run: () => createTerminal({ profileId: p.id }),
    });
  }
  if (store.size) {
    items.push({ separator: true });
    items.push({ label: 'Dividir terminal', icon: 'columns-2', hint: 'Ctrl+Shift+5', action: 'split', run: () => splitTerminal() });
  }
  openMenu(anchor, items, { id: 'term-profiles-menu', focusFirst });
}

function openMoreMenu(anchor, { focusFirst = false } = {}) {
  const toRight = currentPosition === 'bottom';
  const has = store.size > 0;
  const items = [];
  if (has) {
    items.push(
      { label: 'Limpar', icon: 'eraser', action: 'clear', run: clearTerminal },
      { label: 'Reiniciar shell', icon: 'rotate-ccw', action: 'restart', run: restartTerminal },
      { label: 'Renomear…', icon: 'pencil', action: 'rename', run: () => beginRename() },
      {
        label: listCollapsed ? 'Expandir nomes dos terminais' : 'Recolher nomes dos terminais',
        icon: listCollapsed ? 'chevrons-left' : 'chevrons-right',
        action: 'toggle-list',
        run: () => setTerminalListCollapsed(!listCollapsed),
      },
      { separator: true },
    );
  }
  items.push({
    label: toRight ? 'Mover painel para a direita' : 'Mover painel para baixo',
    icon: toRight ? 'panel-right' : 'panel-bottom',
    action: 'move',
    run: () => toggleTerminalPosition(),
  });
  openMenu(anchor, items, { id: 'term-more-menu', focusFirst });
}

/* --------------------------------------------------------------------------
   Aba PORTAS
   -------------------------------------------------------------------------- */

const PORTS_INTERVAL_MS = 5000;
let portsTimer = null;
let portsInflight = null;
let portsState = { loaded: false, ports: [], error: null, at: null };

function portsVisible() {
  const panel = $('bottom-panel');
  return !!panel && !panel.hidden && getActiveBottomTab() === 'ports';
}

function updatePortsPolling() {
  if (portsVisible()) {
    if (!portsTimer) {
      refreshPorts();
      portsTimer = setInterval(() => { if (!document.hidden) refreshPorts(); }, PORTS_INTERVAL_MS);
    }
  } else if (portsTimer) {
    clearInterval(portsTimer);
    portsTimer = null;
  }
}

/** Atualiza a lista de portas (aba PORTAS). */
export function refreshPorts() {
  if (portsInflight) return portsInflight;
  const btn = $('btn-ports-refresh');
  btn?.classList.add('spinning');
  portsInflight = (async () => {
    try {
      const fn = window.agzos?.ports?.list;
      if (typeof fn !== 'function') throw new Error('A lista de portas não está disponível nesta versão.');
      const res = await fn();
      portsState = {
        loaded: true,
        ports: normalizePorts(res?.ports),
        error: res?.error || null,
        at: new Date(),
      };
    } catch (err) {
      portsState = { loaded: true, ports: [], error: err?.message || String(err), at: new Date() };
    } finally {
      portsInflight = null;
      btn?.classList.remove('spinning');
    }
    renderPorts();
    return portsState;
  })();
  return portsInflight;
}

async function copyText(text) {
  try {
    await window.agzos.term.clipboardWrite(text);
    toast(`Copiado: ${text}`, 'success', 1500);
  } catch {
    toast('Não foi possível copiar.', 'error');
  }
}

function openPortInBrowser(port) {
  const url = portUrl(port);
  Promise.resolve(window.agzos?.app?.openExternal?.(url)).catch(() => toast(`Não foi possível abrir ${url}.`, 'error'));
}

function portActionButton(icon, title, action, run) {
  const b = document.createElement('button');
  b.className = 'port-action';
  b.title = title;
  b.dataset.portAction = action;
  b.setAttribute('aria-label', title);
  b.appendChild(lucideIcon(icon, { size: 14 }));
  b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
  return b;
}

function renderPorts() {
  const view = $('ports-view');
  const tabCount = document.querySelector('.bottom-tab[data-tab="ports"] .bottom-tab-count');
  const { loaded, ports, error, at } = portsState;
  if (tabCount) {
    tabCount.textContent = ports.length ? String(ports.length) : '';
    tabCount.hidden = !ports.length;
  }
  if (!view) return;

  if (!loaded) {
    view.replaceChildren(portsMessage('radio-tower', 'Procurando portas em uso…', ''));
    return;
  }
  if (!ports.length) {
    view.replaceChildren(error
      ? portsMessage('circle-x', 'Não foi possível listar as portas', error, true)
      : portsMessage('radio-tower', 'Nenhuma porta em escuta', 'Inicie um servidor (por exemplo, npm run dev) e ele aparece aqui.'));
    return;
  }

  const table = document.createElement('table');
  table.className = 'ports-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th class="col-port">Porta</th><th class="col-addr">Endereço</th><th class="col-proc">Processo</th><th class="col-pid">PID</th><th class="col-act"><span class="sr-only">Ações</span></th></tr>';
  const tbody = document.createElement('tbody');
  for (const p of ports) {
    const tr = document.createElement('tr');
    tr.dataset.port = String(p.port);

    const tdPort = document.createElement('td');
    tdPort.className = 'col-port';
    const link = document.createElement('button');
    link.className = 'port-link';
    link.title = `Abrir ${portUrl(p.port)} no navegador`;
    const dot = document.createElement('span');
    dot.className = 'port-dot';
    dot.setAttribute('aria-hidden', 'true');
    const num = document.createElement('span');
    num.textContent = String(p.port);
    link.append(dot, num);
    link.addEventListener('click', () => openPortInBrowser(p.port));
    tdPort.appendChild(link);

    const tdAddr = document.createElement('td');
    tdAddr.className = 'col-addr';
    const scope = document.createElement('span');
    scope.textContent = portHostLabel(p.address);
    const raw = document.createElement('span');
    raw.className = 'port-raw';
    const rawText = p.addresses.filter(Boolean).join(', ');
    raw.textContent = rawText;
    tdAddr.append(scope);
    if (rawText && rawText !== scope.textContent) tdAddr.append(raw);

    const tdProc = document.createElement('td');
    tdProc.className = 'col-proc';
    tdProc.textContent = p.process || '—';
    if (!p.process) tdProc.classList.add('muted');

    const tdPid = document.createElement('td');
    tdPid.className = 'col-pid';
    tdPid.textContent = p.pid != null ? String(p.pid) : '—';
    if (p.pid == null) tdPid.classList.add('muted');

    const tdAct = document.createElement('td');
    tdAct.className = 'col-act';
    tdAct.append(
      portActionButton('external-link', 'Abrir no navegador', 'open', () => openPortInBrowser(p.port)),
      portActionButton('copy', 'Copiar endereço', 'copy', () => copyText(portUrl(p.port))),
    );

    tr.append(tdPort, tdAddr, tdProc, tdPid, tdAct);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);

  const foot = document.createElement('div');
  foot.className = 'ports-foot';
  const count = document.createElement('span');
  count.textContent = ports.length === 1 ? '1 porta em escuta' : `${ports.length} portas em escuta`;
  const when = document.createElement('span');
  when.textContent = at ? `Atualizado às ${at.toLocaleTimeString('pt-BR')}, a cada 5 s` : '';
  foot.append(count, when);
  if (error) {
    const warn = document.createElement('span');
    warn.className = 'ports-warn';
    warn.textContent = error;
    foot.appendChild(warn);
  }
  view.replaceChildren(table, foot);
}

function portsMessage(icon, title, body, isError = false) {
  const box = document.createElement('div');
  box.className = 'ports-empty';
  if (isError) box.classList.add('is-error');
  const ic = document.createElement('span');
  ic.className = 'ports-empty-icon';
  ic.appendChild(lucideIcon(icon, { size: 22, strokeWidth: 1.6 }));
  const h = document.createElement('p');
  h.className = 'ports-empty-title';
  h.textContent = title;
  box.append(ic, h);
  if (body) {
    const p = document.createElement('p');
    p.className = 'ports-empty-body';
    p.textContent = body;
    box.appendChild(p);
  }
  return box;
}

/* --------------------------------------------------------------------------
   Toolbar + splitter
   -------------------------------------------------------------------------- */

export function setupTerminalPanel() {
  if (panelBound) return;
  panelBound = true;
  setupToolbar();
  setupResizer();
  renderChip();
  // Atalhos de debug/e2e.
  window.AgzosTerminal = {
    list: listTerminals,
    buffer: bufferOf,
    create: (opts) => createTerminal(opts).then((s) => s?.id || null),
    kill: killTerminal,
    split: () => splitTerminal().then((s) => s?.id || null),
    activate: activateTerminal,
    rename: renameTerminal,
    refreshPorts,
  };
}

function bindButton(id, icon, handler) {
  const btn = $(id);
  if (!btn) return null;
  if (icon && !btn.querySelector('svg')) btn.appendChild(lucideIcon(icon, { size: 16, strokeWidth: 1.8 }));
  btn.addEventListener('click', (e) => handler(e, btn));
  return btn;
}

function setupToolbar() {
  bindButton('btn-term-new', 'plus', () => createTerminal());
  bindButton('btn-term-profiles', 'chevron-down', (e, btn) => openProfilesMenu(btn, { focusFirst: e.detail === 0 }));
  bindButton('btn-term-split', 'columns-2', () => splitTerminal());
  bindButton('btn-term-kill', 'trash', () => killTerminal());
  bindButton('btn-term-more', 'ellipsis', (e, btn) => openMoreMenu(btn, { focusFirst: e.detail === 0 }));
  bindButton('btn-ports-refresh', 'refresh-cw', () => refreshPorts());

  const btnPos = $('btn-pos-terminal');
  if (btnPos) btnPos.addEventListener('click', () => toggleTerminalPosition());

  const btnMax = $('btn-maximize-bottom');
  if (btnMax) btnMax.addEventListener('click', toggleTerminalMaximize);

  const btnClose = $('btn-close-bottom');
  if (btnClose) btnClose.addEventListener('click', closeBottomPanel);

  const chip = $('term-active');
  if (chip) chip.addEventListener('dblclick', () => beginRename());

  // Painel estreito: a roda do mouse rola a faixa de abas na horizontal.
  const strip = document.querySelector('.bottom-tab-strip');
  if (strip) {
    strip.addEventListener('wheel', (e) => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  // Tabs do painel (TERMINAL, PORTAS, OUTPUT, PROBLEMAS, AGZOS IA)
  document.querySelectorAll('.bottom-tab').forEach((tab) => {
    tab.addEventListener('click', () => selectBottomTab(tab.dataset.tab));
  });
}

function setupResizer() {
  const resizer = $('panel-resizer');
  const panel = $('bottom-panel');
  const workbench = $('workbench-body');
  if (!resizer || !panel || !workbench) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = panel.offsetWidth;
    startHeight = panel.offsetHeight;

    document.body.classList.add('resizing');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    if (currentPosition === 'bottom') {
      const deltaY = startY - e.clientY;
      panelSize.bottom = Math.round(Math.max(100, Math.min(window.innerHeight * 0.75, startHeight + deltaY)));
    } else {
      const deltaX = startX - e.clientX;
      panelSize.right = Math.round(Math.max(220, Math.min(window.innerWidth * 0.7, startWidth + deltaX)));
    }
    applyPanelSize();
    fitVisible();
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.classList.remove('resizing');
      fitVisible();
    }
  });
}
