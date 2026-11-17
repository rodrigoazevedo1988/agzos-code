const { test } = require('node:test');
const assert = require('node:assert/strict');

const u = require('../../src/main/workspace/remote-uri');

test('parseRemoteUri: alias e usuario@host:porta', () => {
  assert.deepEqual(u.parseRemoteUri('ssh://prod/srv/app'), { authority: 'prod', target: 'prod', path: '/srv/app' });
  assert.deepEqual(u.parseRemoteUri('ssh://deploy@10.0.0.5:2222/home/deploy/'), { authority: 'deploy@10.0.0.5:2222', target: 'deploy@10.0.0.5:2222', path: '/home/deploy' });
  assert.deepEqual(u.parseRemoteUri('ssh://ana@[::1]:22/x'), { authority: 'ana@[::1]:22', target: 'ana@[::1]:22', path: '/x' });
  assert.equal(u.parseRemoteUri('ssh://prod').path, '/');
  // Nomes com espaço, aspas e $() são caminhos válidos (crus).
  assert.equal(u.parseRemoteUri("ssh://prod/a b/it's $(x);y").path, "/a b/it's $(x);y");
});

test('parseRemoteUri nega .., %2e%2e, barra dupla, \\, NUL e authority insegura', () => {
  for (const bad of [
    'ssh://prod/a/../b', 'ssh://prod/..', 'ssh://prod/a/%2e%2e/b', 'ssh://prod/a/%2E%2e', 'ssh://prod/a/.%2e/b',
    'ssh://prod/a/./b', 'ssh://prod//etc', 'ssh://prod/a//b', 'ssh://prod/a\\b', 'ssh://prod/a\0b', 'ssh://prod/a\nb',
    'ssh://-oProxyCommand=x/a', 'ssh://a b/x', 'ssh://user@host;id:22/x', 'ssh:///x', 'file:///etc', '/local/path', null,
  ]) {
    assert.equal(u.parseRemoteUri(bad), null, String(bad));
  }
});

test('toRemoteUri/remoteJoin/dirname/basename/relative', () => {
  assert.equal(u.toRemoteUri('prod', '/srv/app/'), 'ssh://prod/srv/app');
  assert.equal(u.toRemoteUri('prod', '/srv/../../etc'), 'ssh://prod/etc');
  assert.equal(u.remoteJoin('ssh://prod/srv', 'a', 'b.txt'), 'ssh://prod/srv/a/b.txt');
  assert.throws(() => u.remoteJoin('ssh://prod/srv', '../etc'));
  assert.equal(u.remoteDirname('ssh://prod/srv/a.txt'), 'ssh://prod/srv');
  assert.equal(u.remoteDirname('ssh://prod/a'), 'ssh://prod/');
  assert.equal(u.remoteBasename('ssh://prod/srv/a.txt'), 'a.txt');
  assert.equal(u.remoteRelative('ssh://prod/srv', 'ssh://prod/srv/x/y'), 'x/y');
  assert.equal(u.remoteRelative('ssh://prod/srv', 'ssh://prod/srv2/y'), null);
  assert.equal(u.remoteRelative('ssh://prod/srv', 'ssh://outro/srv/y'), null);
  assert.equal(u.isWithinRemote('ssh://prod/', 'ssh://prod/qualquer'), true);
});
