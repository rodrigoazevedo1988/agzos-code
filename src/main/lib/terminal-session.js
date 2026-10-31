/**
 * Agzos Code — sessão de terminal.
 *
 * Usa node-pty (pty real) quando disponível e cai para pipes quando não:
 *  - sem pty, o shell não ecoa o que você digita, `cls`/`clear` não emitem a
 *    sequência de limpeza (o PowerShell não detecta um terminal de verdade),
 *    não há cores, tab-completion nem Ctrl+C;
 *  - o fallback existe para builds sem o módulo nativo e para ambientes que
 *    bloqueiam `/dev/ptmx`, onde o terminal continua utilizável (degradado).
 *
 * Sem dependência do Electron: recebe loader do pty e spawner por parâmetro,
 * o que permite testar os dois modos sem pty de verdade.
 */

const os = require('os');
const { spawn } = require('child_process');

/** Shell padrão por plataforma. No Windows, PowerShell (não o SHELL do Git Bash). */
function resolveShell(platform, env) {
  if (env?.AGZOS_TERM_SHELL) return env.AGZOS_TERM_SHELL;
  if (platform === 'win32') return 'powershell.exe';
  return env?.SHELL || 'bash';
}

/**
 * Argumentos do shell.
 *
 * `-i` (interativo) só faz sentido com pty: sem um terminal de verdade o shell
 * tenta gravar histórico/sessão (e falha) além de misturar prompt e saída na
 * mesma linha. No modo pipe o shell fica não-interativo, lendo comandos do
 * stdin, como antes de existir pty.
 */
function resolveShellArgs(shell, { interactive = true } = {}) {
  const base = String(shell).toLowerCase();
  if (base.endsWith('powershell.exe') || base.endsWith('pwsh.exe') || base.endsWith('pwsh')) {
    return ['-NoLogo'];
  }
  if (base.endsWith('cmd.exe')) return [];
  return interactive ? ['-i'] : [];
}

/**
 * Sem pty, o shell não traduz CR em NL (Enter não funciona). Com pty o próprio
 * terminal cuida disso — normalizar ali quebraria atalhos como Ctrl+C.
 */
function normalizePipeInput(data) {
  return String(data).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** Carrega node-pty; qualquer falha (build sem binário) devolve null. */
function defaultPtyLoader() {
  try {
    const pty = require('node-pty');
    return typeof pty?.spawn === 'function' ? pty : null;
  } catch {
    return null;
  }
}

/**
 * Cria uma sessão de terminal.
 *
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} [opts.platform]
 * @param {object} [opts.env]
 * @param {string} [opts.cwd]
 * @param {number} [opts.cols]
 * @param {number} [opts.rows]
 * @param {Function} [opts.ptyLoader] devolve módulo pty ou null
 * @param {Function} [opts.pipeSpawn] assinatura igual à de child_process.spawn
 * @param {Function} [opts.onData] (chunk: string) => void
 * @param {Function} [opts.onExit] (code: number|null) => void
 */
function createTerminalSession(opts = {}) {
  const {
    id,
    platform = process.platform,
    env = process.env,
    cwd = os.homedir(),
    cols = 80,
    rows = 24,
    ptyLoader = defaultPtyLoader,
    pipeSpawn = spawn,
    onData = () => {},
    onExit = () => {},
  } = opts;

  const shell = resolveShell(platform, env);
  const ptyArgs = resolveShellArgs(shell, { interactive: true });
  const pipeArgs = resolveShellArgs(shell, { interactive: false });
  const termEnv = { ...env, TERM: 'xterm-256color' };

  let mode = 'pipe';
  let ptyProc = null;
  let proc = null;
  let pid = null;
  let fallbackReason = '';

  const pty = ptyLoader();
  if (pty) {
    try {
      ptyProc = pty.spawn(shell, ptyArgs, {
        name: 'xterm-256color',
        cols: Math.max(1, cols | 0),
        rows: Math.max(1, rows | 0),
        cwd,
        env: termEnv,
      });
      mode = 'pty';
      pid = ptyProc.pid ?? null;
      ptyProc.onData((data) => onData(data));
      ptyProc.onExit(({ exitCode }) => onExit(exitCode ?? null));
    } catch (e) {
      // pty indisponível neste ambiente (ex.: /dev/ptmx bloqueado)
      fallbackReason = e.message;
      ptyProc = null;
      mode = 'pipe';
    }
  } else {
    fallbackReason = 'node-pty não carregou';
  }

  if (mode === 'pipe') {
    proc = pipeSpawn(shell, pipeArgs, { cwd, env: termEnv, shell: false });
    pid = proc.pid ?? null;
    proc.on('error', (err) => {
      onData(`\r\n[Falha ao iniciar ${shell}: ${err.message}]\r\n`);
    });
    proc.stdout?.on('data', (data) => onData(data.toString()));
    proc.stderr?.on('data', (data) => onData(data.toString()));
    proc.on('exit', (code) => onExit(code ?? null));
  }

  return {
    id,
    shell,
    cwd,
    pid,
    get mode() { return mode; },
    get usesPty() { return mode === 'pty'; },
    get fallbackReason() { return fallbackReason; },

    write(data) {
      try {
        if (mode === 'pty') {
          ptyProc.write(String(data));
        } else if (proc?.stdin?.writable) {
          proc.stdin.write(normalizePipeInput(data));
        } else {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },

    resize(nextCols, nextRows) {
      if (mode !== 'pty') return false; // pipes não têm tamanho
      const c = Math.max(1, nextCols | 0);
      const r = Math.max(1, nextRows | 0);
      try {
        ptyProc.resize(c, r);
        return true;
      } catch {
        return false;
      }
    },

    kill() {
      try {
        if (mode === 'pty') ptyProc.kill();
        else proc?.kill();
      } catch {}
    },
  };
}

module.exports = {
  createTerminalSession,
  resolveShell,
  resolveShellArgs,
  normalizePipeInput,
  defaultPtyLoader,
};
