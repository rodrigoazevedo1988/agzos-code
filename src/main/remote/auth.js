/**
 * Autenticação SSH: ordem dos métodos e o authHandler do ssh2. Sem Electron.
 *
 * Ordem: agente SSH (SSH_AUTH_SOCK; no Windows o pipe do OpenSSH e depois o
 * Pageant) → chaves (IdentityFile do config e as padrão de ~/.ssh) → senha.
 *
 * Segredos pedidos ao usuário (askSecret, diálogo no renderer):
 *  - senha do host: com "Lembrar" vai ao cofre `ssh.<user>@<host>:<porta>` só
 *    depois que a conexão autentica (onReady). Senha salva recusada é apagada
 *    do cofre e pedida de novo.
 *  - passphrase de chave: conferida localmente (parseKey); com "Lembrar" vai ao
 *    cofre `ssh.key:<caminho da chave>`.
 */

const fs = require('fs');
const path = require('path');
const { utils } = require('ssh2');

const DEFAULT_KEYS = ['id_ed25519', 'id_ecdsa', 'id_rsa'];
const WIN_OPENSSH_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';
const MAX_ASKS = 3;

function vaultKeyFor({ user, host, port }) {
  return `ssh.${user}@${host}:${port || 22}`;
}

function keyVaultKey(keyPath) {
  return `ssh.key:${keyPath}`;
}

function expandHome(p, home, platform) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return p;
}

/** → [{ type: 'agent', agent } | { type: 'key', path } | { type: 'password' }] */
function authOrder({
  platform = process.platform,
  env = process.env,
  home,
  identityFiles = [],
  exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
} = {}) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const out = [];
  if (platform === 'win32') {
    out.push({ type: 'agent', agent: WIN_OPENSSH_PIPE }, { type: 'agent', agent: 'pageant' });
  } else if (env.SSH_AUTH_SOCK) {
    out.push({ type: 'agent', agent: env.SSH_AUTH_SOCK });
  }
  const seen = new Set();
  const addKey = (p) => {
    if (!p || seen.has(p) || !exists(p)) return;
    seen.add(p);
    out.push({ type: 'key', path: p });
  };
  for (const f of identityFiles) {
    if (typeof f === 'string' && f) addKey(expandHome(f, home, platform));
  }
  for (const name of DEFAULT_KEYS) addKey(join(home, '.ssh', name));
  out.push({ type: 'password' });
  return out;
}

function parsePrivate(buf, passphrase) {
  let k = utils.parseKey(buf, passphrase);
  if (Array.isArray(k)) k = k[0];
  return k;
}

const isEncryptedError = (k) => k instanceof Error && /encrypt|passphrase/i.test(k.message);

/**
 * authHandler do ssh2: (methodsLeft, partialSuccess, next) → next(objeto | false).
 * resolved: { user, host, port }. askSecret(req) → { value, remember } | null.
 * Extras: onReady() grava o que ficou pendente ("Lembrar"); cancelled().
 */
