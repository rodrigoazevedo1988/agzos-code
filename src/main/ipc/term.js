/**
 * IPC: terminal (term:*).
 *
 * Modo preferido: node-pty (ConPTY no Windows, forkpty no Linux/macOS), com
 * prompt, eco, cores, Ctrl+C e resize de verdade.
 *
 * Fallback (node-pty ausente/quebrado, ou AGZOS_TERM_NO_PTY=1): shell com
 * pipes + disciplina de linha no main (eco local, backspace, Enter, Ctrl+C,
 * Ctrl+U, Ctrl+D), para o terminal continuar usável sem binário nativo.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const winEnv = require('../lib/win-env');
const { buildSshArgs } = require('../lib/ssh-config');

const IS_WIN = process.platform === 'win32';

// Shells permitidos (basename sem .exe, minúsculo). O renderer não pode mandar
// um executável arbitrário para o main spawnar.
const SHELL_ALLOWLIST = ['powershell', 'pwsh', 'cmd', 'bash', 'zsh', 'sh', 'fish', 'dash', 'wsl'];
// Cliente SSH: separado dos shells. Só sobe por `opts.ssh`, com argumentos
// montados no main (buildSshArgs) a partir de alias/alvo validados.
const SSH_ALLOWLIST = ['ssh'];

// --- node-pty (carregamento preguiçoso e tolerante a falha) -----------------

let ptyModule; // undefined = não tentado; null = indisponível
let ptyLoadError = null;

function loadPty() {
  if (ptyModule !== undefined) return ptyModule;
  if (process.env.AGZOS_TERM_NO_PTY === '1') {
    ptyModule = null;
    ptyLoadError = 'desativado por AGZOS_TERM_NO_PTY';
    return ptyModule;
  }
  try {
    // Empacotado: node-pty fica em app.asar.unpacked (asarUnpack). Carregar
    // pelo caminho real faz o worker do ConPTY, o spawn-helper e os .node
    // resolverem fora do asar.
    let entry = require.resolve('node-pty');
    const asarSeg = `app.asar${path.sep}`;
    if (entry.includes(asarSeg)) {
      entry = entry.replace(asarSeg, `app.asar.unpacked${path.sep}`);
    }
    ptyModule = require(entry);
  } catch (err) {
    ptyModule = null;
    ptyLoadError = err && err.message ? err.message : String(err);
  }
  return ptyModule;
}

// --- Resolução do shell ------------------------------------------------------

function shellName(shellPath) {
  // Aceita separadores dos dois sistemas (caminho do Windows testado no Linux).
  const base = String(shellPath || '').split(/[\\/]/).pop();
  return base.toLowerCase().replace(/\.exe$/, '');
}

function defaultShell(platform = process.platform, env = process.env) {
  if (platform === 'win32') return 'powershell.exe';
  return env.SHELL || '/bin/bash';
}

/**
 * Valida o shell pedido pelo renderer. Aceita nome simples da allowlist
 * (resolvido pelo PATH) ou caminho absoluto existente cujo nome esteja na
 * allowlist ou seja o shell padrão do ambiente. Qualquer outra coisa cai no
 * padrão e devolve `rejected`.
 */
function resolveShell(requested, { platform = process.platform, env = process.env, exists = fs.existsSync, trusted = [] } = {}) {
  const fallback = defaultShell(platform, env);
  if (requested == null || requested === '') return { shell: fallback, rejected: null };
  if (typeof requested !== 'string' || requested.length > 1024 || /[\0\r\n]/.test(requested)) {
    return { shell: fallback, rejected: String(requested).slice(0, 80) };
  }
  const name = shellName(requested);
  const envDefault = platform === 'win32' ? env.ComSpec : env.SHELL;
  const isEnvDefault = !!envDefault && requested === envDefault;
  const allowedName = SHELL_ALLOWLIST.includes(name);
  const hasSep = /[\\/]/.test(requested);
  if (!hasSep) {
    // Nome simples: só da allowlist (vai pelo PATH).
    return allowedName ? { shell: requested, rejected: null } : { shell: fallback, rejected: requested };
  }
  const absolute = platform === 'win32' ? path.win32.isAbsolute(requested) : path.posix.isAbsolute(requested);
  // Caminhos absolutos achados pela detecção de perfis (feita no main) são
  // confiáveis: o renderer só escolhe entre eles, não injeta caminho novo.
  const isTrusted = Array.isArray(trusted) && trusted.some((t) => samePath(t, requested, platform));
  if (absolute && (allowedName || isEnvDefault || isTrusted) && exists(requested)) {
    return { shell: requested, rejected: null };
  }
  return { shell: fallback, rejected: requested };
}

