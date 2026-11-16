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

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, safeStorage } = require('electron');
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

let mainWindow = null;
let splashWindow = null;

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
    },
  };
  if (APP_ICON) {
    winOpts.icon = APP_ICON;
  }
  mainWindow = new BrowserWindow(winOpts);

  // Menu nativo — escondemos a barra mas mantemos atalhos
  Menu.setApplicationMenu(buildAppMenu());

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* -------------------------------------------------------------------------- */
/*  Menu nativo (atalhos)                                                      */
/* -------------------------------------------------------------------------- */
function buildAppMenu() {
  const isMac = process.platform === 'darwin';
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
          click: () => mainWindow?.webContents.send('menu:open-folder'),
        },
        { type: 'separator' },
        {
          label: 'Salvar',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        { type: 'separator' },
        {
          label: 'Configurações…',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow?.webContents.send('menu:open-settings'),
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
          click: () => mainWindow?.webContents.send('menu:command-palette'),
        },
        {
          label: 'Alternar Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: () => mainWindow?.webContents.send('menu:toggle-terminal'),
        },
        {
          label: 'Alternar Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow?.webContents.send('menu:toggle-sidebar'),
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
          click: () => mainWindow?.webContents.send('menu:check-updates'),
        },
        { type: 'separator' },
        {
          label: 'Sobre o Agzos Code',
          click: () => {
            dialog.showMessageBox(mainWindow, {
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
  getMainWindow: () => mainWindow,
};
const { createPathGuard } = require('./lib/path-guard');
const guard = createPathGuard();
require('./ipc/fs').register(ipcMain, { guard });
require('./ipc/dialog').register(ipcMain, { ...deps, guard });
require('./ipc/term').register(ipcMain);
require('./ipc/ports').register(ipcMain);
const settingsStore = require('./ipc/settings').register(ipcMain, deps);
require('./ipc/workspace').register(ipcMain, {
  guard,
  getRecentFolders: () => settingsStore.load().recentFolders || [],
  addRecentFolder: (folderPath) => {
    const s = settingsStore.load();
    const recent = [folderPath, ...(s.recentFolders || []).filter((p) => p !== folderPath)];
    settingsStore.save({ ...s, recentFolders: recent.slice(0, 10) });
  },
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
const aiSessions = require('./ipc/ai').register(ipcMain, { settingsStore, store: secretStore });
// Agente (tools no workspace): chave da IA só no main; raiz via guard.
const agentSessions = require('./ipc/agent').register(ipcMain, { settingsStore, store: secretStore, guard, userDataDir: app.getPath('userData') });
require('./ipc/chat-history').register(ipcMain, deps);
require('./ipc/app-info').register(ipcMain, deps);
const updater = require('./updater').createUpdater({
  app,
  notify: (notice) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:notice', notice);
  },
});
ipcMain.handle('update:check', () => updater.checkForUpdates({ manual: true }));
ipcMain.handle('update:install', () => updater.installDownloadedUpdate());

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */
app.whenReady().then(() => {
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
