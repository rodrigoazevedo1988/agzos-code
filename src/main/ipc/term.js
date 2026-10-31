/**
 * IPC: terminal (term:*).
 *
 * Usa pty real (node-pty) quando disponível, com fallback para pipes — ver
 * src/main/lib/terminal-session.js. Com pty, `cls`/`clear`, o eco do que é
 * digitado, cores e Ctrl+C funcionam como num terminal de verdade.
 */

const { createTerminalSession } = require('../lib/terminal-session');

// Sessões vivas por id. Exportado para encerrar tudo ao fechar o app.
const sessions = new Map();

function killAll() {
  for (const session of sessions.values()) {
    session.kill();
  }
  sessions.clear();
}

function register(ipcMain) {
  ipcMain.handle('term:create', (evt, cols = 80, rows = 24) => {
    const id = `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const send = (channel, ...args) => {
      if (!evt.sender.isDestroyed()) evt.sender.send(channel, ...args);
    };

    const session = createTerminalSession({
      id,
      cols,
      rows,
      onData: (data) => send('term:data', id, data),
      onExit: (code) => {
        send('term:exit', id, code);
        sessions.delete(id);
      },
    });

    sessions.set(id, session);

    return {
      id,
      cwd: session.cwd,
      shell: session.shell,
      pid: session.pid,
      // 'pty' = terminal completo; 'pipe' = modo degradado (sem echo/cores).
      mode: session.mode,
    };
  });

  ipcMain.handle('term:write', (_evt, id, data) => {
    const session = sessions.get(id);
    if (!session) return false;
    return session.write(data);
  });

  ipcMain.handle('term:resize', (_evt, id, cols, rows) => {
    const session = sessions.get(id);
    if (!session) return false;
    return session.resize(cols, rows);
  });

  ipcMain.handle('term:kill', (_evt, id) => {
    const session = sessions.get(id);
    if (session) {
      session.kill();
      sessions.delete(id);
    }
    return true;
  });
}

module.exports = { register, killAll };
