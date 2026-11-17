/**
 * Caminhos da pasta remota (ssh://<authority>/<caminho>) no renderer — puro, testável em Node.
 * Precisa casar com src/main/workspace/remote-uri.js.
 */

export function isRemotePath(p) {
  return typeof p === 'string' && p.startsWith('ssh://');
}

/** authority da URI (alias ou usuario@host:porta), ou null. */
export function remoteAuthority(uri) {
  if (!isRemotePath(uri)) return null;
  const rest = uri.slice(6);
  const i = rest.indexOf('/');
  const a = i === -1 ? rest : rest.slice(0, i);
  return a || null;
}

/** Caminho POSIX dentro do host ('/' se só a authority). */
export function remotePathPart(uri) {
  if (!isRemotePath(uri)) return null;
  const rest = uri.slice(6);
  const i = rest.indexOf('/');
  return i === -1 ? '/' : rest.slice(i) || '/';
}

/** Nome do host para exibir: alias, ou o host de usuario@host:porta. */
export function hostLabel(authority) {
  const a = String(authority || '');
  const m = /^[^@]+@(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(a);
  return m ? m[1].replace(/^\[|\]$/g, '') : a;
}

export function remoteFolderLabel(uri, connected) {
  const authority = remoteAuthority(uri);
  const info = connected?.get?.(authority);
  const p = remotePathPart(uri) || '/';
  const folder = p === '/' ? '/' : p.split('/').filter(Boolean).pop();
  return { host: info?.label || hostLabel(authority), folder };
}

/** Pasta-mãe de um caminho local ou remoto (mantém o prefixo ssh://authority). */
export function parentPath(p) {
  if (isRemotePath(p)) {
    const authority = remoteAuthority(p);
    const path = remotePathPart(p);
    const cut = path.replace(/\/+$/, '').lastIndexOf('/');
    return `ssh://${authority}${cut <= 0 ? '/' : path.slice(0, cut)}`;
  }
  return null;
}

/** Junta pasta remota + nome. */
export function joinRemote(dir, name) {
  return `${String(dir).replace(/\/+$/, '')}/${String(name).replace(/^\/+/, '')}`;
}
