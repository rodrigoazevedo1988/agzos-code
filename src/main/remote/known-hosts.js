/**
 * ~/.ssh/known_hosts — leitura e verificação da chave do host. Puro (sem I/O).
 *
 * Formato (OpenSSH): `[marcador] hosts tipo base64 [comentário]`.
 *  - hosts: lista com vírgula; `[host]:porta` para porta ≠ 22; curingas `*`/`?`;
 *    negação `!padrão`; ou hash `|1|base64(salt)|base64(HMAC-SHA1(salt, padrão))`.
 *  - marcadores: `@revoked` (chave nunca aceita) e `@cert-authority` (ignorado aqui).
 *
 * checkHostKey → 'match' | 'unknown' | 'mismatch'. Mismatch = o host tem chave
 * registrada (de qualquer tipo) e a apresentada não é nenhuma delas, ou a chave
 * está revogada: a conexão é bloqueada sem opção de continuar. Como o OpenSSH,
 * o handshake é restrito aos tipos já registrados para o host (knownKeyTypes +
 * hostKeyAlgorithms); um servidor que só oferece outro tipo não vira "desconhecido".
 *
 * O nome do host é comparado em minúsculas (texto, curingas e hash |1|), como o
 * OpenSSH grava e consulta.
 */

const crypto = require('crypto');

/** Tipo da chave a partir do blob SSH (string com tamanho no início). */
function keyTypeOf(blob) {
  if (!Buffer.isBuffer(blob) || blob.length < 4) return null;
  const len = blob.readUInt32BE(0);
  if (len <= 0 || len > 64 || blob.length < 4 + len) return null;
  return blob.subarray(4, 4 + len).toString('latin1');
}

function decodeKey(b64) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf.length ? buf : null;
}

function parseHosts(field) {
  if (field.startsWith('|1|')) {
    const [, , salt, hash] = field.split('|');
    if (!salt || !hash) return null;
    return { hashed: true, salt: Buffer.from(salt, 'base64'), hash: Buffer.from(hash, 'base64') };
  }
  const list = field.split(',').filter(Boolean);
  return list.length ? list : null;
}

/** → [{ marker, hosts: string[] | { hashed, salt, hash }, keyType, key: Buffer }] */
function parseKnownHosts(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    let marker = null;
    if (parts[0].startsWith('@')) marker = parts.shift();
    if (parts.length < 3) continue;
    const [hostField, keyType, b64] = parts;
    const hosts = parseHosts(hostField);
    const key = decodeKey(b64);
    if (!hosts || !key) continue;
    if (keyTypeOf(key) !== keyType) continue;
    out.push({ marker, hosts, keyType, key });
  }
  return out;
}

function hostPattern(host, port) {
  const h = String(host || '').toLowerCase();
  if (!h || /[\s,#]/.test(h) || h.startsWith('|') || h.startsWith('@')) throw new Error('Host inválido.');
  const p = Number(port) || 22;
  return p === 22 ? h : `[${h}]:${p}`;
}

function globMatch(pattern, value) {
  const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  return re.test(value);
}

function hostsMatch(hosts, name) {
  if (!Array.isArray(hosts)) {
    const h = crypto.createHmac('sha1', hosts.salt).update(name).digest();
    return h.length === hosts.hash.length && crypto.timingSafeEqual(h, hosts.hash);
  }
  let positive = false;
  for (const pat of hosts) {
    if (pat.startsWith('!')) {
      if (globMatch(pat.slice(1), name)) return false;
    } else if (globMatch(pat, name)) {
      positive = true;
    }
  }
  return positive;
}

/** Entradas normais (sem marcador) que valem para o host. */
function entriesFor(entries, host, port) {
  const name = hostPattern(host, port);
  return (entries || []).filter((e) => !e.marker && hostsMatch(e.hosts, name));
}

function checkHostKey(entries, host, port, keyBlob) {
  for (const e of entries || []) {
    if (e.marker === '@revoked' && e.key.equals(keyBlob)) return 'mismatch';
  }
  const own = entriesFor(entries, host, port); // @cert-authority: não suportado aqui
  if (own.some((e) => e.key.equals(keyBlob))) return 'match';
  // Qualquer chave registrada para o host (mesmo de outro tipo) → divergente.
  return own.length ? 'mismatch' : 'unknown';
}

/** Tipos de chave registrados para o host (sem repetir, na ordem do arquivo). */
function knownKeyTypes(entries, host, port) {
  return [...new Set(entriesFor(entries, host, port).map((e) => e.keyType))];
}

// Tipo da chave (known_hosts) → algoritmos de host key do ssh2.
const HOST_KEY_ALGOS = {
  'ssh-ed25519': ['ssh-ed25519'],
  'ecdsa-sha2-nistp256': ['ecdsa-sha2-nistp256'],
  'ecdsa-sha2-nistp384': ['ecdsa-sha2-nistp384'],
  'ecdsa-sha2-nistp521': ['ecdsa-sha2-nistp521'],
  'ssh-rsa': ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'],
  'ssh-dss': ['ssh-dss'],
};

/** → lista para `algorithms.serverHostKey` do ssh2, ou null (sem restrição). */
function hostKeyAlgorithms(types) {
  const out = [];
  for (const t of types || []) for (const a of HOST_KEY_ALGOS[t] || []) if (!out.includes(a)) out.push(a);
  return out.length ? out : null;
}

/** Fingerprint como o `ssh-keygen -l`: SHA256:<base64 sem '='>. */
function fingerprint(keyBlob) {
  return `SHA256:${crypto.createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`;
}

/** Linha nova para acrescentar ao known_hosts (com \n no fim). */
function formatEntry(host, port, keyBlob) {
  const type = keyTypeOf(keyBlob);
  if (!type) throw new Error('Chave do host inválida.');
  return `${hostPattern(host, port)} ${type} ${keyBlob.toString('base64')}\n`;
}

module.exports = {
  parseKnownHosts, checkHostKey, knownKeyTypes, hostKeyAlgorithms, fingerprint, formatEntry, keyTypeOf, hostPattern,
};
