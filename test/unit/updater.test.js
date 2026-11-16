const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdater, DEFAULT_FEED_URL } = require('../../src/main/updater');

function makeHarness({ packaged = true, platform = 'linux', feedUrl, checkResult } = {}) {
  const events = new EventEmitter();
  const autoUpdater = Object.assign(events, {
    autoDownload: null,
    feed: null,
    checkCalls: 0,
    setFeedURL(feed) { this.feed = feed; },
    checkForUpdates() {
      this.checkCalls += 1;
      return checkResult ? checkResult() : Promise.resolve({ updateInfo: { version: '1.2.0' } });
    },
    quitAndInstallCalls: 0,
    quitAndInstall() { this.quitAndInstallCalls += 1; },
  });
  const notifications = [];
  const logs = [];
  const updater = createUpdater({
    app: { isPackaged: packaged },
    autoUpdater,
    platform,
    feedUrl,
    notify: (notice) => notifications.push(notice),
    logger: { info: (...args) => logs.push(['info', ...args]), error: (...args) => logs.push(['error', ...args]) },
  });
  return { updater, autoUpdater, notifications, logs };
}

test('não configura nem verifica atualizações quando o app não está empacotado', async () => {
  const { updater, autoUpdater } = makeHarness({ packaged: false });
  assert.equal(updater.start(), false);
  assert.equal(await updater.checkForUpdates({ manual: true }), false);
  assert.equal(autoUpdater.feed, null);
  assert.equal(autoUpdater.checkCalls, 0);
});

test('configura provider generic com URL padrão e inicia check automático no empacotado', async () => {
  const { updater, autoUpdater } = makeHarness();
  assert.equal(updater.start(), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(autoUpdater.feed, { provider: 'generic', url: DEFAULT_FEED_URL });
  assert.equal(autoUpdater.checkCalls, 1);
  assert.equal(autoUpdater.autoDownload, true);
});

test('usa URL do feed configurada', () => {
  const { updater, autoUpdater } = makeHarness({ feedUrl: 'https://updates.example.test/channel/stable' });
  updater.start({ checkOnStart: false });
  assert.deepEqual(autoUpdater.feed, { provider: 'generic', url: 'https://updates.example.test/channel/stable' });
});

test('erros de check automático são registrados sem notificar', async () => {
  const { updater, notifications, logs } = makeHarness({
    checkResult: () => Promise.reject(new Error('offline')),
  });
  updater.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notifications.length, 0);
  assert.ok(logs.some(([level]) => level === 'error'));
});

test('check manual notifica erro', async () => {
  const { updater, notifications } = makeHarness({
    checkResult: () => Promise.reject(new Error('offline')),
  });
  updater.start({ checkOnStart: false });
  await updater.checkForUpdates({ manual: true });
  assert.equal(notifications.at(-1).type, 'error');
  assert.match(notifications.at(-1).message, /offline/);
});

test('check manual notifica quando não há atualização', async () => {
  const { updater, autoUpdater, notifications } = makeHarness();
  autoUpdater.checkForUpdates = () => {
    autoUpdater.emit('update-not-available', { version: '1.0.0' });
    return Promise.resolve({ updateInfo: { version: '1.0.0' } });
  };
  updater.start({ checkOnStart: false });
  await updater.checkForUpdates({ manual: true });
  assert.equal(notifications.at(-1).type, 'not-available');
});

for (const platform of ['win32', 'linux']) {
  test(`${platform} baixa atualização e notifica quando estiver pronta, sem reiniciar`, async () => {
    const { updater, autoUpdater, notifications } = makeHarness({ platform });
    updater.start({ checkOnStart: false });
    autoUpdater.emit('update-downloaded', { version: '1.2.0' });
    assert.equal(notifications.at(-1).type, 'ready');
    assert.equal(autoUpdater.autoDownload, true);
    assert.equal(autoUpdater.autoInstallOnAppQuit, false);
    assert.equal(autoUpdater.quitAndInstallCalls, 0);
  });
}

test('macOS não baixa automaticamente e informa download manual', async () => {
  const { updater, autoUpdater, notifications } = makeHarness({ platform: 'darwin' });
  updater.start({ checkOnStart: false });
  autoUpdater.emit('update-available', { version: '1.2.0' });
  assert.equal(autoUpdater.autoDownload, false);
  assert.equal(notifications.at(-1).type, 'manual-download');
  assert.equal(notifications.at(-1).url, DEFAULT_FEED_URL);
});

test('instala somente após confirmação explícita do renderer', () => {
  const { updater, autoUpdater } = makeHarness({ platform: 'linux' });
  updater.start({ checkOnStart: false });
  assert.equal(updater.installDownloadedUpdate(), true);
  assert.equal(autoUpdater.quitAndInstallCalls, 1);
});

