/**
 * Conexão SSH (ssh2): resolve o alvo (alias do ~/.ssh/config ou usuario@host[:porta]),
 * confere a chave do host no known_hosts e autentica (agente → chaves → senha).
 * Sem Electron: diálogos chegam por askSecret/askHostKey.
 *
 * Host key:
 *  - conhecida e igual → segue;
 *  - desconhecida → askHostKey({ host, port, keyType, fingerprint }); "Confiar"
 *    acrescenta a linha ao known_hosts (pasta 0700, arquivo 0600);
 *  - divergente (ou revogada) → erro HOSTKEY_MISMATCH, sem pergunta e sem opção de seguir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');
const { parseTarget, isSafeAlias, isSafeHost, isSafeUser, validPort } = require('../lib/ssh-config');
const kh = require('./known-hosts');
const { authOrder, createAuthHandler } = require('./auth');

const KEEPALIVE_MS = 15_000;
const READY_TIMEOUT_MS = 20_000;

class RemoteError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RemoteError';
    this.code = code;
  }
}

function hostForAuthority(host) {
  return host.includes(':') ? `[${host}]` : host;
}

/**
 * Alvo → { alias, host, port, user, identityFiles, authority, label }.
 * target: 'alias' | 'usuario@host[:porta]' | { alias } | { user, host, port }.
 * hosts: entradas do ~/.ssh/config (collectHosts).
 */
function resolveTarget(target, { hosts = [], defaultUser = safeUserName() } = {}) {
  let alias = null;
  let entry = null;
  let t = null;
  if (typeof target === 'string') {
    const s = target.trim();
    entry = isSafeAlias(s) ? hosts.find((h) => h.host === s) : null;
    if (entry) alias = s;
    else t = parseTarget(s);
  } else if (target && typeof target === 'object') {
    if (target.alias != null) {
      if (!isSafeAlias(target.alias)) throw new RemoteError('Alvo SSH inválido.', 'INVALID_TARGET');
      entry = hosts.find((h) => h.host === target.alias) || { host: target.alias };
      alias = target.alias;
    } else {
      t = { user: target.user || null, host: target.host, port: target.port || null };
    }
  }
  if (entry) {
    if (entry.proxy) {
      throw new RemoteError(`O host "${alias}" usa ProxyJump/ProxyCommand, que ainda não é suportado na pasta remota. Use um host acessível diretamente.`, 'PROXY_UNSUPPORTED');
    }
    t = { user: entry.user || null, host: entry.hostName || entry.host, port: entry.port || null };
  }
  if (!t || !isSafeHost(t.host)) throw new RemoteError('Alvo SSH inválido. Use usuario@host ou usuario@host:porta.', 'INVALID_TARGET');
  const user = t.user || defaultUser;
  if (!isSafeUser(user)) throw new RemoteError('Usuário SSH inválido.', 'INVALID_TARGET');
  const port = t.port == null ? 22 : validPort(t.port);
  if (!port) throw new RemoteError('Porta inválida (1–65535).', 'INVALID_TARGET');
  const authority = alias || `${user}@${hostForAuthority(t.host)}:${port}`;
  return {
    alias,
    host: t.host,
    port,
    user,
    identityFiles: entry?.identityFile ? [entry.identityFile] : [],
    authority,
    label: alias || t.host,
  };
}

function safeUserName() {
  try { return os.userInfo().username; } catch { return 'root'; }
}

function readKnownHosts(files) {
  const out = [];
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (!st.isFile() || st.size > 4 * 1024 * 1024) continue;
      out.push(...kh.parseKnownHosts(fs.readFileSync(f, 'utf8')));
    } catch { /* não existe */ }
  }
  return out;
}

function appendKnownHost(file, line) {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { /* já existe */ }
  let prefix = '';
  try {
    const cur = fs.readFileSync(file, 'utf8');
    if (cur && !cur.endsWith('\n')) prefix = '\n';
  } catch { /* novo */ }
  fs.appendFileSync(file, prefix + line, { mode: 0o600 });
  if (process.platform !== 'win32') { try { fs.chmodSync(file, 0o600); } catch { /* ignora */ } }
}

/**
 * Abre a conexão. → Promise<{ client, onReady }>; rejeita com RemoteError
 * (HOSTKEY_MISMATCH, HOSTKEY_REJECTED, AUTH_FAILED, CANCELLED, CONNECT_FAILED).
 */
