const DEFAULT_FEED_URL = 'https://code.rsolutionsbr.com/release';

/**
 * Creates the main-process updater controller.
 *
 * `notify` receives a small notice object so the caller can choose the native
 * notification or application UI. Keep updater and Electron dependencies
 * injectable so this module can be tested outside Electron.
 */
function createUpdater({
  app,
  autoUpdater: injectedUpdater,
  platform = process.platform,
  feedUrl = process.env.AGZOS_UPDATE_URL || DEFAULT_FEED_URL,
  notify = () => {},
  logger = console,
} = {}) {
  let autoUpdater = injectedUpdater;
  let initialized = false;
  let manualCheckActive = false;
  const reportedErrors = new WeakSet();
  const isMac = platform === 'darwin';

  function logError(...args) {
    if (logger && typeof logger.error === 'function') logger.error(...args);
  }

  function safeNotify(notice) {
    try {
      notify(notice);
    } catch (error) {
      logError('[updater] notification callback failed:', error);
    }
  }

  function reportError(error, manual = manualCheckActive) {
    const err = error instanceof Error ? error : new Error(String(error || 'Unknown update error'));
    logError('[updater] update failed:', err);
    if (manual && !reportedErrors.has(err)) {
      reportedErrors.add(err);
      safeNotify({ type: 'error', message: err.message });
    }
  }

  function resolveUpdater() {
    if (autoUpdater) return autoUpdater;
    try {
      ({ autoUpdater } = require('electron-updater'));
      return autoUpdater;
    } catch (error) {
      logError('[updater] electron-updater is unavailable:', error);
      return null;
    }
  }

  function installListeners() {
    if (initialized) return;
    initialized = true;
    autoUpdater.on('error', (error) => reportError(error));
    autoUpdater.on('update-available', (info = {}) => {
      if (isMac) {
        safeNotify({
          type: 'manual-download',
          version: info.version,
          url: feedUrl,
          message: 'Uma atualização está disponível. Baixe a nova versão manualmente.',
        });
      } else if (manualCheckActive) {
        safeNotify({ type: 'available', version: info.version });
      }
      manualCheckActive = false;
    });
    autoUpdater.on('update-not-available', (info = {}) => {
      if (manualCheckActive) {
        safeNotify({ type: 'not-available', version: info.version });
      }
      manualCheckActive = false;
    });
    autoUpdater.on('update-downloaded', (info = {}) => {
      safeNotify({
        type: 'ready',
        version: info.version,
        message: 'A atualização foi baixada e estará pronta para instalar ao reiniciar o Agzos Code.',
      });
      manualCheckActive = false;
    });
  }

  async function checkForUpdates({ manual = false } = {}) {
    if (!app || !app.isPackaged) return false;
    if (!resolveUpdater()) return false;
    installListeners();
    manualCheckActive = Boolean(manual);
    try {
      await autoUpdater.checkForUpdates();
      return true;
    } catch (error) {
      reportError(error, Boolean(manual));
      manualCheckActive = false;
      return false;
    }
  }

  function start({ checkOnStart = true } = {}) {
    if (!app || !app.isPackaged) return false;
    if (!resolveUpdater()) return false;
    installListeners();
    autoUpdater.autoDownload = !isMac;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    if (checkOnStart) {
      // Automatic checks log failures but never surface them to the user.
      checkForUpdates({ manual: false }).catch((error) => reportError(error, false));
    }
    return true;
  }

  function installDownloadedUpdate() {
    if (!autoUpdater || isMac || typeof autoUpdater.quitAndInstall !== 'function') return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  return { start, checkForUpdates, installDownloadedUpdate };
}

module.exports = { createUpdater, DEFAULT_FEED_URL };
