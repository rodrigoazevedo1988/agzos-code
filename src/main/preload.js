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

  // Segredos (cofre do SO). Não há get: o valor nunca vai para o renderer.
  secrets: {
    set: (key, value) => ipcRenderer.invoke('secrets:set', key, value),
    delete: (key) => ipcRenderer.invoke('secrets:delete', key),
    has: (key) => ipcRenderer.invoke('secrets:has', key),
  },

  ai: {
    presets: () => ipcRenderer.invoke('ai:presets'),
    profiles: () => ipcRenderer.invoke('ai:profiles'),
    saveProfile: (profile, apiKey) => ipcRenderer.invoke('ai:profile:save', profile, apiKey),
    removeProfile: (id) => ipcRenderer.invoke('ai:profile:remove', id),
    activateProfile: (id) => ipcRenderer.invoke('ai:profile:activate', id),
    models: (idOrDraft, apiKey) => ipcRenderer.invoke('ai:models', idOrDraft, apiKey),
    test: (draft, apiKey) => ipcRenderer.invoke('ai:test', draft, apiKey),
    detectOllama: () => ipcRenderer.invoke('ai:detectOllama'),
    chat: (requestId, payload) => ipcRenderer.invoke('ai:chat', requestId, payload),
    cancel: (requestId) => ipcRenderer.invoke('ai:cancel', requestId),
    onChunk: (cb) => {
      const handler = (_event, id, text) => cb(id, text);
      ipcRenderer.on('ai:chunk', handler);
      return () => ipcRenderer.removeListener('ai:chunk', handler);
    },
    onDone: (cb) => {
      const handler = (_event, id) => cb(id);
      ipcRenderer.on('ai:done', handler);
      return () => ipcRenderer.removeListener('ai:done', handler);
    },
    onError: (cb) => {
      const handler = (_event, id, message) => cb(id, message);
      ipcRenderer.on('ai:error', handler);
      return () => ipcRenderer.removeListener('ai:error', handler);
    },
  },

  chat: {
    loadHistory: (root) => ipcRenderer.invoke('chat:history:load', root),
    saveHistory: (root, messages) => ipcRenderer.invoke('chat:history:save', root, messages),
  },

  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onNotice: (cb) => {
      const handler = (_event, notice) => cb(notice);
      ipcRenderer.on('update:notice', handler);
      return () => ipcRenderer.removeListener('update:notice', handler);
    },
  },

  // Workspace (libera a pasta no guard de arquivos)
  workspace: {
    open: (p) => ipcRenderer.invoke('workspace:open', p),
  },

  // Settings
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (s) => ipcRenderer.invoke('settings:save', s),
    importVSCode: (editor) => ipcRenderer.invoke('settings:import-vscode', editor),
  },

  // Menu events (main → renderer)
  onMenu: (cb) => {
    const channels = [
      'menu:open-folder',
      'menu:save',
      'menu:command-palette',
      'menu:toggle-terminal',
      'menu:toggle-sidebar',
      'menu:check-updates',
      'menu:open-settings',
    ];
    const handler = (channel) => (_e, ...args) => cb(channel, ...args);
    const handlers = channels.map((ch) => {
      const h = handler(ch);
      ipcRenderer.on(ch, h);
      return [ch, h];
    });
    return () => handlers.forEach(([ch, h]) => ipcRenderer.removeListener(ch, h));
  },
});
