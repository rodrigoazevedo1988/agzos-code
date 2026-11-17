const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/ssh-utils.js')).href);

test('remotePickerItems: hosts primeiro, ações, Em breve desabilitado', async () => {
  const { remotePickerItems } = await load();
  const items = remotePickerItems({
    hosts: [
      { host: 'prod', hostName: '10.0.0.5', user: 'deploy', port: 2222 },
      { host: 'web' },
    ],
    hasWsl: false,
  });
  assert.deepEqual(items.map((i) => i.id), ['host:prod', 'host:web', 'connect', 'add', 'config', 'folder']);
  assert.equal(items[0].label, 'prod');
  assert.equal(items[0].description, 'deploy@10.0.0.5:2222');
  assert.equal(items[1].description, '');
  const folder = items.find((i) => i.id === 'folder');
  assert.equal(folder.disabled, true);
  assert.equal(folder.badge, 'Em breve (1.2.0)');
  assert.equal(items.filter((i) => i.disabled).length, 1);
});

test('remotePickerItems: WSL só quando o perfil existe', async () => {
  const { remotePickerItems } = await load();
  assert.ok(remotePickerItems({ hosts: [], hasWsl: true }).some((i) => i.id === 'wsl'));
  assert.ok(!remotePickerItems({ hosts: [], hasWsl: false }).some((i) => i.id === 'wsl'));
});

test('hostDescription: combina User/HostName/Port', async () => {
  const { hostDescription } = await load();
  assert.equal(hostDescription({ host: 'a', hostName: 'h' }), 'h');
  assert.equal(hostDescription({ host: 'a', user: 'u' }), 'u@a');
  assert.equal(hostDescription({ host: 'a', port: 2 }), 'a:2');
  assert.equal(hostDescription({ host: 'a' }), '');
});

test('suggestAlias: apelido a partir do alvo', async () => {
  const { suggestAlias } = await load();
  assert.equal(suggestAlias({ host: 'srv.example.com' }), 'srv');
  assert.equal(suggestAlias({ host: '10.0.0.5' }), '10.0.0.5');
  assert.equal(suggestAlias({ host: '::1' }), 'ipv6-host');
});

test('remoteStatus: destaque só com sessão SSH ativa e viva', async () => {
  const { remoteStatus } = await load();
  assert.deepEqual(remoteStatus(null), { connected: false, label: '', title: 'Abrir uma conexão remota' });
  assert.deepEqual(remoteStatus({ ssh: { alias: 'prod' }, exited: false }),
    { connected: true, label: 'SSH: prod', title: 'Conectado a prod via SSH (terminal ativo)' });
  assert.equal(remoteStatus({ ssh: { host: 'h' }, exited: true }).connected, false);
  assert.equal(remoteStatus({ ssh: null }).connected, false);
});
