/**
 * Terminal — xterm.js + IPC com o shell do sistema (bash/powershell).
 *
 * Carrega xterm como UMD via <script> injetado em runtime
 * (CSP não permite file:// imports diretos de node_modules).
 */

import { toast } from './toast.js';

const State = window.AgzosState;

let term = null;
let fitAddon = null;
let termId = null;
let xtermLoaded = null;

function loadXterm() {
  if (xtermLoaded) return xtermLoaded;
  xtermLoaded = new Promise((resolve, reject) => {
    // CSS
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/xterm/xterm.css';
    css.onload = resolve;
    css.onerror = () => reject(new Error('Falha ao carregar xterm.css'));
    document.head.appendChild(css);

    // JS principal
    const s = document.createElement('script');
    s.src = 'vendor/xterm/xterm.js';
    s.onload = () => {
      // Fit addon (deve ser carregado após o xterm)
      const f = document.createElement('script');
      f.src = 'vendor/xterm/addon/fit.js';
      f.onload = resolve;
      f.onerror = () => reject(new Error('Falha ao carregar xterm fit addon'));
      document.head.appendChild(f);
    };
    s.onerror = () => reject(new Error('Falha ao carregar xterm.js'));
    document.head.appendChild(s);
  });
  return xtermLoaded;
}

export async function initTerminal() {
  await loadXterm();
  const Terminal = window.Terminal;
  const FitAddon = window.FitAddon?.FitAddon || window.FitAddon;
  if (!Terminal || !FitAddon) {
    toast('xterm.js não pôde ser carregado.', 'error');
    return;
  }

  const host = document.getElementById('terminal-host');
  host.innerHTML = '';

  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
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
      // ignore — fit em host invisível pode falhar
    }
  }, 60);

  term.onData((data) => {
    if (termId) window.agzos.term.write(termId, data);
  });

  window.addEventListener('resize', () => {
    if (fitAddon && !document.getElementById('bottom-panel').hidden) {
      try { fitAddon.fit(); } catch {}
    }
  });

  // Cleanup on exit
  window.agzos.term.onData((id, data) => {
    if (id === termId) term.write(data);
  });
  window.agzos.term.onExit((id, code) => {
    if (id === termId) {
      term.write(`\r\n\x1b[31m[Processo encerrou com código ${code}]\x1b[0m\r\n`);
    }
  });
}

async function spawnShell() {
  try {
    const cols = term.cols || 80;
    const rows = term.rows || 24;
    const { id } = await window.agzos.term.create(cols, rows);
    termId = id;
    State.term = { id, term, fitAddon };
    term.focus();
  } catch (e) {
    toast(`Não foi possível iniciar o terminal: ${e.message}`, 'error');
  }
}

export function toggleTerminal() {
  const panel = document.getElementById('bottom-panel');
  panel.hidden = !panel.hidden;
  State.bottomHidden = panel.hidden;
  if (!panel.hidden) {
    setTimeout(() => {
      if (fitAddon) try { fitAddon.fit(); } catch {}
      if (term) term.focus();
    }, 60);
  }
}

export function focusTerminal() {
  const panel = document.getElementById('bottom-panel');
  panel.hidden = false;
  State.bottomHidden = false;
  setTimeout(() => {
    if (fitAddon) try { fitAddon.fit(); } catch {}
    if (term) term.focus();
  }, 60);
}
