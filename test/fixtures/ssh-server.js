/**
 * Servidor SSH de teste (unit e e2e) com o `Server` do ssh2. Não depende do sshd.
 *
 * - Chave de host gerada na hora (ed25519) — `hostKey` (privada) e `hostPublic` (blob).
 * - Usuários: { nome: { password?, publicKeys?: [ 'ssh-ed25519 AAAA…' ] } }.
 * - SFTP sobre o sistema de arquivos real, restrito à pasta `root` (fora dela → negado).
 *   REALPATH resolve symlinks e READLINK lê o alvo (testes de link para fora da raiz
 *   do projeto: use um projeto numa subpasta de `root`).
 *   Os caminhos são os reais (/tmp/…/proj), para o exec enxergar os mesmos arquivos.
 * - exec: `/bin/sh -c <comando>` com cwd = root e HOME = root; cada comando fica em
 *   `execLog` (os testes conferem aspas e ausência de token).
 * - shell: `/bin/sh -i` sem pty.
 * - dropAll() derruba as conexões; stopListening()/listen() simulam o host fora do ar.
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { Server, utils } = require('ssh2');

const { STATUS_CODE, OPEN_MODE } = utils.sftp;

function generateKey(type = 'ed25519', opts) {
  return utils.generateKeyPairSync(type, opts);
}

/** Blob da chave pública (formato do known_hosts) a partir da privada. */
function publicBlob(privateKey) {
  const k = utils.parseKey(privateKey);
  return k.getPublicSSH();
}

