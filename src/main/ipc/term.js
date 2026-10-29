/**
 * IPC: terminal (term:*). Spawna o shell do sistema, sem pty (Fase 4 troca por node-pty).
 */

const os = require('os');
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
  ipcMain.handle('term:create', (evt, _cols = 80, _rows = 24) => {
    const id = `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const shellPath = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    const cwd = os.homedir();

    const proc = spawn(shellPath, [], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      shell: false,
    });

    shells.set(id, proc);

    const send = (channel, ...args) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, ...args);
    };
    proc.stdout.on('data', (data) => send('term:data', id, data.toString()));
    proc.stderr.on('data', (data) => send('term:data', id, data.toString()));
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

  ipcMain.handle('term:kill', (_evt, id) => {
    const proc = shells.get(id);
    if (proc) {
      proc.kill();
      shells.delete(id);
    }
    return true;
  });
}

module.exports = { register, killAll };
