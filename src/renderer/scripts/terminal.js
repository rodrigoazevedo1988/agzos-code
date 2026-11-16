/**
 * Terminal — xterm.js + IPC com o shell do sistema (bash/powershell).
 *
 * Suporta:
 *  - Posições flexíveis: inferior (bottom) ou lateral direita (right)
 *  - Maximizar / Restaurar
 *  - Limpeza de buffer e reinício rápido do shell
 *  - Redimensionamento suave via splitter
 *  - Integração com workspace ativo e configurações de fonte
 */

import { toast } from './toast.js';
import { lucideIcon } from './lucide.js';

const State = window.AgzosState;

let term = null;
let fitAddon = null;
let termId = null;
let xtermLoaded = null;
let recentOutput = '';
const OUTPUT_BUFFER_CHARS = 20000;

let currentPosition = 'bottom'; // 'bottom' | 'right'
let isMaximized = false;

// ANSI escape bytes are control characters by design and must be stripped before context is sent.
function stripAnsi(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|P[^\x1B]*\x1B\\|[@-_])/g, '');
}

function rememberOutput(text) {
  recentOutput = (recentOutput + stripAnsi(text)).slice(-OUTPUT_BUFFER_CHARS);
}

export function getRecentOutput(maxChars = 4000) {
  const limit = Math.max(0, Number.isFinite(maxChars) ? Math.floor(maxChars) : 4000);
  return limit ? recentOutput.slice(-limit) : '';
}

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

async function loadXterm() {
  if (xtermLoaded) return xtermLoaded;
  xtermLoaded = (async () => {
    await loadStyle('vendor/xterm/xterm.css');
    await loadScript('vendor/xterm/xterm.js');
    await loadScript('vendor/xterm/addon/fit.js');
  })();
  return xtermLoaded;
}

export async function initTerminal() {
  try {
    await loadXterm();
  } catch (err) {
    console.error('Erro ao carregar xterm:', err);
    toast('Não foi possível carregar o motor do terminal.', 'error');
    return;
  }

  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;
  if (!Terminal || !FitAddon) {
    toast('xterm.js não pôde ser inicializado.', 'error');
    return;
  }

  const host = document.getElementById('terminal-host');
  if (!host) return;
  host.innerHTML = '';

  const fontSize = State.settings?.terminal?.fontSize || 13;

  term = new Terminal({
    cursorBlink: true,
    fontSize,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
    theme: {
      background: '#0E0E0E',
      foreground: '#E8E8E8',
      cursor: '#D10A11',
      selectionBackground: '#D10A1144',
      black: '#000000',
      red: '#D10A11',
      green: '#9ECE6A',
      yellow: '#E0AF68',
      blue: '#7AA2F7',
      magenta: '#BB9AF7',
      cyan: '#7DCFFF',
      white: '#E8E8E8',
    },
    allowProposedApi: true,
    convertEol: true,
  });

  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(host);

  setTimeout(() => {
    try {
      fitAddon.fit();
      spawnShell();
    } catch {
      // ignore
    }
  }, 60);

  term.onData((data) => {
    if (termId) window.agzos.term.write(termId, data);
  });

  window.addEventListener('resize', () => {
    if (fitAddon && !document.getElementById('bottom-panel')?.hidden) {
      try { fitAddon.fit(); } catch {}
    }
  });

  window.agzos.term.onData((id, data) => {
    if (id === termId) {
      rememberOutput(data);
      term.write(data);
    }
  });

  window.agzos.term.onExit((id, code) => {
    if (id === termId) {
      term.write(`\r\n\x1b[31m[Processo encerrou com código ${code}]\x1b[0m\r\n`);
    }
  });

  setupToolbar();
  setupResizer();
}

async function spawnShell() {
  try {
    const cols = term?.cols || 80;
    const rows = term?.rows || 24;
    const workspaceRoot = State.workspaceRoot || null;
    const { id, error } = await window.agzos.term.create(cols, rows, { cwd: workspaceRoot });
    if (error) {
      toast(`Aviso do terminal: ${error}`, 'error');
    }
    termId = id;
    State.term = { id, term, fitAddon };
    term.focus();
  } catch (e) {
    toast(`Não foi possível iniciar o terminal: ${e.message}`, 'error');
  }
}

export function clearTerminal() {
  if (term) {
    term.clear();
    term.focus();
  }
}

export async function restartTerminal() {
  if (termId) {
    try { await window.agzos.term.kill(termId); } catch {}
    termId = null;
  }
  if (term) {
    term.clear();
    term.write('\x1b[33mReiniciando terminal…\x1b[0m\r\n');
  }
  await spawnShell();
}

