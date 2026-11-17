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
    findFiles: (p, maxResults) => ipcRenderer.invoke('fs:findFiles', p, maxResults),
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
    profiles: () => ipcRenderer.invoke('term:profiles'),
    create: (cols, rows, options) => ipcRenderer.invoke('term:create', cols, rows, options),
    write: (id, data) => ipcRenderer.invoke('term:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('term:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('term:kill', id),
    clipboardRead: () => ipcRenderer.invoke('term:clipboard:read'),
    clipboardWrite: (text) => ipcRenderer.invoke('term:clipboard:write', text),
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

  // Portas TCP em escuta (aba PORTAS do painel).
  ports: {
    list: () => ipcRenderer.invoke('ports:list'),
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
    // Anexos: save({ name, bytes }) → { ok, attachment | error }; read(paths?) → [{ name, bytes | error }]
    // (sem caminhos abre o diálogo nativo; caminhos do Explorer passam pelo guard).
    saveAttachment: (file) => ipcRenderer.invoke('ai:attach:save', file),
    readAttachments: (paths) => ipcRenderer.invoke('ai:attach:read', paths),
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

  // Agente (tools no workspace). Eventos: (requestId, evt) — ver src/main/agent/loop.js.
  agent: {
    run: (requestId, payload) => ipcRenderer.invoke('agent:run', requestId, payload),
    approve: (requestId, callId, decision) => ipcRenderer.invoke('agent:approve', requestId, callId, decision),
    cancel: (requestId) => ipcRenderer.invoke('agent:cancel', requestId),
    undo: (checkpointId) => ipcRenderer.invoke('agent:undo', checkpointId),
    setMode: (mode) => ipcRenderer.invoke('agent:setMode', mode),
    // "Enviar agora": { id?, content, attachments? } → true se entra na execução em andamento.
    steer: (requestId, payload) => ipcRenderer.invoke('agent:steer', requestId, payload),
    // Skills (modos): lista { skills, warnings, userDir, projectDir }; nova skill → caminho do arquivo.
    skills: (payload) => ipcRenderer.invoke('agent:skills', payload),
    newSkill: () => ipcRenderer.invoke('agent:skills:new'),
    openSkillsFolder: () => ipcRenderer.invoke('agent:skills:openFolder'),
    onEvent: (cb) => {
      const handler = (_event, id, evt) => cb(id, evt);
      ipcRenderer.on('agent:event', handler);
      return () => ipcRenderer.removeListener('agent:event', handler);
    },
    // Ferramentas read_terminal/get_problems: o main pergunta, o renderer responde (cb pode ser async).
    onQuery: (cb) => {
      const handler = async (_event, id, what, args) => {
        let result = null;
        try { result = await cb(what, args); } catch { result = null; }
        ipcRenderer.invoke('agent:query:reply', id, result).catch(() => {});
      };
      ipcRenderer.on('agent:query', handler);
      return () => ipcRenderer.removeListener('agent:query', handler);
    },
  },

  // Módulos nativos — Vassoura de Produção (ipc/broom.js). Argumentos repassados como vêm.
  broom: {
    analyzeFile: (...args) => ipcRenderer.invoke('broom:analyzeFile', ...args),
    cleanFile: (...args) => ipcRenderer.invoke('broom:cleanFile', ...args),
    scanWorkspace: (...args) => ipcRenderer.invoke('broom:scanWorkspace', ...args),
    cleanWorkspace: (...args) => ipcRenderer.invoke('broom:cleanWorkspace', ...args),
    cancel: (...args) => ipcRenderer.invoke('broom:cancel', ...args),
    undo: (...args) => ipcRenderer.invoke('broom:undo', ...args),
    onEvent: (cb) => {
      const handler = (_event, id, evt) => cb(id, evt);
      ipcRenderer.on('broom:event', handler);
      return () => ipcRenderer.removeListener('broom:event', handler);
    },
  },

  // Módulos nativos — Cofre .env (ipc/envvault.js). Valores só chegam por reveal.
  envVault: {
    list: (...args) => ipcRenderer.invoke('envvault:list', ...args),
    reveal: (...args) => ipcRenderer.invoke('envvault:reveal', ...args),
    setValue: (...args) => ipcRenderer.invoke('envvault:setValue', ...args),
    addKey: (...args) => ipcRenderer.invoke('envvault:addKey', ...args),
    removeKey: (...args) => ipcRenderer.invoke('envvault:removeKey', ...args),
    generateExample: (...args) => ipcRenderer.invoke('envvault:generateExample', ...args),
    copy: (...args) => ipcRenderer.invoke('envvault:copy', ...args),
    scanStaged: (...args) => ipcRenderer.invoke('envvault:scanStaged', ...args),
    installHook: (...args) => ipcRenderer.invoke('envvault:installHook', ...args),
    removeHook: (...args) => ipcRenderer.invoke('envvault:removeHook', ...args),
    hookStatus: (...args) => ipcRenderer.invoke('envvault:hookStatus', ...args),
    gitignoreStatus: (...args) => ipcRenderer.invoke('envvault:gitignoreStatus', ...args),
    addToGitignore: (...args) => ipcRenderer.invoke('envvault:addToGitignore', ...args),
  },

  // Git do sistema. Respostas: { ok: true, data } | { ok: false, error: { message, kind } }.
  git: {
    available: () => ipcRenderer.invoke('git:available'),
    status: (cwd) => ipcRenderer.invoke('git:status', cwd),
    init: (cwd) => ipcRenderer.invoke('git:init', cwd),
    stage: (cwd, paths) => ipcRenderer.invoke('git:stage', cwd, paths),
    unstage: (cwd, paths) => ipcRenderer.invoke('git:unstage', cwd, paths),
    discard: (cwd, paths) => ipcRenderer.invoke('git:discard', cwd, paths),
    commit: (cwd, message, options) => ipcRenderer.invoke('git:commit', cwd, message, options),
    log: (cwd, limit) => ipcRenderer.invoke('git:log', cwd, limit),
    branches: (cwd) => ipcRenderer.invoke('git:branches', cwd),
    checkout: (cwd, name) => ipcRenderer.invoke('git:checkout', cwd, name),
    createBranch: (cwd, name, options) => ipcRenderer.invoke('git:createBranch', cwd, name, options),
    fetch: (cwd) => ipcRenderer.invoke('git:fetch', cwd),
    pull: (cwd) => ipcRenderer.invoke('git:pull', cwd),
    push: (cwd) => ipcRenderer.invoke('git:push', cwd),
    sync: (cwd) => ipcRenderer.invoke('git:sync', cwd),
    diffFile: (cwd, relPath, options) => ipcRenderer.invoke('git:diffFile', cwd, relPath, options),
    clone: (url, parentDir, options) => ipcRenderer.invoke('git:clone', url, parentDir, options),
    onProgress: (cb) => {
      const handler = (_event, progress) => cb(progress);
      ipcRenderer.on('git:progress', handler);
      return () => ipcRenderer.removeListener('git:progress', handler);
    },
  },

  // Contas GitHub. O token entra por addPat e nunca volta ao renderer.
  github: {
    accounts: () => ipcRenderer.invoke('github:accounts'),
    addPat: (token) => ipcRenderer.invoke('github:addPat', token),
    remove: (id) => ipcRenderer.invoke('github:remove', id),
    setDefault: (id) => ipcRenderer.invoke('github:setDefault', id),
    accountForCwd: (cwd) => ipcRenderer.invoke('github:accountForCwd', cwd),
    assign: (cwd, accountId) => ipcRenderer.invoke('github:assign', cwd, accountId),
    orgs: (accountId) => ipcRenderer.invoke('github:orgs', accountId),
    publish: (cwd, options) => ipcRenderer.invoke('github:publish', cwd, options),
    prDefaults: (cwd) => ipcRenderer.invoke('github:prDefaults', cwd),
    createPr: (cwd, options) => ipcRenderer.invoke('github:createPr', cwd, options),
  },

  chat: {
    // Histórico por workspace: { conversations: [{ id, title, updatedAt, messages }], activeId }
    loadHistory: (root) => ipcRenderer.invoke('chat:history:load', root),
    saveHistory: (root, history) => ipcRenderer.invoke('chat:history:save', root, history),
    // Índice global (todas as pastas) e operações por chave do arquivo (hash da pasta).
    allHistory: (options) => ipcRenderer.invoke('chat:history:all', options),
    getConversation: (key, id) => ipcRenderer.invoke('chat:history:get', key, id),
    renameConversation: (key, id, title) => ipcRenderer.invoke('chat:history:rename', key, id, title),
    deleteConversation: (key, id) => ipcRenderer.invoke('chat:history:delete', key, id),
    // Exportar: format 'md' | 'pdf' → caminho salvo ou null (cancelado).
    exportConversation: (key, id, format) => ipcRenderer.invoke('chat:export', key, id, format),
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