function openConnection(resolved, {
  askSecret = async () => null,
  askHostKey = async () => false,
  secretStore = null,
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  knownHostsFiles,
  knownHostsFile,
  readFile,
  ClientImpl = Client,
  readyTimeout = READY_TIMEOUT_MS,
  keepaliveInterval = KEEPALIVE_MS,
} = {}) {
  const userKnown = knownHostsFile || path.join(home, '.ssh', 'known_hosts');
  const files = knownHostsFiles || [userKnown, ...(platform === 'win32' ? [] : ['/etc/ssh/ssh_known_hosts'])];
  const order = authOrder({ platform, env, home, identityFiles: resolved.identityFiles || [] });
  const handler = createAuthHandler({ resolved, order, askSecret, secretStore, ...(readFile ? { readFile } : {}) });

  return new Promise((resolve, reject) => {
    const client = new ClientImpl();
    let hostError = null;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { client.end(); } catch { /* já fechado */ }
      reject(err);
    };

    const hostVerifier = (key, verify) => {
      const blob = Buffer.isBuffer(key) ? key : Buffer.from(key);
      let result;
      try {
        result = kh.checkHostKey(readKnownHosts(files), resolved.host, resolved.port, blob);
      } catch {
        result = 'mismatch';
      }
      const info = {
        host: resolved.host, port: resolved.port, label: resolved.label,
        keyType: kh.keyTypeOf(blob), fingerprint: kh.fingerprint(blob),
      };
      if (result === 'match') { verify(true); return; }
      if (result === 'mismatch') {
        hostError = new RemoteError(
          `ATENÇÃO: a chave do host ${resolved.label} (${resolved.host}:${resolved.port}) é diferente da registrada no known_hosts. `
          + `Isso pode ser um ataque (alguém se passando pelo servidor). A conexão foi bloqueada. `
          + `Fingerprint recebido: ${info.fingerprint}. Se a troca da chave é legítima, remova a linha antiga do ~/.ssh/known_hosts.`,
          'HOSTKEY_MISMATCH',
        );
        hostError.info = info;
        verify(false);
        return;
      }
      Promise.resolve()
        .then(() => askHostKey(info))
        .then((ok) => {
          if (ok !== true) {
            hostError = new RemoteError(`Conexão cancelada: a chave do host ${resolved.label} não foi confirmada.`, 'HOSTKEY_REJECTED');
            verify(false);
            return;
          }
          try { appendKnownHost(userKnown, kh.formatEntry(resolved.host, resolved.port, blob)); } catch { /* segue mesmo sem gravar */ }
          verify(true);
        }, () => { hostError = new RemoteError('Conexão cancelada.', 'HOSTKEY_REJECTED'); verify(false); });
    };

    client.once('ready', () => {
      if (settled) return;
      settled = true;
      handler.onReady();
      resolve({ client });
    });
    client.on('error', (err) => {
      if (hostError) return fail(hostError);
      if (handler.cancelled()) return fail(new RemoteError('Conexão cancelada.', 'CANCELLED'));
      if (err && err.level === 'client-authentication') {
        return fail(new RemoteError(`Falha na autenticação em ${resolved.label}: agente, chaves e senha foram recusados.`, 'AUTH_FAILED'));
      }
      fail(new RemoteError(`Não foi possível conectar a ${resolved.label}: ${err?.message || err}`, 'CONNECT_FAILED'));
    });
    client.on('close', () => {
      if (hostError) return fail(hostError);
      fail(new RemoteError(`A conexão com ${resolved.label} foi encerrada.`, 'CONNECT_FAILED'));
    });

    try {
      client.connect({
        host: resolved.host,
        port: resolved.port,
        username: resolved.user,
        authHandler: handler,
        hostVerifier,
        keepaliveInterval,
        keepaliveCountMax: 3,
        readyTimeout,
        tryKeyboard: true,
      });
    } catch (err) {
      fail(new RemoteError(`Não foi possível conectar a ${resolved.label}: ${err.message}`, 'CONNECT_FAILED'));
    }
  });
}

module.exports = { resolveTarget, openConnection, RemoteError, appendKnownHost, readKnownHosts, KEEPALIVE_MS };
