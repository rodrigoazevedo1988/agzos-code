/**
 * Terminal — xterm.js + IPC com o shell do sistema (bash/powershell).
 *
 * Carrega xterm como UMD via <script> injetado em runtime
 * (CSP não permite file:// imports diretos de node_modules).
 *
 * Importante: o Monaco instala um `define` AMD global. O UMD do xterm chama
 * `define([], factory)` e o loader do Monaco quebra com "Can only have one
 * anonymous define call per script file". Desativamos o `define` só durante
 * o carregamento dos scripts do xterm e restauramos depois.
 */

import { toast } from './toast.js';

const State = window.AgzosState;

let term = null;
let fitAddon = null;
let termId = null;
let xtermLoaded = null;

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`Falha ao carregar ${href}`));
    document.head.appendChild(link);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

async function loadXterm() {
  if (xtermLoaded) return xtermLoaded;

  xtermLoaded = (async () => {
    await loadStylesheet('vendor/xterm/xterm.css');

    const amdDefine = window.define;
    window.define = undefined;
    try {
      await loadScript('vendor/xterm/xterm.js');
      await loadScript('vendor/xterm/addon/fit.js');
    } finally {
      window.define = amdDefine;
    }

    if (!window.Terminal || !window.FitAddon) {
      throw new Error('xterm.js carregou, mas Terminal/FitAddon não estão disponíveis.');
    }
  })();

  return xtermLoaded;
}

export async function initTerminal() {
  if (term) {
    if (fitAddon) { try { fitAddon.fit(); } catch {} }
    term.focus();
    return;
  }

  try {
    await loadXterm();
  } catch (e) {
    toast(`Terminal indisponível: ${e.message}`, 'error', 6000);
    return;
  }

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
      syncPtySize();
    }
  });

  window.agzos.term.onData((id, data) => {
    if (id === termId) term.write(data);
  });
  window.agzos.term.onExit((id, code) => {
    if (id === termId) {
      term.write(`\r\n\x1b[31m[Processo encerrou com código ${code}]\x1b[0m\r\n`);
    }
  });
}

/**
 * Com pty real, o tamanho importa: é ele que faz o shell quebrar linhas e
 * desenhar o prompt corretamente. Sem pty (modo degradado) o handler devolve
 * false e não há nada a fazer.
 */
function syncPtySize() {
  if (!termId || !term) return;
  try {
    window.agzos.term.resize(termId, term.cols, term.rows);
  } catch {}
}

async function spawnShell() {
  try {
    const cols = term.cols || 80;
    const rows = term.rows || 24;
    const { id, mode } = await window.agzos.term.create(cols, rows);
    termId = id;
    State.term = { id, term, fitAddon, mode };
    if (mode === 'pty') {
      syncPtySize();
    } else {
      // Sem pty: avisa uma vez, no próprio terminal, que o modo é reduzido.
      term.write(
        '\x1b[33m[Modo reduzido: pty indisponível — sem eco de digitação, ' +
        'cores ou cls. O shell ainda funciona.]\x1b[0m\r\n',
      );
    }
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
