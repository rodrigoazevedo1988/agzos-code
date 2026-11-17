/**
 * Agzos Code — Electron main process
 *
 * Responsável por:
 *  - Criar a janela principal (BrowserWindow) com segurança reforçada
 *  - IPC handlers para operações de arquivo (read, write, list, mkdir)
 *  - Shell exec (terminal interno)
 *  - Diálogos nativos (abrir pasta, salvar como)
 *  - Splash window
 *  - Configurações persistentes em userData
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, safeStorage, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.argv.includes('--dev') || process.env.AGZOS_DEV === '1' || !app.isPackaged;
// DevTools só abre se AGZOS_DEV=1 ou flag --devtools explícita
const openDevToolsOnStart = process.argv.includes('--devtools') || process.env.AGZOS_DEV === '1';

// Resolve ícone do app em ordem de preferência (por plataforma e por tipo).
// macOS: nativeImage NÃO lê .icns — app.dock.setIcon('icon.icns') resulta em
// imagem vazia e o Dock continua com o ícone do Electron. Usar PNG.
function resolveAppIcon() {
  const candidates = process.platform === 'darwin'
    ? ['build/icon-1024.png', 'build/icon-512.png', 'build/icon.png']
    : process.platform === 'win32'
    ? ['build/icon.ico', 'build/icon-256.png', 'build/icon.png']
    : ['build/icon-512.png', 'build/icon-256.png', 'build/icon.png'];
  for (const rel of candidates) {
    const abs = path.join(__dirname, '..', '..', rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

const APP_ICON = resolveAppIcon();

// Branding
const APP_NAME = 'Agzos Code';
const DATA_DIR = 'agzos-code';
app.setName(APP_NAME);
app.setPath('userData', process.env.AGZOS_USER_DATA || path.join(app.getPath('appData'), DATA_DIR));

let splashWindow = null;
const isMac = process.platform === 'darwin';

/**
 * Várias janelas: cada BrowserWindow é independente (pasta, terminais, agente).
 * Eventos de menu/updater vão para a janela focada (ou a primeira aberta).
 */
function targetWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed() && focused !== splashWindow) return focused;
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w !== splashWindow) || null;
}

function sendToTarget(channel, ...args) {
  const win = targetWindow();
  if (win) win.webContents.send(channel, ...args);
}

// Visualizadores (imagem/vídeo/áudio/PDF): agzos-file:// serve só caminhos liberados
// no path-guard da janela dona do token (host da URL). Registrado antes do app ficar pronto.
const fileProtocol = require('./lib/file-protocol');
const { openExternalSafe } = require('./lib/external-url');
protocol.registerSchemesAsPrivileged([{
  scheme: fileProtocol.SCHEME,
  privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
}]);

/* -------------------------------------------------------------------------- */
/*  Janela splash (carregamento inicial)                                       */
/* -------------------------------------------------------------------------- */
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow.show());
}

/* -------------------------------------------------------------------------- */
/*  Janela principal                                                            */
/* -------------------------------------------------------------------------- */
function createMainWindow() {
  const winOpts = {
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0E0E0E',
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // Visualizador de PDF embutido do Chromium (aba de PDF via agzos-file://).
      plugins: true,
    },
  };
  if (APP_ICON) {
    winOpts.icon = APP_ICON;
  }
  // Janelas novas abrem levemente deslocadas da focada (como no VS Code).
  const from = BrowserWindow.getFocusedWindow();
  if (from && from !== splashWindow && !from.isDestroyed()) {
    const [x, y] = from.getPosition();
    Object.assign(winOpts, { x: x + 30, y: y + 30 });
  }
  const mainWindow = new BrowserWindow(winOpts);
  // Permissões de arquivo desta janela (descartadas quando ela fecha).
  windowGuards.register(mainWindow.webContents);

  // macOS: menu nativo na barra do sistema (a barra in-app fica escondida).
  // Windows/Linux: a barra de menus é a do renderer (menubar.js); sem menu
  // nativo na janela (não reaparece com Alt). Atalhos: keymap.js.
  if (!isMac) mainWindow.removeMenu();

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    if (openDevToolsOnStart) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Links externos abrem no browser padrão, nunca dentro do app; só http(s)/mailto
    // (file:, smb:, protocolos de apps… são negados — lib/external-url.js).
    openExternalSafe(shell, url);
    return { action: 'deny' };
  });

  return mainWindow;
}

