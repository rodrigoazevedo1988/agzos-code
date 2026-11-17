/**
 * IPC: atalho de SSH (ssh:*).
 *
 * - ssh:hosts      → hosts do ~/.ssh/config (com Include), só aliases seguros
 * - ssh:addHost    → acrescenta um bloco Host (append; nunca reescreve o resto)
 * - ssh:configPath → garante ~/.ssh/config e libera SÓ esse arquivo no guard
 * - ssh:parseTarget→ validação de "usuario@host[:porta]" para o renderer
 *
 * A conexão em si é um terminal (term:create com { ssh }), ver ipc/term.js.
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { collectHosts, appendHost, parseTarget, isSafeAlias } = require('../lib/ssh-config');
const { findSsh } = require('./term');

const IS_WIN = process.platform === 'win32';

function register(ipcMain, { guard, home = () => os.homedir() } = {}) {
  const sshDir = () => path.join(home(), '.ssh');
  const configPath = () => path.join(sshDir(), 'config');

  async function ensureSshDir() {
    try {
      await fsp.mkdir(sshDir(), { mode: 0o700 });
      if (!IS_WIN) await fsp.chmod(sshDir(), 0o700); // umask pode ter tirado bits
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async function ensureConfig() {
    await ensureSshDir();
    try {
      await fsp.writeFile(configPath(), '', { flag: 'wx', mode: 0o600 });
      if (!IS_WIN) await fsp.chmod(configPath(), 0o600);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    return configPath();
  }

  ipcMain.handle('ssh:hosts', () => {
    const hosts = collectHosts({
      home: home(),
      configPath: configPath(),
      fs: {
        readFile: (p) => {
          const st = fs.statSync(p);
          if (!st.isFile() || st.size > 1024 * 1024) throw new Error('ignorado');
          return fs.readFileSync(p, 'utf8');
        },
        readDir: (d) => fs.readdirSync(d),
      },
    }).filter((h) => isSafeAlias(h.host));
    return { configPath: configPath(), hosts, sshAvailable: !!findSsh() };
  });

  ipcMain.handle('ssh:parseTarget', (_evt, input) => parseTarget(input));

  ipcMain.handle('ssh:addHost', async (_evt, input) => {
    try {
      if (!input || typeof input !== 'object') throw new Error('Dados do host ausentes.');
      const target = parseTarget(input.target);
      if (!target) throw new Error('Use o formato usuario@host ou usuario@host:porta.');
      const alias = typeof input.alias === 'string' ? input.alias.trim() : '';
      let before = '';
      try { before = await fsp.readFile(configPath(), 'utf8'); } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      const after = appendHost(before, { alias, hostName: target.host, user: target.user, port: target.port });
      const suffix = after.slice(before.length);
      await ensureSshDir();
      if (before) {
        await fsp.appendFile(configPath(), suffix, 'utf8');
      } else {
        // Arquivo novo (ou vazio): cria com 600 sem sobrescrever um existente.
        try {
          await fsp.writeFile(configPath(), suffix, { flag: 'wx', mode: 0o600, encoding: 'utf8' });
          if (!IS_WIN) await fsp.chmod(configPath(), 0o600);
        } catch (err) {
          if (err.code !== 'EEXIST') throw err;
          await fsp.appendFile(configPath(), suffix, 'utf8');
        }
      }
      return { ok: true, alias, configPath: configPath() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ssh:configPath', async () => {
    const p = await ensureConfig();
    if (guard) guard.allow(p);
    return p;
  });
}

module.exports = { register };
