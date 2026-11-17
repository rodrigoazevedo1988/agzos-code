const { test } = require('node:test');
const assert = require('node:assert/strict');

const fileProtocol = require('../../src/main/lib/file-protocol');

const rp = () => import('../../src/renderer/scripts/remote-paths.js');
const paths = () => import('../../src/renderer/scripts/viewers/paths.js');

test('remote-paths (renderer): authority, caminho, rótulo, pai e junção', async () => {
  const m = await rp();
  assert.equal(m.isRemotePath('ssh://prod/srv'), true);
  assert.equal(m.isRemotePath('/srv'), false);
  assert.equal(m.remoteAuthority('ssh://deploy@h:22/srv/a'), 'deploy@h:22');
  assert.equal(m.remotePathPart('ssh://prod'), '/');
  assert.equal(m.remotePathPart('ssh://prod/srv/a b'), '/srv/a b');
  assert.equal(m.hostLabel('deploy@10.0.0.5:2222'), '10.0.0.5');
  assert.equal(m.hostLabel('ana@[::1]:22'), '::1');
  assert.equal(m.hostLabel('prod'), 'prod');
  assert.equal(m.parentPath('ssh://prod/srv/a.txt'), 'ssh://prod/srv');
  assert.equal(m.parentPath('ssh://prod/srv'), 'ssh://prod/');
  assert.equal(m.joinRemote('ssh://prod/srv/', 'x.js'), 'ssh://prod/srv/x.js');
  assert.deepEqual(m.remoteFolderLabel('ssh://deploy@h:22/srv/app', new Map()), { host: 'h', folder: 'app' });
});

test('toFileUrl remoto casa com o parser do main (inclusive nomes com # e espaço)', async () => {
  const { toFileUrl } = await paths();
  const uri = 'ssh://deploy@10.0.0.5:2222/srv/a b/foto #1.png';
  const url = toFileUrl(uri, 7, 'abc123');
  assert.equal(url, 'agzos-file://abc123/~ssh/deploy%4010.0.0.5%3A2222/srv/a%20b/foto%20%231.png?v=7');
  assert.deepEqual(fileProtocol.parseFileUrl(url, 'linux'), { host: 'abc123', path: uri });
  // O parser de URL resolve %2e%2e antes; o resultado normalizado ainda passa pelo guard da janela.
  assert.equal(fileProtocol.parseFileUrl('agzos-file://abc/~ssh/prod/srv/%2e%2e/etc', 'linux').path, 'ssh://prod/etc');
  assert.equal(fileProtocol.parseFileUrl('agzos-file://abc/~ssh/-oProxyCommand=x/etc', 'linux'), null);
});

test('resolveMarkdownPath em .md remoto mantém o ssh://authority', async () => {
  const { resolveMarkdownPath } = await paths();
  assert.equal(resolveMarkdownPath('ssh://prod/srv/app/docs/a.md', '../img/x.png', 'ssh://prod/srv/app'), 'ssh://prod/srv/app/img/x.png');
  assert.equal(resolveMarkdownPath('ssh://prod/srv/app/docs/a.md', '/logo.png', 'ssh://prod/srv/app'), 'ssh://prod/srv/app/logo.png');
  assert.equal(resolveMarkdownPath('ssh://prod/srv/app/a.md', 'https://x.io/a.png', 'ssh://prod/srv/app'), null);
});
