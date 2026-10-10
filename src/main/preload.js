/**
 * Agzos Code — preload
 *
 * Expõe uma API controlada e auditável ao renderer via contextBridge.
 * O renderer NUNCA tem acesso direto a `require`, `process` ou `fs`.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agzos', {
  // App info
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  },

  // File system
  fs: {
    readDir: (p) => ipcRenderer.invoke('fs:readDir', p),
    readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
    writeFile: (p, c) => ipcRenderer.invoke('fs:writeFile', p, c),
    mkdir: (p) => ipcRenderer.invoke('fs:mkdir', p),
    exists: (p) => ipcRenderer.invoke('fs:exists', p),
    stat: (p) => ipcRenderer.invoke('fs:stat', p),
    delete: (p) => ipcRenderer.invoke('fs:delete', p),
    rename: (a, b) => ipcRenderer.invoke('fs:rename', a, b),
    homeDir: () => ipcRenderer.invoke('fs:homeDir'),
  },

  // Diálogos
  dialog: {
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (defaultPath) => ipcRenderer.invoke('dialog:saveFile', defaultPath),
  },

  // Terminal
  term: {
    create: (cols, rows) => ipcRenderer.invoke('term:create', cols, rows),
    write: (id, data) => ipcRenderer.invoke('term:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('term:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('term:kill', id),
    onData: (cb) => {
      const handler = (_e, id, data) => cb(id, data);
      ipcRenderer.on('term:data', handler);
      return () => ipcRenderer.removeListener('term:data', handler);
    },
    onExit: (cb) => {
      const handler = (_e, id, code) => cb(id, code);
      ipcRenderer.on('term:exit', handler);
      return () => ipcRenderer.removeListener('term:exit', handler);
    },
  },

  // Settings
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s) => ipcRenderer.invoke('settings:save', s),
  },

  // Menu events (main → renderer)
  onMenu: (cb) => {
    const channels = ['menu:open-folder', 'menu:save', 'menu:command-palette', 'menu:toggle-terminal', 'menu:toggle-sidebar'];
    const handler = (channel) => (_e, ...args) => cb(channel, ...args);
    const handlers = channels.map((ch) => {
      const h = handler(ch);
      ipcRenderer.on(ch, h);
      return [ch, h];
    });
    return () => handlers.forEach(([ch, h]) => ipcRenderer.removeListener(ch, h));
  },
});