function createSshServer({
  root,
  users = {},
  hostKey = generateKey().private,
  extraHostKeys = [],
  allowShell = true,
} = {}) {
  if (!root) throw new Error('root obrigatório');
  const realRoot = fs.realpathSync(root);
  const execLog = [];
  const envLog = [];
  const clients = new Set();
  const authLog = [];

  const allowedKeys = new Map(); // user → [parsed]
  for (const [name, u] of Object.entries(users)) {
    allowedKeys.set(name, (u.publicKeys || []).map((k) => utils.parseKey(k)));
  }

  function inside(p) {
    const abs = path.resolve(realRoot, String(p || '.'));
    let real = abs;
    try { real = fs.realpathSync(abs); } catch {
      try { real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { real = abs; }
    }
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    return abs;
  }

  function toAttrs(st) {
    return {
      mode: st.mode,
      uid: st.uid,
      gid: st.gid,
      size: st.size,
      atime: Math.floor(st.atimeMs / 1000),
      mtime: Math.floor(st.mtimeMs / 1000),
    };
  }

  function statusFor(err) {
    if (!err) return STATUS_CODE.OK;
    if (err.code === 'ENOENT') return STATUS_CODE.NO_SUCH_FILE;
    if (err.code === 'EACCES' || err.code === 'EPERM') return STATUS_CODE.PERMISSION_DENIED;
    return STATUS_CODE.FAILURE;
  }

  function setupSftp(sftp) {
    const handles = new Map();
    let nextHandle = 1;
    const newHandle = (value) => {
      const id = nextHandle++;
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(id);
      handles.set(id, value);
      return buf;
    };
    const getHandle = (buf) => (buf && buf.length === 4 ? handles.get(buf.readUInt32BE(0)) : undefined);
    const delHandle = (buf) => handles.delete(buf.readUInt32BE(0));
    const guard = (reqid, p) => {
      const abs = inside(p);
      if (!abs) sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED, 'fora da raiz');
      return abs;
    };

    // Como o sftp-server: resolve symlinks; caminho inexistente → NO_SUCH_FILE.
    sftp.on('REALPATH', (reqid, p) => {
      const abs = p === '.' || p === '' ? realRoot : inside(p);
      if (!abs) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
      let real;
      try { real = fs.realpathSync(abs); } catch (err) { return sftp.status(reqid, statusFor(err)); }
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
      sftp.name(reqid, [{ filename: real, longname: real, attrs: {} }]);
    });
    sftp.on('READLINK', (reqid, p) => {
      const abs = guard(reqid, p);
      if (!abs) return;
      try {
        const target = fs.readlinkSync(abs);
        sftp.name(reqid, [{ filename: target, longname: target, attrs: {} }]);
      } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    const doStat = (reqid, p, fn) => {
      const abs = guard(reqid, p);
      if (!abs) return;
      try { sftp.attrs(reqid, toAttrs(fn(abs))); } catch (err) { sftp.status(reqid, statusFor(err)); }
    };
    sftp.on('STAT', (reqid, p) => doStat(reqid, p, fs.statSync));
    sftp.on('LSTAT', (reqid, p) => doStat(reqid, p, fs.lstatSync));
    sftp.on('FSTAT', (reqid, h) => {
      const fh = getHandle(h);
      if (!fh || fh.fd == null) return sftp.status(reqid, STATUS_CODE.FAILURE);
      sftp.attrs(reqid, toAttrs(fs.fstatSync(fh.fd)));
    });
    sftp.on('OPEN', (reqid, p, flags) => {
      const abs = guard(reqid, p);
      if (!abs) return;
      let mode = 'r';
      if (flags & OPEN_MODE.WRITE) {
        if (flags & OPEN_MODE.APPEND) mode = 'a';
        else if (flags & OPEN_MODE.TRUNC) mode = (flags & OPEN_MODE.READ) ? 'w+' : 'w';
        else mode = (flags & OPEN_MODE.CREAT) ? (fs.existsSync(abs) ? 'r+' : 'w+') : 'r+';
        if (flags & OPEN_MODE.EXCL) mode = 'wx';
      }
      try {
        const fd = fs.openSync(abs, mode);
        sftp.handle(reqid, newHandle({ fd }));
      } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    sftp.on('READ', (reqid, h, offset, length) => {
      const fh = getHandle(h);
      if (!fh || fh.fd == null) return sftp.status(reqid, STATUS_CODE.FAILURE);
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fh.fd, buf, 0, length, offset);
      if (n === 0) return sftp.status(reqid, STATUS_CODE.EOF);
      sftp.data(reqid, buf.subarray(0, n));
    });
    sftp.on('WRITE', (reqid, h, offset, data) => {
      const fh = getHandle(h);
      if (!fh || fh.fd == null) return sftp.status(reqid, STATUS_CODE.FAILURE);
      try {
        fs.writeSync(fh.fd, data, 0, data.length, offset);
        sftp.status(reqid, STATUS_CODE.OK);
      } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    sftp.on('CLOSE', (reqid, h) => {
      const fh = getHandle(h);
      if (!fh) return sftp.status(reqid, STATUS_CODE.FAILURE);
      if (fh.fd != null) { try { fs.closeSync(fh.fd); } catch { /* já fechado */ } }
      delHandle(h);
      sftp.status(reqid, STATUS_CODE.OK);
    });
    sftp.on('OPENDIR', (reqid, p) => {
      const abs = guard(reqid, p);
      if (!abs) return;
      try {
        const names = fs.readdirSync(abs);
        sftp.handle(reqid, newHandle({ dir: abs, names, done: false }));
      } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    sftp.on('READDIR', (reqid, h) => {
      const dh = getHandle(h);
      if (!dh || !dh.dir) return sftp.status(reqid, STATUS_CODE.FAILURE);
      if (dh.done) return sftp.status(reqid, STATUS_CODE.EOF);
      dh.done = true;
      const list = [];
      for (const name of dh.names) {
        try {
          const st = fs.lstatSync(path.join(dh.dir, name));
          list.push({ filename: name, longname: name, attrs: toAttrs(st) });
        } catch { /* sumiu */ }
      }
      if (!list.length) return sftp.status(reqid, STATUS_CODE.EOF);
      sftp.name(reqid, list);
    });
    const simple = (event, fn) => sftp.on(event, (reqid, ...args) => {
      try { fn(...args); sftp.status(reqid, STATUS_CODE.OK); } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    sftp.on('MKDIR', (reqid, p) => {
      const abs = guard(reqid, p);
      if (!abs) return;
      try { fs.mkdirSync(abs); sftp.status(reqid, STATUS_CODE.OK); } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    sftp.on('RMDIR', (reqid, p) => {
      const abs = guard(reqid, p);
      if (!abs) return;
      try { fs.rmdirSync(abs); sftp.status(reqid, STATUS_CODE.OK); } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    sftp.on('REMOVE', (reqid, p) => {
      const abs = guard(reqid, p);
      if (!abs) return;
      try { fs.unlinkSync(abs); sftp.status(reqid, STATUS_CODE.OK); } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    sftp.on('RENAME', (reqid, a, b) => {
      const src = inside(a);
      const dst = inside(b);
      if (!src || !dst) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
      if (fs.existsSync(dst)) return sftp.status(reqid, STATUS_CODE.FAILURE, 'destino existe');
      try { fs.renameSync(src, dst); sftp.status(reqid, STATUS_CODE.OK); } catch (err) { sftp.status(reqid, statusFor(err)); }
    });
    simple('SETSTAT', () => {});
    simple('FSETSTAT', () => {});
  }

  function runProcess(channel, file, args, env) {
    const child = childProcess.spawn(file, args, {
      cwd: realRoot,
      env: { ...process.env, HOME: realRoot, ...env },
    });
    channel.on('data', (d) => { try { child.stdin.write(d); } catch { /* fechado */ } });
    channel.on('end', () => { try { child.stdin.end(); } catch { /* fechado */ } });
    channel.on('close', () => { try { child.kill('SIGKILL'); } catch { /* já saiu */ } });
    child.stdout.on('data', (d) => { try { channel.write(d); } catch { /* fechado */ } });
    child.stderr.on('data', (d) => { try { channel.stderr.write(d); } catch { /* fechado */ } });
    child.on('error', () => { try { channel.exit(127); channel.end(); } catch { /* fechado */ } });
    child.on('close', (code) => {
      try { channel.exit(code == null ? 1 : code); channel.end(); } catch { /* fechado */ }
    });
  }

  const server = new Server({ hostKeys: [hostKey, ...extraHostKeys] }, (client) => {
    clients.add(client);
    client.on('close', () => clients.delete(client));
    client.on('error', () => {});
    client.on('authentication', (ctx) => {
      const user = users[ctx.username];
      authLog.push({ user: ctx.username, method: ctx.method });
      if (!user) return ctx.reject(['publickey', 'password']);
      if (ctx.method === 'password') {
        if (user.password != null && ctx.password === user.password) return ctx.accept();
        return ctx.reject(['publickey', 'password']);
      }
      if (ctx.method === 'publickey') {
        const keys = allowedKeys.get(ctx.username) || [];
        const match = keys.find((k) => k.type === ctx.key.algo && k.getPublicSSH().equals(ctx.key.data));
        if (!match) return ctx.reject(['publickey', 'password']);
        if (!ctx.signature) return ctx.accept(); // só consulta: "esta chave serve?"
        if (match.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true) return ctx.accept();
        return ctx.reject(['publickey', 'password']);
      }
      return ctx.reject(['publickey', 'password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        const env = {};
        session.on('env', (acc, _rej, info) => { env[info.key] = info.val; envLog.push(info); acc?.(); });
        session.on('pty', (acc) => acc?.());
        session.on('window-change', (acc) => acc?.());
        session.on('sftp', (acc) => setupSftp(acc()));
        session.on('exec', (acc, _rej, info) => {
          execLog.push(info.command);
          runProcess(acc(), '/bin/sh', ['-c', info.command], env);
        });
        session.on('shell', (acc, rej) => {
          if (!allowShell) return rej();
          runProcess(acc(), '/bin/sh', ['-i'], env);
        });
      });
    });
  });

  let port = 0;
  function listen(p = port) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(p, '127.0.0.1', () => {
        server.off('error', reject);
        port = server.address().port;
        resolve(port);
      });
    });
  }

  return {
    get port() { return port; },
    root: realRoot,
    hostKey,
    hostPublic: publicBlob(hostKey),
    execLog,
    envLog,
    authLog,
    listen,
    clientCount: () => clients.size,
    dropAll() { for (const c of clients) { try { c.end(); } catch { /* já caiu */ } } },
    stopListening() { return new Promise((r) => server.close(() => r())); },
    async close() {
      for (const c of clients) { try { c.end(); } catch { /* já caiu */ } }
      await new Promise((r) => server.close(() => r()));
    },
  };
}

module.exports = { createSshServer, generateKey, publicBlob };
