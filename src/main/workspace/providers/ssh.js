/**
 * Provider de workspace SSH: mesma interface do local (providers/local.js),
 * sobre a conexão da janela (remote/manager.js). Caminhos de entrada e saída
 * são URIs `ssh://<authority>/<caminho>`; a authority tem de ser a deste provider.
 *
 * Arquivos via SFTP (sem shell). exec/spawnShell montam a linha de comando só
 * com remote/sh.js (aspas POSIX em tudo).
 *
 * Contenção de symlinks (ponto único para fs IPC, agente, histórico, Árvore, Ao
 * Vivo, visualizadores): com `getRoots` (raízes liberadas na janela), toda
 * operação de arquivo resolve o alvo com `sftp.realpath` (arquivo novo ou link
 * quebrado: o pai / o alvo do link) e exige que ele fique dentro do realpath de
 * uma raiz deste host (cacheado por conexão SFTP). Fora → EACCES "Acesso negado".
 * Na escrita/remoção/rename o alvo é o caminho com os links seguidos, então um
 * link que aponta para fora é recusado. Sem raiz deste host na janela, não há
 * contenção (o guard da janela já nega tudo; workspace:open usa statRaw).
 */

const path = require('path');
const { parseRemoteUri, toRemoteUri } = require('../remote-uri');
const { buildCommand, shQuote } = require('../../remote/sh');

const MAX_EXEC_BUFFER = 64 * 1024 * 1024;

function sftpError(err, p) {
  if (!err) return err;
  const e = new Error(err.message || String(err));
  if (err.code === 2) e.code = 'ENOENT';
  else if (err.code === 3) e.code = 'EACCES';
  else e.code = err.code;
  e.path = p;
  return e;
}

function accessDenied(uri) {
  return Object.assign(new Error(`Acesso negado: ${uri} aponta para fora da pasta remota aberta`), {
    code: 'EACCES', outsideRoot: true, path: uri,
  });
}

const withinPosix = (root, p) => root === '/' || p === root || p.startsWith(`${root}/`);

