/**
 * Provider de workspace local (disco). Mesma interface do provider SSH
 * (providers/ssh.js); ver provider-for.js.
 *
 *  readDir(p) → [{ name, path, isDirectory, isFile }]
 *  readFile(p, enc?) → Buffer | string        readBinary(p) → Buffer
 *  createReadStream(p, { start, end }) → Readable
 *  writeFile(p, data)  stat(p) → { isDirectory, isFile, size, mtime } (lança ENOENT)
 *  mkdir(p)  remove(p)  rename(a, b)  exists(p) → boolean
 *  exec(cmd, args, { cwd, env, signal, onData, timeoutMs, input }) → { code, stdout, stderr }
 *  spawnShell — terminal local continua no node-pty (ipc/term.js).
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const childProcess = require('child_process');

const localProvider = {
  kind: 'local',
  remote: false,

  async readDir(p) {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, path: path.join(p, e.name), isDirectory: e.isDirectory(), isFile: e.isFile() }));
  },

  readFile(p, enc) {
    return enc ? fsp.readFile(p, enc) : fsp.readFile(p);
  },

  readBinary(p) {
    return fsp.readFile(p);
  },

  createReadStream(p, { start, end } = {}) {
    return fs.createReadStream(p, { start, end });
  },

  writeFile(p, data) {
    return fsp.writeFile(p, data, typeof data === 'string' ? 'utf-8' : undefined);
  },

  async stat(p) {
    const s = await fsp.stat(p);
    return { isDirectory: s.isDirectory(), isFile: s.isFile(), size: s.size, mtime: s.mtimeMs };
  },

  mkdir(p) {
    return fsp.mkdir(p, { recursive: true });
  },

  remove(p) {
    return fsp.rm(p, { recursive: true, force: true });
  },

  rename(a, b) {
    return fsp.rename(a, b);
  },

  async exists(p) {
    try { await fsp.access(p); return true; } catch { return false; }
  },

  join: (...parts) => path.join(...parts),

  exec(cmd, args = [], { cwd, env, signal, onData, timeoutMs = 60_000, input } = {}) {
    return new Promise((resolve, reject) => {
      const child = childProcess.execFile(cmd, args, {
        cwd, env: env ? { ...process.env, ...env } : process.env, signal, timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8',
      }, (err, stdout, stderr) => {
        if (err && typeof err.code !== 'number') {
          if (err.code === 'ABORT_ERR' || err.name === 'AbortError') return reject(err);
          if (err.killed) return resolve({ code: null, stdout: stdout || '', stderr: stderr || '', timedOut: true });
          return reject(err);
        }
        resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
      });
      if (onData) {
        child.stdout?.on('data', (d) => onData(String(d), 'stdout'));
        child.stderr?.on('data', (d) => onData(String(d), 'stderr'));
      }
      if (input != null) child.stdin?.end(input);
    });
  },
};

module.exports = { localProvider };