export function toggleTerminalPosition(targetPos) {
  const nextPos = targetPos || (currentPosition === 'bottom' ? 'right' : 'bottom');
  currentPosition = nextPos;

  const workbench = document.getElementById('workbench-body');
  const btnPos = document.getElementById('btn-pos-terminal');

  if (workbench) {
    if (nextPos === 'right') {
      workbench.classList.add('panel-right');
      workbench.classList.remove('panel-bottom');
      if (btnPos) {
        btnPos.innerHTML = lucideIcon('panel-bottom', { size: 14 }).outerHTML;
        btnPos.title = 'Mover Terminal para Baixo';
      }
    } else {
      workbench.classList.add('panel-bottom');
      workbench.classList.remove('panel-right');
      if (btnPos) {
        btnPos.innerHTML = lucideIcon('panel-right', { size: 14 }).outerHTML;
        btnPos.title = 'Mover Terminal para a Direita';
      }
    }
  }

  setTimeout(() => {
    if (fitAddon) try { fitAddon.fit(); } catch {}
  }, 100);
}

export function toggleTerminalMaximize() {
  isMaximized = !isMaximized;
  const workbench = document.getElementById('workbench-body');
  const btnMax = document.getElementById('btn-maximize-bottom');

  if (workbench) {
    workbench.classList.toggle('panel-maximized', isMaximized);
  }

  if (btnMax) {
    btnMax.innerHTML = lucideIcon(isMaximized ? 'minimize-2' : 'maximize-2', { size: 14 }).outerHTML;
    btnMax.title = isMaximized ? 'Restaurar Tamanho' : 'Maximizar Terminal';
  }

  setTimeout(() => {
    if (fitAddon) try { fitAddon.fit(); } catch {}
  }, 100);
}

export function toggleTerminal() {
  const panel = document.getElementById('bottom-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
  State.bottomHidden = panel.hidden;

  const resizer = document.getElementById('panel-resizer');
  if (resizer) resizer.hidden = panel.hidden;

  if (!panel.hidden) {
    setTimeout(() => {
      if (fitAddon) try { fitAddon.fit(); } catch {}
      if (term) term.focus();
    }, 60);
  }
}

export function focusTerminal() {
  const panel = document.getElementById('bottom-panel');
  if (!panel) return;
  panel.hidden = false;
  State.bottomHidden = false;

  const resizer = document.getElementById('panel-resizer');
  if (resizer) resizer.hidden = false;

  setTimeout(() => {
    if (fitAddon) try { fitAddon.fit(); } catch {}
    if (term) term.focus();
  }, 60);
}

export function applyTerminalFontSize(size) {
  if (term && Number.isFinite(size) && size > 8 && size < 36) {
    term.options.fontSize = size;
    if (fitAddon) try { fitAddon.fit(); } catch {}
  }
}

function setupToolbar() {
  const btnClear = document.getElementById('btn-clear-terminal');
  if (btnClear) btnClear.addEventListener('click', clearTerminal);

  const btnRestart = document.getElementById('btn-restart-terminal');
  if (btnRestart) btnRestart.addEventListener('click', restartTerminal);

  const btnPos = document.getElementById('btn-pos-terminal');
  if (btnPos) btnPos.addEventListener('click', () => toggleTerminalPosition());

  const btnMax = document.getElementById('btn-maximize-bottom');
  if (btnMax) btnMax.addEventListener('click', toggleTerminalMaximize);

  const btnClose = document.getElementById('btn-close-bottom');
  if (btnClose) btnClose.addEventListener('click', toggleTerminal);

  // Tabs do painel (TERMINAL, OUTPUT, PROBLEMAS)
  document.querySelectorAll('.bottom-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bottom-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.bottom-pane').forEach((p) => p.classList.remove('active'));

      tab.classList.add('active');
      const pane = document.getElementById(`pane-${tab.dataset.tab}`);
      if (pane) pane.classList.add('active');

      if (tab.dataset.tab === 'terminal') {
        setTimeout(() => {
          if (fitAddon) try { fitAddon.fit(); } catch {}
          if (term) term.focus();
        }, 50);
      }
    });
  });
}

function setupResizer() {
  const resizer = document.getElementById('panel-resizer');
  const panel = document.getElementById('bottom-panel');
  const workbench = document.getElementById('workbench-body');
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
      const newHeight = Math.max(100, Math.min(window.innerHeight * 0.75, startHeight + deltaY));
      panel.style.height = `${newHeight}px`;
    } else {
      const deltaX = startX - e.clientX;
      const newWidth = Math.max(220, Math.min(window.innerWidth * 0.7, startWidth + deltaX));
      panel.style.width = `${newWidth}px`;
    }

    if (fitAddon) {
      try { fitAddon.fit(); } catch {}
    }
  });

  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.classList.remove('resizing');
      if (fitAddon) {
        try { fitAddon.fit(); } catch {}
      }
    }
  });
}
