/**
 * Runner do git do sistema. Sem dependência do Electron.
 *
 * - Sempre `execFile` (sem shell) com argumentos em array.
 * - GIT_TERMINAL_PROMPT=0 e sem askpass: nunca trava esperando senha.
 * - Token do GitHub vai por variável de ambiente (GIT_CONFIG_COUNT +
 *   http.https://github.com/.extraheader), nunca por argumento (visível no `ps`)
 *   nem gravado em .git/config.
 * - Mensagens de erro passam por `redact` (URLs com credenciais nunca aparecem).
 * - Pasta remota (cwd `ssh://…`): roda `git -C <raiz> …` no host pelo provider da
 *   janela (exec com aspas POSIX). O token do GitHub NUNCA vai ao host (ficaria
 *   visível no `ps` de lá): push/pull/fetch usam as credenciais do próprio host.
 */

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = 15_000;
const REMOTE_TIMEOUT_MS = 30_000;
const REMOTE_GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', LC_ALL: 'C', LANGUAGE: 'C' };
const NETWORK_TIMEOUT_MS = 120_000;
const CLONE_TIMEOUT_MS = 30 * 60_000;
const GIT_INSTALL_URL = 'https://git-scm.com/downloads';
const GIT_MISSING_MESSAGE = 'Git não encontrado. Instale o Git e reinicie o Agzos Code.';

class GitError extends Error {
  constructor(message, { code = null, stderr = '', kind = 'git' } = {}) {
    super(message);
    this.name = 'GitError';
    this.code = code;
    this.stderr = stderr;
    this.kind = kind;
  }
}

