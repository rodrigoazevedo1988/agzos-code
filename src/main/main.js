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
// no path-guard. Precisa ser registrado antes do app ficar pronto.
const fileProtocol = require('./lib/file-protocol');
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
    // Links externos abrem no browser padrão, nunca dentro do app
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

/* -------------------------------------------------------------------------- */
/*  Menu nativo (atalhos)                                                      */
/* -------------------------------------------------------------------------- */
function buildAppMenu() {
  return Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
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
        isMac ? { role: 'close' } : { role: 'quit' },
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
const { createPathGuard } = require('./lib/path-guard');
const guard = createPathGuard();
require('./ipc/fs').register(ipcMain, { guard, shell });
require('./ipc/dialog').register(ipcMain, { ...deps, guard });
require('./ipc/term').register(ipcMain);
require('./ipc/ssh').register(ipcMain, { guard });
require('./ipc/ports').register(ipcMain);
const settingsStore = require('./ipc/settings').register(ipcMain, deps);
const workspaces = require('./ipc/workspace').register(ipcMain, {
  guard,
  getRecentFolders: () => settingsStore.load().recentFolders || [],
  addRecentFolder: (folderPath) => {
    const s = settingsStore.load();
    const recent = [folderPath, ...(s.recentFolders || []).filter((p) => p !== folderPath)];
    settingsStore.save({ ...s, recentFolders: recent.slice(0, 10) });
  },
  clearRecentFolders: () => settingsStore.save({ ...settingsStore.load(), recentFolders: [] }),
});
require('./ipc/window').register(ipcMain, {
  createWindow: () => createMainWindow(),
  fromWebContents: (wc) => BrowserWindow.fromWebContents(wc),
  quit: () => app.quit(),
});
// Só em testes E2E: libera uma pasta temporária sem passar pelo diálogo nativo.
if (process.env.AGZOS_TEST === '1') {
  global.__agzosAllowRoot = (p) => guard.allow(p);
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
// Git + GitHub: contas (tokens só no main) e operações git do sistema.
const githubAccounts = require('./ipc/github').register(ipcMain, { guard, settingsStore, store: secretStore, app });
require('./ipc/git').register(ipcMain, { guard, accounts: githubAccounts });
// Anexos do Agzos IA (imagens, texto, PDF) em userData/chat-attachments.
const { createAttachmentStore } = require('./ai/attachments');
const chatAttachments = createAttachmentStore({ dir: path.join(app.getPath('userData'), 'chat-attachments') });
const aiSessions = require('./ipc/ai').register(ipcMain, {
  settingsStore, store: secretStore, attachments: chatAttachments, guard, dialog,
  getMainWindow: () => mainWindow, userDataDir: app.getPath('userData'),
});
// Agente (tools no workspace): chave da IA só no main; raiz via guard.
const agentSessions = require('./ipc/agent').register(ipcMain, {
  settingsStore, store: secretStore, guard, userDataDir: app.getPath('userData'), attachments: chatAttachments, shell,
  getWindowRoot: (sender) => workspaces.rootFor(sender.id),
});
// Módulos nativos: um processo utilitário compartilhado, criado sob demanda.
const { createWorkerHost } = require('./modules/worker-host');
const modulesWorker = createWorkerHost({ script: path.join(__dirname, 'modules/worker.js') });
const modulesDeps = { guard, settingsStore, userDataDir: app.getPath('userData'), workerHost: modulesWorker };
require('./ipc/broom').register(ipcMain, modulesDeps);
require('./ipc/envvault').register(ipcMain, modulesDeps);
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
  protocol.handle(fileProtocol.SCHEME, fileProtocol.createFileProtocolHandler({ guard }));

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
  // Encerra shells abertos
  require('./ipc/term').killAll();
  if (process.platform !== 'darwin') app.quit();
});

// Hardening extra
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    // Bloqueia navegação para URLs externas dentro do app
    const isLocal = url.startsWith('file://');
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});