function samePath(a, b, platform = process.platform) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

// --- Perfis de terminal (shells instalados) ---------------------------------

const PROFILE_ICONS = {
  pwsh: 'powershell', powershell: 'powershell', cmd: 'cmd', gitbash: 'bash', wsl: 'wsl',
  bash: 'bash', zsh: 'terminal', fish: 'terminal', sh: 'terminal', 'default-shell': 'terminal',
};

/** Lê variável de ambiente; no Windows o nome não diferencia maiúsculas. */
function getEnv(env, name, platform) {
  if (!env) return undefined;
  if (env[name] != null) return env[name];
  if (platform !== 'win32') return undefined;
  const lower = name.toLowerCase();
  for (const k of Object.keys(env)) if (k.toLowerCase() === lower) return env[k];
  return undefined;
}

/** Procura um executável nos diretórios do PATH. */
function findInPath(file, { platform, env, exists }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = String(getEnv(env, 'PATH', platform) || '').split(platform === 'win32' ? ';' : ':');
  for (const raw of dirs) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !p.isAbsolute(dir)) continue;
    const full = p.join(dir, file);
    try { if (exists(full)) return full; } catch {}
  }
  return null;
}

function firstExisting(candidates, exists) {
  for (const c of candidates) {
    if (!c) continue;
    try { if (exists(c)) return c; } catch {}
  }
  return null;
}

/**
 * Detecta os shells instalados. Injetável para teste (platform/env/exists).
 * Retorna { profiles: [{ id, label, shell, args, icon }], defaultId }.
 */
