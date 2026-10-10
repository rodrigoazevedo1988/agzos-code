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

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const { spawn } = require('child_process');
const os = require('os');

const isDev = process.argv.includes('--dev') || !app.isPackaged;

// Branding
const APP_NAME = 'Agzos Code';
const DATA_DIR = 'agzos-code';
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), DATA_DIR));

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
  mainWindow = new BrowserWindow({
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
      sandbox: false, // sandbox=true quebra require('fs') no preload; usamos contextIsolation
      spellcheck: false,
    },
  });

  // Menu nativo — escondemos a barra mas mantemos atalhos
  Menu.setApplicationMenu(buildAppMenu());

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (splashWindow) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
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
          label: 'Sobre o Agzos Code',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Sobre',
              message: `${APP_NAME}`,
              detail: `Versão ${app.getVersion()}\nElectron ${process.versions.electron}\nNode ${process.versions.node}\n\nFork do Code-OSS com branding Agzos.\n\n© 2026 Agzos`,
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ]);
}

/* -------------------------------------------------------------------------- */
/*  IPC: file system                                                            */
/* -------------------------------------------------------------------------- */
ipcMain.handle('fs:readDir', async (_evt, dirPath) => {
  if (!dirPath) throw new Error('dirPath required');
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith('.') || e.name === '.gitignore')
    .map((e) => ({
      name: e.name,
      path: path.join(dirPath, e.name),
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    }));
});

ipcMain.handle('fs:readFile', async (_evt, filePath) => {
  if (!filePath) throw new Error('filePath required');
  const stat = await fsp.stat(filePath);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error('Arquivo muito grande (>5MB). Abra pelo terminal.');
  }
  const content = await fsp.readFile(filePath, 'utf-8');
  return { content, size: stat.size, mtime: stat.mtimeMs };
});

ipcMain.handle('fs:writeFile', async (_evt, filePath, content) => {
  if (!filePath) throw new Error('filePath required');
  await fsp.writeFile(filePath, content, 'utf-8');
  return true;
});

ipcMain.handle('fs:mkdir', async (_evt, dirPath) => {
  await fsp.mkdir(dirPath, { recursive: true });
  return true;
});

ipcMain.handle('fs:exists', async (_evt, p) => {
  try { await fsp.access(p); return true; } catch { return false; }
});

ipcMain.handle('fs:stat', async (_evt, p) => {
  try {
    const s = await fsp.stat(p);
    return { isDirectory: s.isDirectory(), isFile: s.isFile(), size: s.size, mtime: s.mtimeMs };
  } catch {
    return null;
  }
});

ipcMain.handle('fs:delete', async (_evt, p) => {
  await fsp.rm(p, { recursive: true, force: true });
  return true;
});

ipcMain.handle('fs:rename', async (_evt, oldP, newP) => {
  await fsp.rename(oldP, newP);
  return true;
});

ipcMain.handle('fs:homeDir', () => os.homedir());

ipcMain.handle('dialog:openFolder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Abrir Pasta',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Abrir Arquivo',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_evt, defaultPath) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar Como',
    defaultPath,
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

/* -------------------------------------------------------------------------- */
/*  IPC: terminal (spawn shell)                                                 */
/* -------------------------------------------------------------------------- */
const shells = new Map();

ipcMain.handle('term:create', (evt, cols = 80, rows = 24) => {
  const id = `t${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const shellPath = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
  const cwd = os.homedir();

  const proc = spawn(shellPath, [], {
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
    shell: false,
  });

  shells.set(id, proc);

  proc.stdout.on('data', (data) => evt.sender.send('term:data', id, data.toString()));
  proc.stderr.on('data', (data) => evt.sender.send('term:data', id, data.toString()));
  proc.on('exit', (code) => {
    evt.sender.send('term:exit', id, code);
    shells.delete(id);
  });

  return { id, cwd };
});

ipcMain.handle('term:write', (_evt, id, data) => {
  const proc = shells.get(id);
  if (proc) proc.stdin.write(data);
  return true;
});

ipcMain.handle('term:resize', (_evt, id, _cols, _rows) => {
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

/* -------------------------------------------------------------------------- */
/*  IPC: configurações (persistência simples em JSON)                           */
/* -------------------------------------------------------------------------- */
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    }
  } catch (e) {
    console.error('settings load error', e);
  }
  return {
    theme: 'agzos-dark',
    performanceMode: 'balanced', // economy | balanced | high
    aiProvider: null,
    aiApiKey: null,
    telemetry: false,
    fontSize: 14,
    recentFolders: [],
  };
}

function saveSettings(s) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('settings save error', e);
    return false;
  }
}

ipcMain.handle('settings:load', () => loadSettings());
ipcMain.handle('settings:save', (_evt, settings) => saveSettings(settings));

/* -------------------------------------------------------------------------- */
/*  IPC: app info                                                               */
/* -------------------------------------------------------------------------- */
ipcMain.handle('app:info', () => ({
  name: APP_NAME,
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  platform: process.platform,
  arch: process.arch,
  isDev,
}));

ipcMain.handle('app:openExternal', (_evt, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

/* -------------------------------------------------------------------------- */
/*  Lifecycle                                                                   */
/* -------------------------------------------------------------------------- */
app.whenReady().then(() => {
  createSplash();
  // Atrasa um pouquinho pra splash renderizar com calma
  setTimeout(() => createMainWindow(), 350);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  // Encerra shells abertos
  for (const proc of shells.values()) {
    try { proc.kill(); } catch {}
  }
  shells.clear();
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