function createAuthHandler({
  resolved,
  order,
  askSecret,
  secretStore,
  readFile = (p) => fs.readFileSync(p),
}) {
  const username = resolved.user;
  const pwKey = vaultKeyFor(resolved);
  const vaultOk = () => { try { return !!secretStore?.isAvailable?.(); } catch { return false; } };
  const vaultGet = (k) => { try { return vaultOk() ? secretStore.get(k) : null; } catch { return null; } };
  const vaultDel = (k) => { try { secretStore?.delete?.(k); } catch { /* cofre indisponível */ } };
  const pendingSaves = new Map();
  let idx = 0;
  let cancelled = false;
  let lastPassword = null; // { source: 'vault'|'user' } da última tentativa de senha
  let passwordAsks = 0;
  const label = `${username}@${resolved.host}${resolved.port && resolved.port !== 22 ? `:${resolved.port}` : ''}`;

  async function ask(req) {
    const res = await askSecret(req);
    if (!res || typeof res.value !== 'string') { cancelled = true; return null; }
    return res;
  }

  async function keyAttempt(m) {
    let buf;
    try { buf = readFile(m.path); } catch { return null; }
    let k = parsePrivate(buf);
    if (!(k instanceof Error)) return { type: 'publickey', username, key: buf, keyPath: m.path };
    if (!isEncryptedError(k)) return null;
    const saved = vaultGet(keyVaultKey(m.path));
    if (saved != null) {
      if (!(parsePrivate(buf, saved) instanceof Error)) {
        return { type: 'publickey', username, key: buf, passphrase: saved, keyPath: m.path };
      }
      vaultDel(keyVaultKey(m.path));
    }
    let message = '';
    for (let i = 0; i < MAX_ASKS; i++) {
      const res = await ask({
        kind: 'passphrase', keyPath: m.path, target: label,
        title: 'Passphrase da chave SSH', message: message || `Digite a passphrase de ${path.basename(m.path)}.`,
      });
      if (!res) { cancelled = false; return null; } // cancelar a passphrase só pula a chave
      k = parsePrivate(buf, res.value);
      if (!(k instanceof Error)) {
        if (res.remember) pendingSaves.set(keyVaultKey(m.path), res.value);
        return { type: 'publickey', username, key: buf, passphrase: res.value, keyPath: m.path };
      }
      message = 'Passphrase incorreta. Tente de novo.';
    }
    return null;
  }

  async function passwordAttempt(methodsLeft) {
    const allows = (t) => !methodsLeft || methodsLeft.includes(t);
    if (!allows('password') && !allows('keyboard-interactive')) return false;
    let message = '';
    if (lastPassword) {
      if (lastPassword.source === 'vault') {
        vaultDel(pwKey);
        message = 'A senha salva no cofre foi recusada pelo servidor. Digite de novo.';
      } else {
        message = 'Senha incorreta. Tente de novo.';
      }
      pendingSaves.delete(pwKey);
    } else {
      const saved = vaultGet(pwKey);
      if (saved != null) {
        lastPassword = { source: 'vault' };
        return makePassword(saved, methodsLeft);
      }
    }
    if (passwordAsks >= MAX_ASKS) return false;
    passwordAsks++;
    const res = await ask({ kind: 'password', target: label, title: `Senha de ${label}`, message, canRemember: vaultOk() });
    if (!res) return false;
    lastPassword = { source: 'user' };
    if (res.remember && vaultOk()) pendingSaves.set(pwKey, res.value);
    return makePassword(res.value, methodsLeft);
  }

  function makePassword(password, methodsLeft) {
    if (!methodsLeft || methodsLeft.includes('password')) return { type: 'password', username, password };
    return {
      type: 'keyboard-interactive',
      username,
      password,
      prompt: (_name, _instr, _lang, prompts, finish) => finish(prompts.map(() => password)),
    };
  }

  async function nextAttempt(methodsLeft) {
    while (idx < order.length) {
      const m = order[idx];
      if (m.type === 'password') {
        const r = await passwordAttempt(methodsLeft);
        if (r === false) { idx++; continue; }
        return r; // continua em senha até recusar/cancelar/esgotar
      }
      idx++;
      const allowsKey = !methodsLeft || methodsLeft.includes('publickey');
      if (!allowsKey) continue;
      if (m.type === 'agent') return { type: 'agent', username, agent: m.agent };
      if (m.type === 'key') {
        const r = await keyAttempt(m);
        if (cancelled) return false;
        if (r) return r;
      }
    }
    return false;
  }

  function handler(methodsLeft, _partial, next) {
    nextAttempt(methodsLeft).then((r) => next(cancelled ? false : r), () => next(false));
  }
  handler.onReady = () => {
    for (const [k, v] of pendingSaves) {
      try { secretStore?.set?.(k, v); } catch { /* cofre indisponível: não lembra */ }
    }
    pendingSaves.clear();
  };
  handler.cancelled = () => cancelled;
  return handler;
}

module.exports = { authOrder, createAuthHandler, vaultKeyFor, keyVaultKey, DEFAULT_KEYS, WIN_OPENSSH_PIPE };
