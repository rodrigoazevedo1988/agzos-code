/**
 * IPC: terminal (term:*). Spawna o shell do sistema, sem pty (Fase 4 troca por node-pty).
 */

const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

// Processos de shell vivos, por id. Exportado para encerrar tudo ao fechar o app.
const shells = new Map();

function killAll() {
  for (const proc of shells.values()) {
    try { proc.kill(); } catch {}
  }
  shells.clear();
}

function register(ipcMain) {
  ipcMain.handle('term:create', (evt, _cols = 80, _rows = 24, options = {}) => {
    const id = `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    let shellPath;
    let shellArgs = [];

    if (process.platform === 'win32') {
      // No Windows, PowerShell com -NoExit ou CMD para manter o shell interativo
      const powerShell = 'powershell.exe';
      shellPath = options.shell || powerShell;
      if (shellPath.toLowerCase().includes('powershell')) {
        shellArgs = ['-NoExit', '-ExecutionPolicy', 'Bypass'];
      } else if (shellPath.toLowerCase().includes('cmd')) {
        shellArgs = [];
      }
    } else {
      shellPath = options.shell || process.env.SHELL || 'bash';
      shellArgs = ['-l'];
    }

    let cwd = options.cwd || os.homedir();
    try {
      if (options.cwd && (!fs.existsSync(options.cwd) || !fs.statSync(options.cwd).isDirectory())) {
        cwd = os.homedir();
      }
    } catch {
      cwd = os.homedir();
    }

    const send = (channel, ...args) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, ...args);
    };

    let proc;
    try {
      proc = spawn(shellPath, shellArgs, {
        cwd,
        env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        shell: false,
      });
    } catch (err) {
      setTimeout(() => {
        send('term:data', id, `\r\n\x1b[31m[Erro ao iniciar shell ${shellPath}: ${err.message}]\x1b[0m\r\n`);
      }, 50);
      return { id, cwd, error: err.message };
    }

    shells.set(id, proc);

    proc.on('error', (err) => {
      send('term:data', id, `\r\n\x1b[31m[Erro no processo do terminal: ${err.message}]\x1b[0m\r\n`);
      shells.delete(id);
    });

    if (proc.stdout) {
      proc.stdout.on('data', (data) => send('term:data', id, data.toString()));
    }
    if (proc.stderr) {
      proc.stderr.on('data', (data) => send('term:data', id, data.toString()));
    }

    proc.on('exit', (code) => {
      send('term:exit', id, code);
      shells.delete(id);
    });

    return { id, cwd };
  });

  ipcMain.handle('term:write', (_evt, id, data) => {
    const proc = shells.get(id);
    if (proc) proc.stdin.write(data);
    return true;
  });

  ipcMain.handle('term:resize', (_evt, _id, _cols, _rows) => {
    // xterm fit addon cuida do resize no renderer; manter handler pra API
    return true;
  });

  ipcMain.handle('term:kill', (_evt, _id) => {
    const proc = shells.get(_id);
    if (proc) {
      proc.kill();
      shells.delete(_id);
    }
    return true;
  });
}

module.exports = { register, killAll };