/* -------------------------------------------------------------------------- */
/*  Menu nativo (atalhos)                                                      */
/* -------------------------------------------------------------------------- */
function buildAppMenu() {
  // Sair passa pela confirmação (requestQuit), inclusive Cmd+Q no macOS.
  const quitItem = { label: `Sair do ${APP_NAME}`, accelerator: 'CmdOrCtrl+Q', click: () => quitWithConfirm() };
  return Menu.buildFromTemplate([
    ...(isMac ? [{
      label: APP_NAME,
      submenu: [
        { role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
        quitItem,
      ],
    }] : []),
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Nova Janela',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createMainWindow(),
        },
        {
          label: 'Abrir Pasta…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToTarget('menu:open-folder'),
        },
        { type: 'separator' },
        {
          label: 'Salvar',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendToTarget('menu:save'),
        },
        { type: 'separator' },
        {
          label: 'Configurações…',
          accelerator: 'CmdOrCtrl+,',
          click: () => sendToTarget('menu:open-settings'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : quitItem,
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendToTarget('menu:command-palette'),
        },
        {
          label: 'Alternar Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => sendToTarget('menu:toggle-terminal'),
        },
        {
          label: 'Alternar Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendToTarget('menu:toggle-sidebar'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Verificar atualizações…',
          click: () => sendToTarget('menu:check-updates'),
        },
        { type: 'separator' },
        {
          label: 'Sobre o Agzos Code',
          click: () => {
            dialog.showMessageBox(targetWindow(), {
              type: 'info',
              title: 'Sobre',
              message: `${APP_NAME}`,
              detail: `Versão ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}\n\nEditor próprio construído com Electron + Monaco.\n\n© 2026 Agzos`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ]);
}

/* -------------------------------------------------------------------------- */
/*  IPC (handlers em src/main/ipc/)                                             */
/* -------------------------------------------------------------------------- */
const deps = {
  app,
  shell,
  dialog,
  isDev,
  APP_NAME,
  getWindowFor: (evt) => (evt?.sender ? BrowserWindow.fromWebContents(evt.sender) : targetWindow()),
};
// Path-guard por janela (como no VS Code): cada janela só acessa a pasta aberta nela,
// arquivos que ela abriu por diálogo/arrastar e caminhos liberados para ela.
const { createWindowGuards } = require('./lib/window-guards');
const windowGuards = createWindowGuards();
const { guardFor } = windowGuards;
ipcMain.on('window:fileToken', (evt) => { evt.returnValue = windowGuards.tokenFor(evt.sender); });
// onDirRead: a pasta lida entra no observador da janela (workspaces é definido logo abaixo;
// fs:readDir só chega depois da inicialização). getFilesExclude: nomes ocultos no Explorer.
require('./ipc/fs').register(ipcMain, {
  guardFor, shell,
  onDirRead: (sender, dir) => workspaces.watchDir(sender, dir),
  getFilesExclude: () => settingsStore?.load?.().files?.exclude,
});
require('./ipc/dialog').register(ipcMain, { ...deps, guardFor });
require('./ipc/term').register(ipcMain, { guardFor });
require('./ipc/ssh').register(ipcMain, { guardFor });
require('./ipc/ports').register(ipcMain);
const settingsStore = require('./ipc/settings').register(ipcMain, {
  ...deps,
  // settings:changed vai às outras janelas quando uma salva.
  listWebContents: () => BrowserWindow.getAllWindows().filter((w) => w !== splashWindow && !w.isDestroyed()).map((w) => w.webContents),
});
const workspaces = require('./ipc/workspace').register(ipcMain, {
  guardFor,
  getRecentFolders: () => settingsStore.load().recentFolders || [],
  addRecentFolder: (folderPath) => {
    const s = settingsStore.load();
    const recent = [folderPath, ...(s.recentFolders || []).filter((p) => p !== folderPath)];
    settingsStore.save({ ...s, recentFolders: recent.slice(0, 10) });
  },
  clearRecentFolders: () => settingsStore.save({ ...settingsStore.load(), recentFolders: [] }),
});
// Ctrl+Q / Arquivo › Sair: confirma antes (lib/quit-confirm.js). Fechar uma janela não pergunta.
const { confirmQuit } = require('./lib/quit-confirm');
const DIRTY_SCRIPT = `(() => { const f = window.AgzosState && window.AgzosState.files; if (!f) return 0;
  let n = 0; for (const x of f.values()) if (x && x.dirty) n++; return n; })()`;
async function countDirtyFiles() {
  const wins = BrowserWindow.getAllWindows().filter((w) => w !== splashWindow && !w.isDestroyed());
  const counts = await Promise.all(wins.map((w) => Promise.race([
    w.webContents.executeJavaScript(DIRTY_SCRIPT, true).catch(() => 0),
    new Promise((r) => setTimeout(() => r(0), 1500)),
  ])));
  return counts.reduce((a, n) => a + (Number(n) || 0), 0);
}
let quitPrompt = null; // uma pergunta por vez (Ctrl+Q repetido não empilha diálogos)
function requestQuit(parent) {
  if (quitPrompt) return quitPrompt.then(() => false);
  quitPrompt = confirmQuit({
    // Lido na hora da chamada: os e2e substituem dialog.showMessageBox.
    dialog: { showMessageBox: (win, opts) => (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)) },
    parent: parent || targetWindow(),
    getSettings: () => settingsStore.load(),
    disableConfirm: () => {
      const s = settingsStore.load();
      settingsStore.save({ ...s, window: { ...(s.window || {}), confirmBeforeQuit: false } });
    },
    countDirty: countDirtyFiles,
  }).finally(() => { quitPrompt = null; });
  return quitPrompt;
}
async function quitWithConfirm(parent) {
  if (await requestQuit(parent)) app.quit();
}
require('./ipc/window').register(ipcMain, {
  createWindow: () => createMainWindow(),
  fromWebContents: (wc) => BrowserWindow.fromWebContents(wc),
  quit: () => app.quit(),
  confirmQuit: (win) => requestQuit(win),
});
// Só em testes E2E: libera uma pasta temporária sem passar pelo diálogo nativo.
// Sem id: em todas as janelas abertas (compatível com os testes de 1 janela);
// com webContents.id: só naquela janela.
if (process.env.AGZOS_TEST === '1') {
  global.__agzosAllowRoot = (p, webContentsId) => {
    if (webContentsId === undefined) windowGuards.allowAll(p);
    else guardFor(webContentsId).allow(p);
  };
}
const { createSecretStore } = require('./lib/secrets');
const { migrateLegacySecrets } = require('./lib/settings');
const { migrateLegacyAi } = require('./ai/profiles');
// Em testes E2E sem keyring (CI Linux), usa um cofre falso. Inerte fora de AGZOS_TEST=1.
const secretsBackend = process.env.AGZOS_TEST === '1' && process.env.AGZOS_TEST_SAFESTORAGE === 'fake'
  ? {
      isEncryptionAvailable: () => true,
      encryptString: (v) => Buffer.from(`fake:${v}`, 'utf-8'),
      decryptString: (b) => b.toString('utf-8').replace(/^fake:/, ''),
    }
  : safeStorage;
const secretStore = createSecretStore({
  filePath: path.join(app.getPath('userData'), 'secrets.json'),
  safeStorage: secretsBackend,
});
require('./ipc/secrets').register(ipcMain, { store: secretStore });
// Pasta remota via SSH (1.2.0): uma conexão por host por janela; diálogos e estado
// (remote:prompt / remote:state) só vão para a janela dona da conexão.
const { createRemoteManager } = require('./remote/manager');
const remoteRetryMs = Number(process.env.AGZOS_TEST === '1' && process.env.AGZOS_REMOTE_RETRY_MS) || 0;
const remoteManager = createRemoteManager({
  connectionOptions: () => ({ secretStore, home: require('os').homedir() }),
  retryDelays: remoteRetryMs ? [remoteRetryMs, remoteRetryMs, remoteRetryMs] : undefined,
  onState: (ownerId, st) => {
    const wc = require('electron').webContents.fromId(ownerId);
    if (wc && !wc.isDestroyed()) wc.send('remote:state', st);
  },
});
require('./workspace/provider-for').setRemoteManager(remoteManager);
// Contenção de symlinks no host: o provider SSH confere o realpath contra as raízes da janela.
require('./workspace/provider-for').setRootsResolver((id) => guardFor(id).roots());
require('./ipc/remote').register(ipcMain, { manager: remoteManager, createWindow: () => createMainWindow() });
// Git + GitHub: contas (tokens só no main) e operações git do sistema.
const githubAccounts = require('./ipc/github').register(ipcMain, { guardFor, settingsStore, store: secretStore, app });
require('./ipc/git').register(ipcMain, { guardFor, accounts: githubAccounts });
// Anexos do Agzos IA (imagens, texto, PDF) em userData/chat-attachments.
const { createAttachmentStore } = require('./ai/attachments');
const chatAttachments = createAttachmentStore({ dir: path.join(app.getPath('userData'), 'chat-attachments') });
const aiSessions = require('./ipc/ai').register(ipcMain, {
  settingsStore, store: secretStore, attachments: chatAttachments, guardFor, dialog,
  getWindowFor: deps.getWindowFor, userDataDir: app.getPath('userData'),
});
// Agente (tools no workspace): chave da IA só no main; raiz e guard da janela que pediu.
const agentSessions = require('./ipc/agent').register(ipcMain, {
  settingsStore, store: secretStore, guardFor, userDataDir: app.getPath('userData'), attachments: chatAttachments, shell,
  getWindowRoot: (sender) => workspaces.rootFor(sender.id),
});
// Módulos nativos: um processo utilitário compartilhado, criado sob demanda.
const { createWorkerHost } = require('./modules/worker-host');
const modulesWorker = createWorkerHost({ script: path.join(__dirname, 'modules/worker.js'), idleMs: 20000 });
const modulesDeps = {
  guardFor,
  getWindowRoot: (sender) => workspaces.rootFor(sender.id),
  settingsStore, userDataDir: app.getPath('userData'), workerHost: modulesWorker };
require('./ipc/broom').register(ipcMain, modulesDeps);
require('./ipc/envvault').register(ipcMain, modulesDeps);
// Histórico local + Git Slider (userData/local-history).
require('./ipc/history').register(ipcMain, modulesDeps);
require('./ipc/formatter').register(ipcMain, modulesDeps);
require('./ipc/tree').register(ipcMain, modulesDeps);
// Snippets (1.2.0): biblioteca em userData/snippets.json; import/export só por diálogo nativo.
require('./ipc/snippets').register(ipcMain, {
  ...modulesDeps, dialog, getWindowFor: (sender) => BrowserWindow.fromWebContents(sender),
});
// Agzos Snap: janela oculta só para renderizar a imagem (modules/snap/capture.js).
require('./ipc/snap').register(ipcMain, {
  ...modulesDeps,
  getWindowFor: deps.getWindowFor,
  capture: require('./modules/snap/capture').createCapture({ BrowserWindow, screen: require('electron').screen }),
  clipboard: require('electron').clipboard,
  dialog: { showSaveDialog: (...args) => dialog.showSaveDialog(...args) },
});
// Agzos Ao Vivo: servidor local em 127.0.0.1 por janela; abre no navegador só http(s).
const liveServers = require('./ipc/live').register(ipcMain, {
  ...modulesDeps,
  openExternal: (url) => openExternalSafe(shell, url),
});
require('./ipc/chat-history').register(ipcMain, {
  ...deps, BrowserWindow, attachments: chatAttachments,
  getRecentFolders: () => settingsStore.load().recentFolders || [],
});
require('./ipc/app-info').register(ipcMain, deps);
const updater = require('./updater').createUpdater({
  app,
  // Um aviso só, na janela focada (evita um confirm por janela).
  notify: (notice) => sendToTarget('update:notice', notice),
});
ipcMain.handle('update:check', () => updater.checkForUpdates({ manual: true }));
ipcMain.handle('update:install', () => updater.installDownloadedUpdate());

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */
app.whenReady().then(() => {
  protocol.handle(fileProtocol.SCHEME, fileProtocol.createFileProtocolHandler({
    guardForHost: windowGuards.guardForToken,
    // Pasta remota: stream SFTP pela conexão da janela dona do token.
    providerForHost: (host, p) => require('./workspace/provider-for').providerFor(p, windowGuards.ownerForToken(host)),
  }));

  // Migra chaves guardadas em texto puro pela v0.1 para o cofre do SO
  const migrated = migrateLegacySecrets(settingsStore.load(), secretStore);
  // Em seguida, associa o provider antigo à chave já guardada em ai.legacy.
  const migratedAi = migrateLegacyAi(migrated.settings, secretStore);
  if (migrated.changed || migratedAi.changed) settingsStore.save(migratedAi.settings);

  // macOS: seta o ícone da Dock enquanto o app roda (em dev e empacotado)
  if (process.platform === 'darwin' && app.dock && APP_ICON) {
    const img = nativeImage.createFromPath(APP_ICON);
    if (img.isEmpty()) console.warn(`[Agzos Code] ícone do Dock vazio: ${APP_ICON}`);
    else app.dock.setIcon(img);
  }
  // Windows: pin to taskbar / jump list com ícone correto
  if (process.platform === 'win32' && APP_ICON) {
    try {
      app.setUserTasks?.([{ program: process.execPath, title: 'Nova Janela', iconPath: APP_ICON }]);
    } catch { /* ignora */ }
  }
  // Linux: Unity launcher (best-effort)
  if (process.platform === 'linux' && APP_ICON) {
    try { app.setBadgeCount?.(0); } catch { /* ignora */ }
  }

  // Windows/Linux: null tira também o menu padrão do Electron (que reapareceria com Alt).
  Menu.setApplicationMenu(isMac ? buildAppMenu() : null);
  createSplash();
  // Atrasa um pouquinho pra splash renderizar com calma
  setTimeout(() => createMainWindow(), 350);
  updater.start({ checkOnStart: false });
  setTimeout(() => updater.checkForUpdates({ manual: false }), 10_000);
  setInterval(() => updater.checkForUpdates({ manual: false }), 6 * 60 * 60 * 1000).unref();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  aiSessions.cancelAll();
  agentSessions.cancelAll();
  modulesWorker.dispose();
  liveServers.stopAll().catch(() => {});
  remoteManager.disposeAll();
  // Encerra shells abertos
  require('./ipc/term').killAll();
  if (process.platform !== 'darwin') app.quit();
});

// Hardening extra
const RENDERER_URL = require('url').pathToFileURL(path.join(__dirname, '..', 'renderer') + path.sep).href;
app.on('web-contents-created', (_e, contents) => {
  // Nenhuma janela nova dentro do app (inclui middle-click/target=_blank em qualquer webContents).
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(shell, url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    // Só navega dentro das páginas do próprio app; o resto é bloqueado e, se for
    // http(s)/mailto, abre fora (nunca file: de fora do app nem outros esquemas).
    if (url.startsWith(RENDERER_URL)) return;
    event.preventDefault();
    openExternalSafe(shell, url);
  });
});
