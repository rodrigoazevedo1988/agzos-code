const DEFAULT_FEED_URL = 'https://code.rsolutionsbr.com/release';
const { createMacOtaManager } = require('./lib/mac-ota');

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
  macOtaManager: injectedMacOta,
  platform = process.platform,
  feedUrl = process.env.AGZOS_UPDATE_URL || DEFAULT_FEED_URL,
  notify = () => {},
  logger = console,
} = {}) {
  let autoUpdater = injectedUpdater;
  let macOtaManager = injectedMacOta;
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

  function resolveMacOta() {
    if (macOtaManager) return macOtaManager;
    try {
      macOtaManager = createMacOtaManager({
        feedUrl,
        currentVersion: app?.getVersion ? app.getVersion() : '0.3.0',
        notify: safeNotify,
      });
      return macOtaManager;
    } catch (err) {
      logError('[updater] falha ao inicializar macOtaManager:', err);
      return null;
    }
  }

  function installListeners() {
    if (initialized || !autoUpdater) return;
    initialized = true;

    autoUpdater.on('error', (error) => reportError(error));

    autoUpdater.on('download-progress', (progressObj) => {
      safeNotify({
        type: 'progress',
        percent: Math.round(progressObj.percent || 0),
        transferred: progressObj.transferred || 0,
        total: progressObj.total || 0,
        bytesPerSecond: progressObj.bytesPerSecond || 0,
      });
    });

    autoUpdater.on('update-available', (info = {}) => {
      // Se não houver macOta configurado e for Mac legado
      if (isMac && !macOtaManager) {
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
    manualCheckActive = Boolean(manual);

    // No macOS em produção (quando não foi injetado autoUpdater de teste)
    if (isMac && !injectedUpdater) {
      const macOta = resolveMacOta();
      if (macOta) {
        try {
          const checkRes = await macOta.check();
          if (!checkRes.available) {
            if (manualCheckActive) safeNotify({ type: 'not-available', version: checkRes.version });
            manualCheckActive = false;
            return true;
          }
          safeNotify({ type: 'available', version: checkRes.version });
          await macOta.download(checkRes);
          manualCheckActive = false;
          return true;
        } catch (err) {
          reportError(err, Boolean(manual));
          manualCheckActive = false;
          return false;
        }
      }
    }

    // Fluxo padrão electron-updater (Windows e Linux)
    if (!resolveUpdater()) return false;
    installListeners();
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

    if (isMac && !injectedUpdater) {
      resolveMacOta();
      if (checkOnStart) {
        checkForUpdates({ manual: false }).catch((error) => reportError(error, false));
      }
      return true;
    }

    if (!resolveUpdater()) return false;
    installListeners();
    autoUpdater.autoDownload = !isMac;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });

    if (checkOnStart) {
      checkForUpdates({ manual: false }).catch((error) => reportError(error, false));
    }
    return true;
  }

  function installDownloadedUpdate() {
    if (isMac && macOtaManager) {
      return macOtaManager.install({
        appQuit: () => app?.quit?.(),
      });
    }

    if (!autoUpdater || isMac || typeof autoUpdater.quitAndInstall !== 'function') return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  return { start, checkForUpdates, installDownloadedUpdate };
}

module.exports = { createUpdater, DEFAULT_FEED_URL };