function createSshProvider({ manager, ownerId, authority, getRoots = null }) {
  const toPath = (uri) => {
    const r = parseRemoteUri(uri);
    if (!r || r.authority !== authority) throw new Error(`Caminho remoto inválido: ${uri}`);
    return r.path;
  };
  const toUri = (p) => toRemoteUri(authority, p);
  const sftp = () => manager.sftp(ownerId, authority);
  const raw = (s, method, p, ...args) => new Promise((resolve, reject) => {
    s[method](p, ...args, (err, res) => (err ? reject(sftpError(err, toUri(p))) : resolve(res)));
  });

  // ---- contenção (ver o cabeçalho)
  const rootReal = new WeakMap(); // sftp → Map(caminho da raiz → Promise<realpath>)
  function rootPaths() {
    if (typeof getRoots !== 'function') return null;
    const out = [];
    for (const u of getRoots() || []) {
      const r = parseRemoteUri(u);
      if (r && r.authority === authority) out.push(r.path);
    }
    return out.length ? out : null;
  }
  /** Caminho real no host: segue links; inexistente → pai real + nome; link quebrado → alvo. */
  async function realOf(s, p, depth = 0) {
    if (depth > 40) throw Object.assign(new Error(`Links demais: ${p}`), { code: 'ELOOP' });
    try { return await raw(s, 'realpath', p); } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    let lst = null;
    try { lst = await raw(s, 'lstat', p); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    if (lst && typeof lst.isSymbolicLink === 'function' && lst.isSymbolicLink()) {
      const target = await raw(s, 'readlink', p);
      const abs = String(target).startsWith('/') ? String(target) : path.posix.join(path.posix.dirname(p), String(target));
      return realOf(s, path.posix.normalize(abs), depth + 1);
    }
    const parent = path.posix.dirname(p);
    if (parent === p) return p;
    return path.posix.join(await realOf(s, parent, depth + 1), path.posix.basename(p));
  }
  function realRootOf(s, rootPath) {
    let m = rootReal.get(s);
    if (!m) { m = new Map(); rootReal.set(s, m); }
    if (!m.has(rootPath)) {
      const pr = realOf(s, rootPath);
      pr.catch(() => m.delete(rootPath));
      m.set(rootPath, pr);
    }
    return m.get(rootPath);
  }
  async function confine(s, p) {
    const roots = rootPaths();
    if (!roots) return;
    let real;
    try { real = await realOf(s, p); } catch (err) {
      if (err.code === 'EACCES' || err.code === 'ELOOP') throw accessDenied(toUri(p));
      throw err;
    }
    for (const r of roots) {
      const rr = await realRootOf(s, r).catch(() => null);
      if (rr && withinPosix(rr, real)) return;
    }
    throw accessDenied(toUri(p));
  }

  const call = async (method, uri, ...args) => {
    const s = await sftp();
    const p = toPath(uri);
    await confine(s, p);
    return raw(s, method, p, ...args);
  };
  const statOf = (attrs) => ({
    isDirectory: attrs.isDirectory(),
    isFile: attrs.isFile(),
    isSymbolicLink: typeof attrs.isSymbolicLink === 'function' ? attrs.isSymbolicLink() : false,
    size: Number(attrs.size) || 0,
    mtime: (Number(attrs.mtime) || 0) * 1000,
  });

  const provider = {
    kind: 'ssh',
    remote: true,
    authority,
    ownerId,

    async readDir(uri) {
      const list = await call('readdir', uri);
      const base = toPath(uri);
      const out = [];
      for (const e of list) {
        const full = path.posix.join(base, e.filename);
        let st = statOf(e.attrs);
        if (st.isSymbolicLink) {
          try { st = await provider.stat(toUri(full)); } catch { /* link quebrado: fica como arquivo */ }
        }
        out.push({ name: e.filename, path: toUri(full), isDirectory: st.isDirectory, isFile: st.isFile || (!st.isDirectory) });
      }
      return out;
    },

    async readFile(uri, enc) {
      const buf = await call('readFile', uri);
      return enc ? buf.toString(enc) : buf;
    },

    readBinary(uri) {
      return provider.readFile(uri);
    },

    async createReadStream(uri, { start, end } = {}) {
      const s = await sftp();
      await confine(s, toPath(uri));
      return s.createReadStream(toPath(uri), { start, end });
    },

    async writeFile(uri, data) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
      await call('writeFile', uri, buf);
    },

    async stat(uri) {
      return statOf(await call('stat', uri));
    },

    /** stat sem contenção: só para workspace:open (a pasta nova ainda não é raiz). */
    async statRaw(uri) {
      const s = await sftp();
      return statOf(await raw(s, 'stat', toPath(uri)));
    },

    /** Caminho real (links seguidos) como URI. Sem contenção: quem chama confere. */
    async realpath(uri) {
      const s = await sftp();
      return toUri(await realOf(s, toPath(uri)));
    },

    async exists(uri) {
      try { await provider.stat(uri); return true; } catch { return false; }
    },

    async mkdir(uri) {
      // mkdir -p de dentro para fora: só sobe enquanto o pai não existe (não depende
      // de poder ler as pastas acima do workspace).
      let st = null;
      try { st = await provider.stat(uri); } catch (err) { if (err.code !== 'ENOENT') throw err; }
      if (st) {
        if (st.isDirectory) return;
        throw Object.assign(new Error(`Já existe um arquivo em ${toPath(uri)}`), { code: 'EEXIST' });
      }
      const parent = path.posix.dirname(toPath(uri));
      if (parent !== toPath(uri)) await provider.mkdir(toUri(parent));
      try {
        await call('mkdir', uri);
      } catch (err) {
        const again = await provider.stat(uri).catch(() => null);
        if (!again || !again.isDirectory) throw err;
      }
    },

    async remove(uri) {
      const p = toPath(uri);
      if (p === '/') throw new Error('Não é permitido apagar a raiz do host.');
      const s = await sftp();
      let st;
      try { st = statOf(await raw(s, 'lstat', p)); } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      // Alvo (com links seguidos) tem de estar dentro da raiz; link para fora é recusado.
      await confine(s, p);
      // Dentro da pasta: links são apagados sem seguir (unlink), pastas reais recursivas.
      const removeInner = async (q, isDir) => {
        if (isDir) {
          for (const e of await raw(s, 'readdir', q)) {
            const child = path.posix.join(q, e.filename);
            const cst = statOf(e.attrs);
            await removeInner(child, cst.isDirectory && !cst.isSymbolicLink);
          }
          await raw(s, 'rmdir', q);
        } else {
          await raw(s, 'unlink', q);
        }
      };
      await removeInner(p, st.isDirectory && !st.isSymbolicLink);
    },

    async rename(a, b) {
      const s = await sftp();
      const pa = toPath(a);
      const pb = toPath(b);
      await confine(s, pa);
      await confine(s, pb);
      await new Promise((resolve, reject) => s.rename(pa, pb, (err) => (err ? reject(sftpError(err, a)) : resolve())));
    },

    join(base, ...parts) {
      return toUri(path.posix.join(toPath(base), ...parts));
    },

    /** Caminho POSIX do host (para comandos). */
    pathOf: toPath,
    uriOf: toUri,

    /**
     * Roda um comando no host (cmd e args entre aspas POSIX). cwd é URI ou caminho POSIX.
     * → { code, stdout, stderr, timedOut? }
     */
    async exec(cmd, args = [], { cwd, env, signal, onData, timeoutMs = 60_000, input } = {}) {
      const entry = await manager.ensure(ownerId, authority);
      const remoteCwd = cwd ? (String(cwd).startsWith('ssh://') ? toPath(cwd) : String(cwd)) : undefined;
      const command = buildCommand(cmd, args, { cwd: remoteCwd, env });
      return runCommand(entry.client, command, { signal, onData, timeoutMs, input });
    },

    /** Linha de comando já montada (só para scripts internos com shQuote em tudo). */
    async execRaw(command, opts = {}) {
      const entry = await manager.ensure(ownerId, authority);
      return runCommand(entry.client, command, opts);
    },

    /**
     * Shell interativo no host já na pasta (pty xterm-256color).
     * → { write(data), resize(cols, rows), kill(), onData(cb), onExit(cb) }
     */
    async spawnShell({ cols = 80, rows = 24, cwd } = {}) {
      const entry = await manager.ensure(ownerId, authority);
      const dir = cwd ? toPath(cwd) : null;
      const command = `${dir ? `cd ${shQuote(dir)} && ` : ''}exec "\${SHELL:-/bin/sh}" -l`;
      const channel = await new Promise((resolve, reject) => {
        entry.client.exec(command, { pty: { term: 'xterm-256color', cols, rows } }, (err, ch) => (err ? reject(err) : resolve(ch)));
      });
      const dataCbs = [];
      const exitCbs = [];
      let exited = false;
      const emitExit = (code) => {
        if (exited) return;
        exited = true;
        for (const cb of exitCbs) { try { cb(code); } catch { /* ignora */ } }
      };
      let exitCode = 0;
      channel.on('data', (d) => { for (const cb of dataCbs) cb(d.toString('utf8')); });
      channel.stderr.on('data', (d) => { for (const cb of dataCbs) cb(d.toString('utf8')); });
      channel.on('exit', (code) => { if (typeof code === 'number') exitCode = code; });
      channel.on('close', () => emitExit(exitCode));
      return {
        write: (data) => { try { channel.write(data); } catch { /* fechado */ } },
        resize: (c, r) => { try { channel.setWindow(r, c, 0, 0); } catch { /* fechado */ } },
        kill: () => { try { channel.close(); } catch { /* fechado */ } },
        onData: (cb) => dataCbs.push(cb),
        onExit: (cb) => exitCbs.push(cb),
      };
    },
  };
  return provider;
}