function detectProfiles({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const profiles = [];
  const add = (id, label, shell, args = []) => {
    if (!shell || profiles.some((pr) => pr.id === id)) return;
    profiles.push({ id, label, shell, args, icon: PROFILE_ICONS[id] || 'terminal' });
  };

  if (platform === 'win32') {
    const w = path.win32;
    const sysRoot = getEnv(env, 'SystemRoot', platform) || getEnv(env, 'windir', platform) || 'C:\\Windows';
    const progFiles = getEnv(env, 'ProgramFiles', platform) || 'C:\\Program Files';
    const progFiles86 = getEnv(env, 'ProgramFiles(x86)', platform);
    const localAppData = getEnv(env, 'LocalAppData', platform);
    const ctx = { platform, env, exists };

    add('pwsh', 'PowerShell', findInPath('pwsh.exe', ctx)
      || firstExisting([w.join(progFiles, 'PowerShell', '7', 'pwsh.exe')], exists));
    add('powershell', 'Windows PowerShell',
      firstExisting([w.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')], exists)
      || findInPath('powershell.exe', ctx));
    add('cmd', 'Command Prompt',
      firstExisting([getEnv(env, 'ComSpec', platform), w.join(sysRoot, 'System32', 'cmd.exe')], exists));
    add('gitbash', 'Git Bash', firstExisting([
      w.join(progFiles, 'Git', 'bin', 'bash.exe'),
      progFiles86 && w.join(progFiles86, 'Git', 'bin', 'bash.exe'),
      localAppData && w.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'),
    ], exists), ['--login', '-i']);
    add('wsl', 'WSL', firstExisting([w.join(sysRoot, 'System32', 'wsl.exe')], exists));

    // Nada detectado (ambiente estranho): mantém o comportamento antigo.
    if (!profiles.length) add('powershell', 'Windows PowerShell', 'powershell.exe');
    const defaultId = profiles.some((pr) => pr.id === 'pwsh') ? 'pwsh' : profiles[0].id;
    return { profiles, defaultId };
  }

  // POSIX
  const ctx = { platform, env, exists };
  const envShell = getEnv(env, 'SHELL', platform);
  const envShellOk = typeof envShell === 'string' && path.posix.isAbsolute(envShell)
    && (() => { try { return exists(envShell); } catch { return false; } })();
  const envName = envShellOk ? shellName(envShell) : null;
  const names = ['bash', 'zsh', 'fish', 'sh'];
  let defaultId = null;

  if (envShellOk && !names.includes(envName)) {
    add('default-shell', path.posix.basename(envShell), envShell);
    defaultId = 'default-shell';
  }
  for (const name of names) {
    const shell = envName === name
      ? envShell
      : (findInPath(name, ctx) || firstExisting([`/bin/${name}`, `/usr/bin/${name}`, `/usr/local/bin/${name}`], exists));
    add(name, name, shell);
    if (envName === name) defaultId = name;
  }
  if (!profiles.length) add('sh', 'sh', envShell || '/bin/sh');
  if (!defaultId) defaultId = profiles.some((pr) => pr.id === 'bash') ? 'bash' : profiles[0].id;
  return { profiles, defaultId };
}

// --- SSH --------------------------------------------------------------------

/** Caminho do cliente `ssh` do sistema, ou null. */
function findSsh({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  const ctx = { platform, env, exists };
  let found;
  if (platform === 'win32') {
    const sysRoot = getEnv(env, 'SystemRoot', platform) || getEnv(env, 'windir', platform) || 'C:\\Windows';
    found = firstExisting([path.win32.join(sysRoot, 'System32', 'OpenSSH', 'ssh.exe')], exists)
      || findInPath('ssh.exe', ctx);
  } else {
    found = findInPath('ssh', ctx)
      || firstExisting(['/usr/bin/ssh', '/usr/local/bin/ssh', '/opt/homebrew/bin/ssh', '/bin/ssh'], exists);
  }
  return found && SSH_ALLOWLIST.includes(shellName(found)) ? found : null;
}

function sshMissingMessage(platform = process.platform) {
  if (platform === 'win32') {
    return 'Cliente SSH não encontrado. Instale o recurso opcional "Cliente OpenSSH" '
      + '(Configurações > Sistema > Recursos opcionais > Adicionar recurso) e tente de novo.';
  }
  if (platform === 'darwin') return 'Cliente SSH não encontrado. Instale o OpenSSH (ex.: brew install openssh) e tente de novo.';
  return 'Cliente SSH não encontrado. Instale o pacote openssh-client (ex.: sudo apt install openssh-client) e tente de novo.';
}

/**
 * Sessão SSH a partir de `opts.ssh` ({ alias } | { user?, host, port? }).
 * Só os campos conhecidos são lidos; nada do renderer vira argumento sem
 * validação. → { shell, args, label, profileId } | { error, code }
 */
function resolveSshLaunch(target, { platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return { error: 'Alvo SSH inválido.', code: 'ssh-invalid' };
  const clean = target.alias != null
    ? { alias: target.alias }
    : { user: target.user ?? null, host: target.host, port: target.port ?? null };
  let args;
  try { args = buildSshArgs(clean); } catch (err) { return { error: err.message, code: 'ssh-invalid' }; }
  const shell = findSsh({ platform, env, exists });
  if (!shell) return { error: sshMissingMessage(platform), code: 'ssh-missing' };
  const name = clean.alias != null ? clean.alias : clean.host;
  return { shell, args, label: `SSH: ${name}`, profileId: 'ssh' };
}

/** Perfis para o renderer: shells detectados + "SSH…" (abre o seletor de hosts). */
function listProfiles(ctx = {}) {
  const { profiles, defaultId } = detectProfiles(ctx);
  return {
    profiles: [...profiles, { id: 'ssh', label: 'SSH…', shell: '', args: [], icon: 'remote', picker: true }],
    defaultId,
  };
}

/** Argumentos de um perfil conforme o modo (pty/pipe). */
function profileArgs(profile, mode, platform = process.platform) {
  if (profile.id === 'ssh') return Array.isArray(profile.args) ? [...profile.args] : [];
  if (profile.id === 'wsl') return [];
  if (profile.id === 'gitbash') return mode === 'pty' ? ['--login', '-i'] : ['--login', '--noediting', '-i'];
  return shellArgs(profile.shell, mode, platform);
}

/**
 * Decide o shell da sessão a partir das opções do renderer.
 * - profileId: perfil detectado (id desconhecido cai no padrão com aviso).
 * - shell: compatibilidade (validado pela allowlist / caminhos detectados).
 * - nada: perfil padrão.
 */
function resolveLaunch(opts = {}, { platform = process.platform, env = process.env, exists = fs.existsSync, detected } = {}) {
  const { profiles, defaultId } = detected || detectProfiles({ platform, env, exists });
  const byId = (id) => profiles.find((pr) => pr.id === id) || null;
  const def = byId(defaultId);
  const warnings = [];
  const fromProfile = (pr) => ({ shell: pr.shell, profile: pr, profileId: pr.id, label: pr.label });

  if (opts.ssh != null) {
    const r = resolveSshLaunch(opts.ssh, { platform, env, exists });
    if (r.error) return { error: r.error, code: r.code, warnings };
    return {
      shell: r.shell, profile: { id: 'ssh', shell: r.shell, args: r.args }, profileId: 'ssh',
      label: r.label, sshArgs: r.args, warnings,
    };
  }

  if (opts.profileId != null && opts.profileId !== '') {
    const pr = typeof opts.profileId === 'string' ? byId(opts.profileId) : null;
    if (pr) return { ...fromProfile(pr), warnings };
    if (def) {
      warnings.push(`Perfil de terminal não encontrado (${String(opts.profileId).slice(0, 40)}); usando ${def.label}.`);
      return { ...fromProfile(def), warnings };
    }
  }

  if (opts.shell != null && opts.shell !== '') {
    const { shell, rejected } = resolveShell(opts.shell, { platform, env, exists, trusted: profiles.map((pr) => pr.shell) });
    if (rejected) {
      if (def) {
        warnings.push(`Shell não permitido (${rejected}); usando ${def.shell}.`);
        return { ...fromProfile(def), warnings };
      }
      warnings.push(`Shell não permitido (${rejected}); usando ${shell}.`);
    }
    const match = profiles.find((pr) => samePath(pr.shell, shell, platform))
      || profiles.find((pr) => pr.id === shellName(shell));
    if (match && samePath(match.shell, shell, platform)) return { ...fromProfile(match), warnings };
    const name = shellName(shell);
    return {
      shell,
      profile: { id: match ? match.id : null, shell, args: null },
      profileId: match ? match.id : null,
      label: match ? match.label : name,
      warnings,
    };
  }

  if (def) return { ...fromProfile(def), warnings };
  const shell = defaultShell(platform, env);
  return { shell, profile: { id: null, shell, args: null }, profileId: null, label: shellName(shell), warnings };
}

/** Argumentos do shell conforme o modo. */
function shellArgs(shellPath, mode, platform = process.platform) {
  const name = shellName(shellPath);
  if (name === 'powershell' || name === 'pwsh') {
    const base = ['-NoLogo', '-ExecutionPolicy', 'Bypass'];
    if (name === 'pwsh' && platform !== 'win32') base.splice(1, 2); // ExecutionPolicy só existe no Windows
    // Sem console, `-Command -` faz o PowerShell ler comandos do stdin.
    return mode === 'pty' ? base : [...base, '-NoExit', '-Command', '-'];
  }
  if (name === 'cmd') return [];
  if (mode === 'pty') {
    // macOS abre shells de login (PATH do /etc/paths); Linux não precisa.
    return platform === 'darwin' && ['bash', 'zsh', 'fish', 'sh'].includes(name) ? ['-l'] : [];
  }
  // Pipes: força modo interativo (prompt vai para o stderr). No bash,
  // --noediting desliga o readline, que senão ecoa a linha de novo.
  if (name === 'bash') return ['--noediting', '-i'];
  return ['-i'];
}

function resolveCwd(requested) {
  const home = os.homedir();
  if (typeof requested !== 'string' || !requested) return home;
  try {
    if (path.isAbsolute(requested) && fs.statSync(requested).isDirectory()) return requested;
  } catch {}
  return home;
}

function clampDim(value, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 1000);
}

// --- Disciplina de linha (modo pipe) -----------------------------------------

/**
 * Emula o "cooked mode" de um tty para shells em pipes.
 * - echo(text): o que mostrar no xterm
 * - submit(line): linha completa para o stdin (já com fim de linha)
 * - interrupt(): Ctrl+C
 * - eof(): Ctrl+D com linha vazia
 */
function createLineDiscipline({ echo, submit, interrupt = () => {}, eof = () => {}, eol = '\n' }) {
  let buffer = '';
  let lastWasCR = false;
  let inEscape = false;

  function eraseChars(count) {
    if (count > 0) echo('\b \b'.repeat(count));
  }

  function feed(data) {
    const chars = Array.from(String(data));
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (inEscape) {
        // Sequências CSI/SS3 (setas, F-keys): descarta até o byte final.
        if (/[@-~]/.test(ch) && ch !== '[' && ch !== 'O') inEscape = false;
        continue;
      }
      if (ch === '\n' && lastWasCR) { lastWasCR = false; continue; } // \r\n de paste
      lastWasCR = false;
      switch (ch) {
        case '\r':
        case '\n':
          lastWasCR = ch === '\r';
          echo('\r\n');
          submit(buffer + eol);
          buffer = '';
          break;
        case '\x7f':
        case '\b': {
          if (buffer) {
            const arr = Array.from(buffer);
            arr.pop();
            buffer = arr.join('');
            eraseChars(1);
          }
          break;
        }
        case '\x03':
          echo('^C\r\n');
          buffer = '';
          interrupt();
          break;
        case '\x04':
          if (!buffer) eof();
          break;
        case '\x15': // Ctrl+U
          eraseChars(Array.from(buffer).length);
          buffer = '';
          break;
        case '\x1b':
          inEscape = true;
          break;
        case '\t':
          buffer += ch;
          echo(ch);
          break;
        default:
          if (ch < ' ') break; // outros controles: ignora
          buffer += ch;
          echo(ch);
      }
    }
  }

  return { feed, get buffer() { return buffer; } };
}

// --- Encerramento da árvore de processos ------------------------------------

function killTree(pid, signal = 'SIGKILL') {
  if (!pid) return;
  if (IS_WIN) {
    try {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
    } catch {}
    return;
  }
  try { process.kill(-pid, signal); } catch {
    try { process.kill(pid, signal); } catch {}
  }
}

// Ctrl+C no modo pipe: interrompe o que roda em primeiro plano, não o shell.
function interruptForeground(pid) {
  if (!pid) return;
  if (IS_WIN) {
    // Sem console não há CTRL_C_EVENT: mata os filhos do shell (best effort).
    const ps = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${Number(pid)}" | ForEach-Object { $_.ProcessId }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err, stdout) => {
      if (err) return;
      for (const child of String(stdout).split(/\s+/).filter(Boolean)) killTree(Number(child));
    });
    return;
  }
  // O shell é líder do grupo (detached) e ignora SIGINT quando interativo.
  try { process.kill(-pid, 'SIGINT'); } catch {}
}

// --- Sessões ----------------------------------------------------------------

// Sessões vivas por id: { kind, proc|pty, ownerId, write, resize, kill }.
const sessions = new Map();
const watchedSenders = new Set();

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try { s.kill(); } catch {}
}

