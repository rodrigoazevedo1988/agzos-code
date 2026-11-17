/**
 * Provider de workspace SSH: mesma interface do local (providers/local.js),
 * sobre a conexão da janela (remote/manager.js). Caminhos de entrada e saída
 * são URIs `ssh://<authority>/<caminho>`; a authority tem de ser a deste provider.
 *
 * Arquivos via SFTP (sem shell). exec/spawnShell montam a linha de comando só
 * com remote/sh.js (aspas POSIX em tudo).
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

function createSshProvider({ manager, ownerId, authority }) {
  const toPath = (uri) => {
    const r = parseRemoteUri(uri);
    if (!r || r.authority !== authority) throw new Error(`Caminho remoto inválido: ${uri}`);
    return r.path;
  };
  const toUri = (p) => toRemoteUri(authority, p);
  const sftp = () => manager.sftp(ownerId, authority);
  const call = async (method, uri, ...args) => {
    const s = await sftp();
    const p = toPath(uri);
    return new Promise((resolve, reject) => {
      s[method](p, ...args, (err, res) => (err ? reject(sftpError(err, uri)) : resolve(res)));
    });
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
      return s.createReadStream(toPath(uri), { start, end });
    },

    async writeFile(uri, data) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf-8');
      await call('writeFile', uri, buf);
    },

    async stat(uri) {
      return statOf(await call('stat', uri));
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
      if (toPath(uri) === '/') throw new Error('Não é permitido apagar a raiz do host.');
      let st;
      try { st = statOf(await call('lstat', uri)); } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      if (st.isDirectory && !st.isSymbolicLink) {
        const list = await call('readdir', uri);
        for (const e of list) await provider.remove(toUri(path.posix.join(toPath(uri), e.filename)));
        await call('rmdir', uri);
      } else {
        await call('unlink', uri);
      }
    },

    async rename(a, b) {
      const s = await sftp();
      const pa = toPath(a);
      const pb = toPath(b);
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