function runCommand(client, command, { signal, onData, timeoutMs = 60_000, input } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Cancelado'), { name: 'AbortError', code: 'ABORT_ERR' }));
    client.exec(command, (err, channel) => {
      if (err) return reject(err);
      const out = [];
      const errOut = [];
      let size = 0;
      let code = null;
      let done = false;
      let timedOut = false;
      const finish = (fn) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); fn(); };
      const timer = timeoutMs ? setTimeout(() => { timedOut = true; try { channel.close(); } catch { /* fechado */ } }, timeoutMs) : null;
      const onAbort = () => {
        try { channel.close(); } catch { /* fechado */ }
        finish(() => reject(Object.assign(new Error('Cancelado'), { name: 'AbortError', code: 'ABORT_ERR' })));
      };
      signal?.addEventListener?.('abort', onAbort, { once: true });
      channel.on('data', (d) => {
        size += d.length;
        if (size <= MAX_EXEC_BUFFER) out.push(d);
        onData?.(d.toString('utf8'), 'stdout');
      });
      channel.stderr.on('data', (d) => {
        if (size <= MAX_EXEC_BUFFER) errOut.push(d);
        onData?.(d.toString('utf8'), 'stderr');
      });
      channel.on('exit', (c) => { if (typeof c === 'number') code = c; });
      channel.on('close', () => finish(() => resolve({
        code: timedOut ? null : code,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(errOut).toString('utf8'),
        ...(timedOut ? { timedOut: true } : {}),
      })));
      if (input != null) channel.end(input);
      else channel.end();
    });
  });
}

module.exports = { createSshProvider };
