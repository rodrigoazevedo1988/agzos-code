/**
 * run_command do agente: executa um comando no shell do perfil padrão
 * (pwsh/powershell no Windows, $SHELL/bash no POSIX), sem stdin, com saída
 * ao vivo, timeout e kill da árvore de processos no cancelamento.
 */

const { spawn, execFile } = require('child_process');
const path = require('path');
const winEnv = require('../lib/win-env');

function shellBase(p) {
  return String(p || '').split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
}

const POSIX_OK = ['bash', 'zsh', 'sh', 'dash', 'ksh'];

/** Escolhe o shell do agente a partir dos perfis detectados do terminal. */
function pickShell({ platform = process.platform, env = process.env, detected } = {}) {
  let profiles = [];
  let defaultId = null;
  try {
    const det = detected || require('../ipc/term').detectProfiles({ platform, env });
    profiles = det.profiles || [];
    defaultId = det.defaultId;
  } catch {}
  const byId = (id) => profiles.find((pr) => pr.id === id);
  if (platform === 'win32') {
    const def = byId(defaultId);
    if (def && ['pwsh', 'powershell'].includes(shellBase(def.shell))) return def.shell;
    return (byId('pwsh') || byId('powershell'))?.shell || 'powershell.exe';
  }
  const def = byId(defaultId);
  if (def && POSIX_OK.includes(shellBase(def.shell))) return def.shell;
  return byId('bash')?.shell || byId('sh')?.shell || '/bin/sh';
}

/** Argumentos para rodar um comando único no shell. */
function commandArgs(shell, command, platform = process.platform) {
  const name = shellBase(shell);
  if (name === 'pwsh' || name === 'powershell') {
    const args = ['-NoLogo', '-NonInteractive'];
    if (platform === 'win32') args.push('-ExecutionPolicy', 'Bypass');
    const prefix = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ';
    return [...args, '-Command', prefix + command];
  }
  if (name === 'cmd') return ['/d', '/s', '/c', command];
  // macOS: shell de login para pegar o PATH de /etc/paths (como o terminal).
  return platform === 'darwin' ? ['-l', '-c', command] : ['-c', command];
}

function killTree(child, platform = process.platform) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  const timer = setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }, 1500);
  timer.unref?.();
}

/**
 * Executa `command` em `cwd`. onOutput(chunk) recebe stdout+stderr ao vivo.
 * → Promise<{ exitCode, output, durationMs, timedOut, cancelled }>
 */
function runCommand({
  command, cwd, timeoutMs = 120000, onOutput = () => {}, signal,
  platform = process.platform, shell, env, maxBuffer = 4 * 1024 * 1024,
}) {
  const sh = shell || pickShell({ platform });
  const baseEnv = env || winEnv.freshEnv({ platform });
  const childEnv = { ...baseEnv, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat', TERM_PROGRAM: 'agzos-code' };
  delete childEnv.ELECTRON_RUN_AS_NODE; // como no terminal (ipc/term.js)
  if (platform !== 'win32') childEnv.TERM = childEnv.TERM && childEnv.TERM !== 'dumb' ? childEnv.TERM : 'dumb';
  const started = Date.now();
  return new Promise((resolve) => {
    let output = '';
    let dropped = 0;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let child;
    const finish = (exitCode, extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      if (dropped) output = `[... ${dropped} bytes iniciais omitidos ...]\n${output}`;
      resolve({ exitCode, output: extra ? output + extra : output, durationMs: Date.now() - started, timedOut, cancelled });
    };
    const onAbort = () => { cancelled = true; killTree(child, platform); };
    const timer = setTimeout(() => { timedOut = true; killTree(child, platform); }, timeoutMs);
    try {
      child = spawn(sh, commandArgs(sh, command, platform), {
        cwd: path.resolve(cwd), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
        detached: platform !== 'win32', windowsHide: true,
      });
    } catch (err) {
      finish(-1, `Falha ao iniciar o shell: ${err.message}`);
      return;
    }
    if (signal?.aborted) onAbort();
    else signal?.addEventListener?.('abort', onAbort, { once: true });
    const onData = (buf) => {
      const text = buf.toString('utf8');
      output += text;
      if (output.length > maxBuffer) {
        dropped += output.length - maxBuffer;
        output = output.slice(output.length - maxBuffer);
      }
      try { onOutput(text); } catch {}
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => finish(-1, `\nFalha ao executar: ${err.message}`));
    child.on('close', (code, sig) => finish(code ?? (sig ? 128 : -1)));
  });
}

module.exports = { runCommand, pickShell, commandArgs, killTree };
