/**
 * Autenticação SSH: ordem dos métodos e o authHandler do ssh2. Sem Electron.
 *
 * Ordem: agente SSH (SSH_AUTH_SOCK; no Windows o pipe do OpenSSH e depois o
 * Pageant) → chaves (IdentityFile do config e as padrão de ~/.ssh) → senha.
 *
 * Segredos pedidos ao usuário (askSecret, diálogo no renderer):
 *  - senha do host: com "Lembrar" vai ao cofre `ssh.<user>@<host>:<porta>` só
 *    depois que a conexão autentica (onReady). Senha salva recusada é apagada
 *    do cofre e pedida de novo (só quando ela foi a única resposta da tentativa).
 *  - keyboard-interactive: 1 prompt sem eco que parece senha recebe a senha; os
 *    demais (OTP, 2FA, vários prompts) são perguntados um a um (kind
 *    'keyboard-interactive', título = texto do prompt, sem "Lembrar").
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

  // Senha em uso nesta autenticação: { value, source: 'vault'|'user' }.
  // lastAttempt: o que foi enviado na tentativa anterior (se o handler é chamado de
  // novo, ela falhou). Só uma falha em que a senha foi a única resposta a culpa:
  // num fluxo com OTP (keyboard-interactive com outros prompts) a senha fica.
  let current = null;
  let vaultTried = false;
  let lastAttempt = null; // { usedPassword, onlyPassword }
  let kiTries = 0;

  function blamePreviousFailure() {
    const prev = lastAttempt;
    lastAttempt = null;
    if (!prev || !prev.usedPassword || !prev.onlyPassword || !current) return '';
    pendingSaves.delete(pwKey);
    const wasVault = current.source === 'vault';
    current = null;
    if (wasVault) {
      vaultDel(pwKey);
      return 'A senha salva no cofre foi recusada pelo servidor. Digite de novo.';
    }
    return 'Senha incorreta. Tente de novo.';
  }

  /** Senha a enviar: a atual, a do cofre ou pedida ao usuário. → string | null */
  async function getPassword(message) {
    if (current) return current.value;
    if (!vaultTried) {
      vaultTried = true;
      const saved = vaultGet(pwKey);
      if (saved != null) { current = { value: saved, source: 'vault' }; return saved; }
    }
    if (passwordAsks >= MAX_ASKS) return null;
    passwordAsks++;
    const res = await ask({ kind: 'password', target: label, title: `Senha de ${label}`, message, canRemember: vaultOk() });
    if (!res) return null;
    current = { value: res.value, source: 'user' };
    if (res.remember && vaultOk()) pendingSaves.set(pwKey, res.value);
    return res.value;
  }

  async function passwordAttempt(methodsLeft) {
    const allowsPw = !methodsLeft || methodsLeft.includes('password');
    const allowsKi = !!methodsLeft && methodsLeft.includes('keyboard-interactive');
    if (!allowsPw && !allowsKi) return false;
    const message = blamePreviousFailure();
    if (allowsPw) {
      const pw = await getPassword(message);
      if (pw == null) return false;
      lastAttempt = { usedPassword: true, onlyPassword: true };
      return { type: 'password', username, password: pw };
    }
    if (kiTries >= MAX_ASKS) return false;
    kiTries++;
    return keyboardInteractive(message);
  }

  // Parece pedido de senha (e não de código/OTP/token).
  const looksLikePassword = (text) => /pass(word|phrase)?|senha|contrase|mot de passe/i.test(text || '')
    && !/code|c[oó]digo|otp|token|verifica|one[- ]time|2fa|totp/i.test(text || '');

  /**
   * keyboard-interactive: preenche sozinho só 1 prompt sem eco que pareça senha;
   * o resto (OTP, perguntas, vários prompts) vai ao usuário, um diálogo por prompt,
   * sem "Lembrar" e sem guardar a resposta.
   */
  function keyboardInteractive(message) {
    const attempt = { usedPassword: false, onlyPassword: true };
    lastAttempt = attempt;
    let firstMessage = message;
    async function answer(name, instructions, prompts) {
      const list = Array.isArray(prompts) ? prompts : [];
      if (list.length === 1 && !list[0].echo && looksLikePassword(list[0].prompt)) {
        const pw = await getPassword(firstMessage);
        firstMessage = '';
        if (pw == null) { cancelled = true; return []; }
        attempt.usedPassword = true;
        return [pw];
      }
      if (list.length) attempt.onlyPassword = false;
      const out = [];
      for (const p of list) {
        const text = String(p?.prompt || '').trim().slice(0, 200) || 'Resposta';
        const res = await ask({
          kind: 'keyboard-interactive', target: label, title: String(p?.prompt || '').slice(0, 200) || 'Resposta',
          message: [String(name || '').trim(), String(instructions || '').trim()].filter(Boolean).join(' — ').slice(0, 500)
            || `${text} (${label})`,
          echo: !!p?.echo, canRemember: false,
        });
        if (!res) return [];
        out.push(res.value);
      }
      return out;
    }
    return {
      type: 'keyboard-interactive',
      username,
      prompt: (name, instructions, _lang, prompts, finish) => {
        answer(name, instructions, prompts).then(finish, () => finish([]));
      },
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
