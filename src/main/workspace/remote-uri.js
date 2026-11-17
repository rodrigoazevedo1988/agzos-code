/**
 * URI de pasta/arquivo remoto: `ssh://<authority>/<caminho absoluto POSIX>`.
 * authority = alias seguro do ~/.ssh/config ou `usuario@host:porta`
 * (`usuario@[ipv6]:porta`). O caminho vem cru (sem percent-encoding).
 *
 * parseRemoteUri é estrito (é a base do guard remoto): nega `..`/`.` (inclusive
 * `%2e%2e`), barra dupla, `\`, NUL e quebra de linha. Sem I/O.
 */

const path = require('path');
const { isSafeAlias, parseTarget } = require('../lib/ssh-config');

const PREFIX = 'ssh://';

function isRemote(p) {
  return typeof p === 'string' && p.startsWith(PREFIX);
}

function validAuthority(a) {
  if (typeof a !== 'string' || !a || a.length > 300) return false;
  if (isSafeAlias(a)) return true;
  const t = parseTarget(a);
  return !!(t && t.user && t.port);
}

function badSegment(seg) {
  let d = seg;
  try { d = decodeURIComponent(seg); } catch { /* % solto: fica como está */ }
  return d === '.' || d === '..';
}

/** → { authority, target, path } | null */
function parseRemoteUri(uri) {
  if (!isRemote(uri)) return null;
  const rest = uri.slice(PREFIX.length);
  const slash = rest.indexOf('/');
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  let p = slash === -1 ? '/' : rest.slice(slash);
  if (!validAuthority(authority)) return null;
  if (/[\0\r\n\\]/.test(p)) return null;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p !== '/') {
    const segs = p.slice(1).split('/');
    if (segs.some((s) => s === '' || badSegment(s))) return null;
  }
  return { authority, target: authority, path: p };
}

/** authority + caminho POSIX absoluto → URI (normaliza; nunca sobe acima de /). */
function toRemoteUri(authority, posixPath) {
  let p = path.posix.normalize(`/${String(posixPath || '/')}`);
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return `${PREFIX}${authority}${p}`;
}

function remoteJoin(uri, ...parts) {
  const r = parseRemoteUri(uri);
  if (!r) throw new Error(`Caminho remoto inválido: ${uri}`);
  for (const part of parts) {
    if (String(part).split('/').some((s) => s === '..')) throw new Error('Caminho remoto inválido.');
  }
  return toRemoteUri(r.authority, path.posix.join(r.path, ...parts.map(String)));
}

function remoteDirname(uri) {
  const r = parseRemoteUri(uri);
  if (!r) return null;
  return toRemoteUri(r.authority, path.posix.dirname(r.path));
}

function remoteBasename(uri) {
  const r = parseRemoteUri(uri);
  return r ? path.posix.basename(r.path) : '';
}

/** `uri` está dentro de `rootUri` (mesmo host)? Ambos já validados por parseRemoteUri. */
function isWithinRemote(rootUri, uri) {
  const a = parseRemoteUri(rootUri);
  const b = parseRemoteUri(uri);
  if (!a || !b || a.authority !== b.authority) return false;
  if (a.path === '/') return true;
  return b.path === a.path || b.path.startsWith(`${a.path}/`);
}

/** Caminho relativo (POSIX) de `uri` dentro de `rootUri`, ou null. */
function remoteRelative(rootUri, uri) {
  if (!isWithinRemote(rootUri, uri)) return null;
  return path.posix.relative(parseRemoteUri(rootUri).path, parseRemoteUri(uri).path);
}

/** Caminho genérico (local ou ssh://): junta como o lado certo exige. */
function joinAny(base, ...parts) {
  return isRemote(base) ? remoteJoin(base, ...parts) : path.join(base, ...parts);
}

module.exports = {
  PREFIX, isRemote, parseRemoteUri, toRemoteUri, remoteJoin, remoteDirname, remoteBasename,
  isWithinRemote, remoteRelative, joinAny, validAuthority,
};