function killAll() {
  for (const id of [...sessions.keys()]) killSession(id);
}

function killOwnedBy(ownerId) {
  for (const [id, s] of sessions) if (s.ownerId === ownerId) killSession(id);
}

function watchSender(sender) {
  const ownerId = sender.id;
  if (watchedSenders.has(ownerId)) return;
  watchedSenders.add(ownerId);
  const cleanup = () => killOwnedBy(ownerId);
  sender.once('destroyed', () => { cleanup(); watchedSenders.delete(ownerId); });
  sender.on('render-process-gone', cleanup);
  // Reload/navegação do frame principal: o renderer novo cria outro terminal.
  sender.on('did-navigate', cleanup);
}

function ownedSession(evt, id) {
  const s = sessions.get(id);
  if (!s || s.ownerId !== evt.sender.id) return null;
  return s;
}

function createPtySession(pty, { id, shell, args, cwd, env, cols, rows, send }) {
  const proc = pty.spawn(shell, args, { name: 'xterm-256color', cols, rows, cwd, env, useConpty: true });
  proc.onData((data) => send('term:data', id, data));
  proc.onExit(({ exitCode }) => {
    if (sessions.has(id)) sessions.delete(id);
    send('term:exit', id, exitCode);
  });
  return {
    kind: 'pty',
    pid: proc.pid,
    write: (data) => proc.write(data),
    resize: (c, r) => proc.resize(c, r),
    kill: () => {
      if (IS_WIN) {
        killTree(proc.pid);
        try { proc.kill(); } catch {}
      } else {
        // forkpty faz do shell líder de sessão/grupo: derruba o grupo todo.
        killTree(proc.pid, 'SIGHUP');
        try { proc.kill(); } catch {}
        const t = setTimeout(() => killTree(proc.pid, 'SIGKILL'), 500);
        if (t.unref) t.unref();
      }
    },
  };
}