test('notifica progresso de download durante auto-update', () => {
  const { updater, autoUpdater, notifications } = makeHarness({ platform: 'linux' });
  updater.start({ checkOnStart: false });
  autoUpdater.emit('download-progress', { percent: 45.2, transferred: 45000, total: 100000 });
  assert.equal(notifications.at(-1).type, 'progress');
  assert.equal(notifications.at(-1).percent, 45);
});

test('macOS usa macOtaManager para check e download quando configurado', async () => {
  const notifications = [];
  const fakeMacOta = {
    checkCalls: 0,
    downloadCalls: 0,
    installCalls: 0,
    check() {
      this.checkCalls++;
      return Promise.resolve({ available: true, version: '0.4.0' });
    },
    download(res) {
      this.downloadCalls++;
      notifications.push({ type: 'ready', version: res.version });
      return Promise.resolve(true);
    },
    install() {
      this.installCalls++;
      return true;
    },
  };

  const updater = createUpdater({
    app: { isPackaged: true, getVersion: () => '0.3.0' },
    platform: 'darwin',
    macOtaManager: fakeMacOta,
    notify: (n) => notifications.push(n),
  });

  const checked = await updater.checkForUpdates({ manual: true });
  assert.equal(checked, true);
  assert.equal(fakeMacOta.checkCalls, 1);
  assert.equal(fakeMacOta.downloadCalls, 1);
  assert.ok(notifications.some((n) => n.type === 'available' && n.version === '0.4.0'));
  assert.ok(notifications.some((n) => n.type === 'ready' && n.version === '0.4.0'));

  const installed = updater.installDownloadedUpdate();
  assert.equal(installed, true);
  assert.equal(fakeMacOta.installCalls, 1);
});



function makeFakeMacOta(notifications) {
  return {
    checkCalls: 0,
    downloadCalls: 0,
    check() {
      this.checkCalls++;
      return Promise.resolve({ available: true, version: '0.4.0' });
    },
    download(res) {
      this.downloadCalls++;
      notifications.push({ type: 'ready', version: res.version });
      return Promise.resolve(true);
    },
    install() { return true; },
  };
}

test('macOS: check em segundo plano não envia toast "available", apenas "ready"', async () => {
  const notifications = [];
  const fakeMacOta = makeFakeMacOta(notifications);
  const updater = createUpdater({
    app: { isPackaged: true, getVersion: () => '0.3.0' },
    platform: 'darwin',
    macOtaManager: fakeMacOta,
    notify: (n) => notifications.push(n),
    getSettings: () => ({}),
  });
  assert.equal(await updater.checkForUpdates({ manual: false }), true);
  assert.equal(fakeMacOta.downloadCalls, 1);
  assert.ok(!notifications.some((n) => n.type === 'available'));
  assert.ok(notifications.some((n) => n.type === 'ready'));
});

test('macOS: update.autoDownload=false não baixa e informa download manual', async () => {
  const notifications = [];
  const fakeMacOta = makeFakeMacOta(notifications);
  const updater = createUpdater({
    app: { isPackaged: true, getVersion: () => '0.3.0' },
    platform: 'darwin',
    macOtaManager: fakeMacOta,
    notify: (n) => notifications.push(n),
    getSettings: () => ({ update: { autoDownload: false } }),
  });
  assert.equal(await updater.checkForUpdates({ manual: false }), true);
  assert.equal(fakeMacOta.downloadCalls, 0);
  assert.equal(notifications.at(-1).type, 'manual-download');
  assert.equal(notifications.at(-1).version, '0.4.0');
});

test('Win/Linux: update.autoDownload=false desliga autoDownload e avisa download manual', async () => {
  const events = new EventEmitter();
  const autoUpdater = Object.assign(events, {
    autoDownload: null,
    setFeedURL() {},
    checkForUpdates() { return Promise.resolve({}); },
  });
  const notifications = [];
  let prefs = { update: { autoDownload: false } };
  const updater = createUpdater({
    app: { isPackaged: true },
    autoUpdater,
    platform: 'linux',
    notify: (n) => notifications.push(n),
    getSettings: () => prefs,
  });
  updater.start({ checkOnStart: false });
  assert.equal(autoUpdater.autoDownload, false);
  autoUpdater.emit('update-available', { version: '1.2.0' });
  assert.equal(notifications.at(-1).type, 'manual-download');

  // Mudança de preferência é relida a cada verificação.
  prefs = { update: { autoDownload: true } };
  await updater.checkForUpdates({ manual: false });
  assert.equal(autoUpdater.autoDownload, true);
});
