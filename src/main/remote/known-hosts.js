/**
 * ~/.ssh/known_hosts — leitura e verificação da chave do host. Puro (sem I/O).
 *
 * Formato (OpenSSH): `[marcador] hosts tipo base64 [comentário]`.
 *  - hosts: lista com vírgula; `[host]:porta` para porta ≠ 22; curingas `*`/`?`;
 *    negação `!padrão`; ou hash `|1|base64(salt)|base64(HMAC-SHA1(salt, padrão))`.
 *  - marcadores: `@revoked` (chave nunca aceita) e `@cert-authority` (ignorado aqui).
 *
 * checkHostKey → 'match' | 'unknown' | 'mismatch'. Mismatch = o host tem chave
 * registrada do mesmo tipo e ela é outra (ou a chave está revogada): a conexão
 * é bloqueada sem opção de continuar.
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
  const h = String(host || '');
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

function checkHostKey(entries, host, port, keyBlob) {
  const name = hostPattern(host, port);
  const type = keyTypeOf(keyBlob);
  let sameTypeOther = false;
  let matched = false;
  for (const e of entries || []) {
    if (e.marker === '@revoked') {
      if (e.key.equals(keyBlob)) return 'mismatch';
      continue;
    }
    if (e.marker) continue; // @cert-authority: não suportado aqui
    if (!hostsMatch(e.hosts, name)) continue;
    if (e.keyType !== type) continue;
    if (e.key.equals(keyBlob)) matched = true;
    else sameTypeOther = true;
  }
  if (matched) return 'match';
  if (sameTypeOther) return 'mismatch';
  return 'unknown';
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

module.exports = { parseKnownHosts, checkHostKey, fingerprint, formatEntry, keyTypeOf, hostPattern };