function createPipeSession({ id, shell, args, cwd, env, send }) {
  const proc = spawn(shell, args, {
    cwd,
    env: { ...env, TERM: 'dumb' },
    shell: false,
    detached: !IS_WIN, // grupo próprio para kill(-pid) e Ctrl+C
    windowsHide: true,
  });
  const eol = IS_WIN ? '\r\n' : '\n';
  const toTerm = (data) => String(data).replace(/\r?\n/g, '\r\n');

  const writeStdin = (text) => {
    const stdin = proc.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return;
    try { stdin.write(text); } catch {}
  };

  const discipline = createLineDiscipline({
    echo: (text) => send('term:data', id, text),
    submit: writeStdin,
    interrupt: () => interruptForeground(proc.pid),
    eof: () => { try { proc.stdin.end(); } catch {} },
    eol,
  });

  // EPIPE etc. no stdin não podem derrubar o main.
  if (proc.stdin) proc.stdin.on('error', () => {});
  if (proc.stdout) proc.stdout.on('data', (d) => send('term:data', id, toTerm(d)));
  if (proc.stderr) proc.stderr.on('data', (d) => send('term:data', id, toTerm(d)));

  proc.on('error', (err) => {
    send('term:data', id, `\r\n\x1b[31m[Erro no processo do terminal: ${err.message}]\x1b[0m\r\n`);
    sessions.delete(id);
  });
  proc.on('exit', (code) => {
    sessions.delete(id);
    send('term:exit', id, code);
  });

  return {
    kind: 'pipe',
    pid: proc.pid,
    write: (data) => discipline.feed(data),
    resize: () => {},
    kill: () => {
      killTree(proc.pid);
      try { proc.kill('SIGKILL'); } catch {}
    },
  };
}