/** Remove credenciais de URLs (https://user:token@host → https://***@host). */
function redact(text) {
  if (!text) return '';
  return String(text)
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1***@')
    .replace(/(authorization:\s*(?:basic|bearer|token)\s+)[^\s'"]+/gi, '$1***');
}

/**
 * Localiza o executável do git. Linux/macOS: `git` (resolvido pelo PATH no execFile).
 * Windows: procura git.exe no PATH e depois nas pastas padrão do Git for Windows.
 */
function findGit({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (env.AGZOS_GIT_PATH) return env.AGZOS_GIT_PATH;
  if (platform !== 'win32') return 'git';
  const pathVar = env.Path || env.PATH || '';
  const join = path.win32.join;
  for (const dir of pathVar.split(';').filter(Boolean)) {
    const candidate = join(dir.replace(/^"|"$/g, ''), 'git.exe');
    if (exists(candidate)) return candidate;
  }
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432,
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  for (const root of roots) {
    for (const rel of ['Git\\cmd\\git.exe', 'Git\\bin\\git.exe']) {
      const candidate = join(root, rel);
      if (exists(candidate)) return candidate;
    }
  }
  return 'git.exe';
}

let cachedGitPath = null;
function defaultGitPath() {
  if (!cachedGitPath) cachedGitPath = findGit();
  return cachedGitPath;
}

/** Ambiente que injeta o token só para https://github.com/. */
function authEnv(token) {
  if (!token) return {};
  const basic = Buffer.from(`x-access-token:${token}`, 'utf-8').toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

/** Monta o env completo de uma chamada git. */
function buildEnv({ token, baseEnv = process.env } = {}) {
  const env = { ...baseEnv };
  // Nada de prompt de credencial (terminal, askpass gráfico do VS Code etc.).
  delete env.GIT_ASKPASS;
  delete env.SSH_ASKPASS;
  delete env.GIT_CONFIG_PARAMETERS;
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(key)) delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = '0';
  env.GCM_INTERACTIVE = 'never';
  // Mensagens do git em inglês: a classificação de erros depende do texto.
  env.LC_ALL = 'C';
  env.LANGUAGE = 'C';
  Object.assign(env, authEnv(token));
  return env;
}

/** Classifica a saída de erro do git num `kind` que a UI sabe explicar. */
function classifyError(stderr, { code, killed } = {}) {
  const s = String(stderr || '');
  if (code === 'ENOENT') return 'git-missing';
  if (killed) return 'timeout';
  if (/not a git repository/i.test(s)) return 'not-repo';
  if (/\[rejected\]|non-fast-forward|fetch first|failed to push some refs/i.test(s)) return 'rejected';
  if (/Not possible to fast-forward|diverging branches|have diverged/i.test(s)) return 'diverged';
  if (/Authentication failed|could not read Username|terminal prompts disabled|returned error: 40[13]|Invalid username or password|Permission denied \(publickey\)/i.test(s)) return 'auth';
  if (/Please tell me who you are|unable to auto-detect email address|empty ident name/i.test(s)) return 'identity';
  if (/CONFLICT|unmerged|fix conflicts|needs merge/i.test(s)) return 'conflict';
  if (/would be overwritten by (checkout|merge)|Please commit your changes or stash them/i.test(s)) return 'dirty';
  if (/no upstream|has no upstream branch|no tracking information/i.test(s)) return 'no-upstream';
  if (/nothing to commit|no changes added to commit/i.test(s)) return 'nothing';
  if (/Could not resolve host|unable to access|Connection (timed out|refused)|Network is unreachable/i.test(s)) return 'network';
  if (/does not appear to be a git repository|repository .* not found|Repository not found/i.test(s)) return 'remote-missing';
  if (/already exists and is not an empty directory/i.test(s)) return 'dest-exists';
  return 'git';
}

function friendlyMessage(kind, stderr) {
  const clean = redact(stderr).trim().split('\n').filter((l) => l && !/^hint:/.test(l)).slice(-4).join('\n');
  switch (kind) {
    case 'git-missing': return GIT_MISSING_MESSAGE;
    case 'timeout': return 'O git demorou demais e foi interrompido. Verifique a conexão e tente de novo.';
    case 'not-repo': return 'Esta pasta não é um repositório Git.';
    case 'rejected': return 'Push rejeitado: o remoto tem commits que você ainda não tem. Faça Pull (ou Sincronizar) e tente de novo.';
    case 'diverged': return 'A branch local e a remota divergiram. Resolva com "git pull --rebase" ou um merge no terminal.';
    case 'identity': return 'Configure seu nome e e-mail do Git (git config user.name / user.email) ou adicione uma conta GitHub.';
    case 'conflict': return `Há conflitos para resolver.\n${clean}`;
    case 'dirty': return 'Há alterações locais que seriam sobrescritas. Faça commit ou descarte antes de trocar.';
    case 'nothing': return 'Nada para commitar.';
    case 'network': return `Falha de rede ao falar com o remoto.\n${clean}`;
    case 'remote-missing': return `Repositório remoto não encontrado ou sem acesso.\n${clean}`;
    case 'dest-exists': return 'A pasta de destino já existe e não está vazia.';
    default: return clean || 'O git falhou.';
  }
}

/**
 * Roda `git <args>` em `cwd`.
 * opts: { token, timeoutMs, execFileImpl, onStderr, gitPath, input }
 * → Promise<{ stdout, stderr }>. Erro: GitError { code, stderr, kind, message }.
 */
function runGit(cwd, args, opts = {}) {
  if (typeof cwd === 'string' && cwd.startsWith('ssh://')) return runGitRemote(cwd, args, opts);
  const {
    token, timeoutMs = TIMEOUT_MS, execFileImpl = childProcess.execFile, onStderr,
    gitPath = defaultGitPath(), baseEnv,
  } = opts;
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    return Promise.reject(new GitError('Argumentos do git inválidos', { kind: 'invalid' }));
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = execFileImpl(gitPath, args, {
        cwd,
        env: buildEnv({ token, baseEnv }),
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      }, (err, stdout, stderr) => {
        if (err) {
          const kind = classifyError(stderr, { code: err.code, killed: err.killed || err.signal === 'SIGTERM' });
          reject(new GitError(friendlyMessage(kind, stderr), {
            code: typeof err.code === 'number' ? err.code : (err.code || null),
            stderr: redact(stderr),
            kind,
          }));
          return;
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      });
    } catch (e) {
      const kind = e.code === 'ENOENT' ? 'git-missing' : 'git';
      reject(new GitError(friendlyMessage(kind, e.message), { code: e.code, kind }));
      return;
    }
    if (onStderr && child?.stderr) child.stderr.on('data', (d) => onStderr(String(d)));
  });
}

/**
 * git no host remoto. opts.token é ignorado de propósito (não vai ao host).
 * opts.provider: injeção para testes; senão providerFor(cwd) da janela do contexto.
 */
async function runGitRemote(cwd, args, opts = {}) {
  const { timeoutMs = REMOTE_TIMEOUT_MS, onStderr, provider } = opts;
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    throw new GitError('Argumentos do git inválidos', { kind: 'invalid' });
  }
  const prov = provider || require('../workspace/provider-for').providerFor(cwd);
  let res;
  try {
    res = await prov.exec('git', ['-C', prov.pathOf(cwd), ...args], {
      env: REMOTE_GIT_ENV,
      timeoutMs: Math.max(timeoutMs, REMOTE_TIMEOUT_MS),
      onData: onStderr ? (chunk, stream) => { if (stream === 'stderr') onStderr(chunk); } : undefined,
    });
  } catch (e) {
    throw new GitError(redact(e.message) || 'Falha ao rodar o git no host remoto.', { kind: e.code === 'REMOTE_LOST' ? 'network' : 'git' });
  }
  if (res.timedOut) throw new GitError(friendlyMessage('timeout', res.stderr), { kind: 'timeout', stderr: redact(res.stderr) });
  if (res.code === 0) return { stdout: res.stdout || '', stderr: res.stderr || '' };
  if (res.code === 127) {
    throw new GitError('Git não encontrado no host remoto. Instale o git no servidor.', { code: 127, kind: 'git-missing' });
  }
  let kind = classifyError(res.stderr, { code: res.code });
  let message = friendlyMessage(kind, res.stderr);
  if (kind === 'auth') {
    kind = 'auth-remote';
    message = 'O host remoto recusou as credenciais do Git. Configure-as no servidor (chave SSH ou credential helper de lá); o token do GitHub do Agzos não é enviado ao host.';
  }
  throw new GitError(message, { code: res.code, stderr: redact(res.stderr), kind });
}

let versionCache = null;
/** → { ok: true, version } | { ok: false, message, installUrl } */
async function gitVersion({ force = false, ...opts } = {}) {
  if (versionCache && !force) return versionCache;
  try {
    const { stdout } = await runGit(process.cwd(), ['--version'], opts);
    const m = stdout.match(/(\d+\.\d+(?:\.\d+)?)/);
    versionCache = { ok: true, version: m ? m[1] : stdout.trim() };
  } catch (e) {
    versionCache = { ok: false, message: e.kind === 'git-missing' ? GIT_MISSING_MESSAGE : e.message, installUrl: GIT_INSTALL_URL };
  }
  return versionCache;
}

module.exports = {
  GitError,
  runGit,
  runGitRemote,
  REMOTE_GIT_ENV,
  authEnv,
  buildEnv,
  findGit,
  redact,
  classifyError,
  friendlyMessage,
  gitVersion,
  TIMEOUT_MS,
  NETWORK_TIMEOUT_MS,
  CLONE_TIMEOUT_MS,
  GIT_INSTALL_URL,
  GIT_MISSING_MESSAGE,
};