function register(ipcMain) {
  // Windows: guarda o ambiente do registro para que shells novos vejam
  // variáveis alteradas/removidas depois que o app abriu (ver lib/win-env.js).
  winEnv.captureStartupEnv();

  // Área de transferência do terminal (copiar seleção / colar). Via main porque
  // o módulo clipboard não está disponível no preload com sandbox.
  ipcMain.handle('term:clipboard:read', () => {
    const { clipboard } = require('electron');
    return clipboard.readText();
  });
  ipcMain.handle('term:clipboard:write', (_evt, text) => {
    if (typeof text !== 'string' || text.length > 5 * 1024 * 1024) return false;
    const { clipboard } = require('electron');
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle('term:profiles', () => {
    const { profiles, defaultId } = listProfiles();
    return {
      profiles: profiles.map(({ id, label, shell, args, icon, picker }) => ({ id, label, shell, args, icon, ...(picker ? { picker } : {}) })),
      defaultId,
    };
  });

  ipcMain.handle('term:create', (evt, cols = 80, rows = 24, options = {}) => {
    const id = `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const opts = options && typeof options === 'object' ? options : {};
    const launch = resolveLaunch(opts);
    if (launch.error) return { error: launch.error, code: launch.code };
    const { shell, profile, profileId, label } = launch;
    const argsFor = (mode) => (profile && profile.id ? profileArgs(profile, mode) : shellArgs(shell, mode));
    const cwd = resolveCwd(opts.cwd);
    const sender = evt.sender;
    const send = (channel, ...args) => {
      if (!sender.isDestroyed()) sender.send(channel, ...args);
    };
    const env = { ...winEnv.freshEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'agzos-code' };
    delete env.ELECTRON_RUN_AS_NODE;

    const warnings = [...launch.warnings];
    // e2e: o teste confere o que foi iniciado sem depender de rede.
    const spawnArgs = (mode) => {
      const args = argsFor(mode);
      if (process.env.AGZOS_TEST === '1') global.__agzosLastSpawn = { shell, args: [...args], mode, profileId };
      return args;
    };

    const pty = loadPty();
    let session = null;
    let mode = pty ? 'pty' : 'pipe';
    if (pty) {
      try {
        session = createPtySession(pty, {
          id, shell, args: spawnArgs('pty'), cwd, env,
          cols: clampDim(cols, 80), rows: clampDim(rows, 24), send,
        });
      } catch (err) {
        warnings.push(`node-pty falhou (${err.message}); usando modo simples.`);
        mode = 'pipe';
      }
    }
    if (!session) {
      try {
        session = createPipeSession({ id, shell, args: spawnArgs('pipe'), cwd, env, send });
      } catch (err) {
        setTimeout(() => {
          send('term:data', id, `\r\n\x1b[31m[Erro ao iniciar shell ${shell}: ${err.message}]\x1b[0m\r\n`);
        }, 50);
        return { id, cwd, mode, shell, profileId, label, error: err.message };
      }
    }

    session.ownerId = sender.id;
    sessions.set(id, session);
    watchSender(sender);

    const result = { id, cwd, mode, shell, profileId, label };
    if (mode === 'pipe' && ptyLoadError && process.env.AGZOS_TERM_NO_PTY !== '1') {
      warnings.push(`Terminal em modo simples (node-pty indisponível: ${ptyLoadError}).`);
    }
    if (warnings.length) result.warning = warnings.join(' ');
    return result;
  });

  ipcMain.handle('term:write', (evt, id, data) => {
    const s = ownedSession(evt, id);
    if (!s || typeof data !== 'string') return false;
    try { s.write(data); } catch { return false; }
    return true;
  });

  ipcMain.handle('term:resize', (evt, id, cols, rows) => {
    const s = ownedSession(evt, id);
    if (!s) return false;
    try { s.resize(clampDim(cols, 80), clampDim(rows, 24)); } catch { return false; }
    return true;
  });

  ipcMain.handle('term:kill', (evt, id) => {
    if (!ownedSession(evt, id)) return false;
    killSession(id);
    return true;
  });
}

module.exports = {
  register,
  killAll,
  // exportados para testes
  resolveShell,
  shellArgs,
  detectProfiles,
  resolveLaunch,
  profileArgs,
  findSsh,
  resolveSshLaunch,
  listProfiles,
  SSH_ALLOWLIST,
  createLineDiscipline,
  SHELL_ALLOWLIST,
  _sessions: sessions,
};
