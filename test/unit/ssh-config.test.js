const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  parseSshConfig,
  listIncludes,
  collectHosts,
  appendHost,
  parseTarget,
  buildSshArgs,
  isSafeAlias,
} = require('../../src/main/lib/ssh-config');

const SAMPLE = [
  '# config de teste',
  'Host *',
  '  ServerAliveInterval 30',
  '',
  'Host prod',
  '    HostName 10.0.0.5',
  '    User deploy',
  '    Port 2222',
  '    IdentityFile ~/.ssh/id_prod',
  '',
  '# comentário no meio',
  'host web1 web2   # dois aliases',
  '\thostname=web.example.com',
  '\tUSER  "ana"',
  '',
  'Host *.internal db-?',
  '  User root',
  '',
  'Host gw !bad',
  '  HostName gw.example.com',
  '  Port abc',
  '',
  'Match host foo',
  '  User nobody',
  '',
].join('\n');

test('parseSshConfig: hosts, aliases múltiplos, chaves sem caixa, curingas ignorados', () => {
  const hosts = parseSshConfig(SAMPLE);
  assert.deepEqual(hosts.map((h) => h.host), ['prod', 'web1', 'web2', 'gw']);
  assert.deepEqual(hosts[0], { host: 'prod', hostName: '10.0.0.5', user: 'deploy', port: 2222, identityFile: '~/.ssh/id_prod' });
  assert.deepEqual(hosts[1], { host: 'web1', hostName: 'web.example.com', user: 'ana' });
  assert.deepEqual(hosts[2], { host: 'web2', hostName: 'web.example.com', user: 'ana' });
  // Port inválida é descartada; Match encerra o bloco do gw.
  assert.deepEqual(hosts[3], { host: 'gw', hostName: 'gw.example.com' });
});

test('parseSshConfig: primeira ocorrência vence, CRLF e texto vazio', () => {
  const text = 'Host a\r\n  User um\r\n  User dois\r\n  Port 22\r\n';
  assert.deepEqual(parseSshConfig(text), [{ host: 'a', user: 'um', port: 22 }]);
  assert.deepEqual(parseSshConfig(''), []);
  assert.deepEqual(parseSshConfig(null), []);
});

test('parseSshConfig: alias repetido em blocos diferentes aparece uma vez (primeiro)', () => {
  const hosts = parseSshConfig('Host a\n User x\nHost a\n User y\n');
  assert.deepEqual(hosts, [{ host: 'a', user: 'x' }]);
});

test('listIncludes: caminhos de Include (vários por linha, com e sem aspas)', () => {
  const text = 'Include config.d/*\ninclude ~/.ssh/extra "/etc/ssh/outro config"\nHost a\n  Include dentro\n';
  assert.deepEqual(listIncludes(text), ['config.d/*', '~/.ssh/extra', '/etc/ssh/outro config', 'dentro']);
});

test('collectHosts: resolve Include relativo a ~/.ssh com glob simples, sem ciclos', () => {
  const home = '/home/u';
  const sshDir = path.join(home, '.ssh');
  const files = {
    [path.join(sshDir, 'config')]: 'Include config.d/*.conf\nInclude ~/.ssh/config\nHost main\n  HostName m\n',
    [path.join(sshDir, 'config.d', 'a.conf')]: 'Host a1\n  User ua\n',
    [path.join(sshDir, 'config.d', 'b.conf')]: 'Host b1 *\n',
    [path.join(sshDir, 'config.d', 'c.txt')]: 'Host nao\n',
  };
  const fsx = {
    readFile: (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    readDir: (d) => {
      const out = new Set();
      for (const p of Object.keys(files)) if (path.dirname(p) === d) out.add(path.basename(p));
      if (!out.size) throw new Error('ENOENT');
      return [...out];
    },
  };
  const hosts = collectHosts({ home, fs: fsx });
  assert.deepEqual(hosts.map((h) => h.host), ['a1', 'b1', 'main']);
  assert.equal(hosts[0].user, 'ua');
});

test('collectHosts: config ausente → lista vazia', () => {
  const hosts = collectHosts({ home: '/x', fs: { readFile: () => { throw new Error('ENOENT'); }, readDir: () => [] } });
  assert.deepEqual(hosts, []);
});

test('appendHost: preserva o texto anterior byte a byte e acrescenta o bloco', () => {
  const before = '# meu config\r\nHost a\r\n\tUser x   \r\n';
  const out = appendHost(before, { alias: 'novo', hostName: 'h.example.com', user: 'eu', port: 2200 });
  assert.ok(out.startsWith(before));
  assert.equal(out.slice(before.length), '\r\nHost novo\r\n  HostName h.example.com\r\n  User eu\r\n  Port 2200\r\n');

  const noEol = 'Host a';
  const out2 = appendHost(noEol, { alias: 'b', hostName: 'b.io' });
  assert.equal(out2, 'Host a\n\nHost b\n  HostName b.io\n');

  assert.equal(appendHost('', { alias: 'c', hostName: '1.2.3.4', user: 'r' }), 'Host c\n  HostName 1.2.3.4\n  User r\n');
});

test('appendHost: rejeita alias duplicado ou inseguro e host inválido', () => {
  assert.throws(() => appendHost('Host a\n', { alias: 'a', hostName: 'x' }), /já existe/);
  assert.throws(() => appendHost('', { alias: '-oProxyCommand=x', hostName: 'x' }), /Apelido/);
  assert.throws(() => appendHost('', { alias: 'a b', hostName: 'x' }), /Apelido/);
  assert.throws(() => appendHost('', { alias: 'a*', hostName: 'x' }), /Apelido/);
  assert.throws(() => appendHost('', { alias: 'a', hostName: 'x\nProxyCommand evil' }), /Host/);
  assert.throws(() => appendHost('', { alias: 'a', hostName: 'x', user: 'a;b' }), /Usuário/);
  assert.throws(() => appendHost('', { alias: 'a', hostName: 'x', port: 70000 }), /Porta/);
});

test('parseTarget: formatos válidos', () => {
  assert.deepEqual(parseTarget('user@host:22'), { user: 'user', host: 'host', port: 22 });
  assert.deepEqual(parseTarget('  deploy@10.0.0.5  '), { user: 'deploy', host: '10.0.0.5', port: null });
  assert.deepEqual(parseTarget('example.com'), { user: null, host: 'example.com', port: null });
  assert.deepEqual(parseTarget('ana.silva@srv-01.example.com:2222'), { user: 'ana.silva', host: 'srv-01.example.com', port: 2222 });
  assert.deepEqual(parseTarget('root@[::1]:2200'), { user: 'root', host: '::1', port: 2200 });
  assert.deepEqual(parseTarget('[fe80::1]'), { user: null, host: 'fe80::1', port: null });
});

test('parseTarget: rejeita injeção e entradas malformadas', () => {
  const bad = [
    '', '   ', null, 42, '-oProxyCommand=calc', 'user@-host', '-user@host', 'user@host;rm -rf /',
    'user@host && ls', 'us er@host', 'user@ho st', 'user@host:0', 'user@host:65536', 'user@host:22x',
    'user@host:', '@host', 'user@', 'a@b@c', 'user@host|x', 'user@$(id)', 'user@`id`', 'user@host\nx',
    "user@ho'st", 'user@ho"st', 'user@[::1', 'user@[zz::1]', 'x'.repeat(300),
  ];
  for (const b of bad) assert.equal(parseTarget(b), null, `deveria rejeitar ${JSON.stringify(b)}`);
});

test('buildSshArgs: alias e alvo', () => {
  assert.deepEqual(buildSshArgs('prod'), ['prod']);
  assert.deepEqual(buildSshArgs({ alias: 'prod' }), ['prod']);
  assert.deepEqual(buildSshArgs({ user: 'u', host: 'h', port: 2222 }), ['-p', '2222', 'u@h']);
  assert.deepEqual(buildSshArgs({ host: 'h' }), ['h']);
  assert.deepEqual(buildSshArgs({ user: 'u', host: '::1', port: 22 }), ['-p', '22', 'u@::1']);
  assert.deepEqual(buildSshArgs('user@host:22'), ['-p', '22', 'user@host']);
});

test('buildSshArgs: rejeita entradas perigosas', () => {
  for (const b of ['-oProxyCommand=x', 'a b', 'a;b', '', null, { host: '-x' }, { host: 'h', user: '-u' },
    { host: 'h', port: '22; ls' }, { host: 'h', port: 0 }, { alias: 'a*' }, { host: 'h h' }]) {
    assert.throws(() => buildSshArgs(b), /inválid/i, JSON.stringify(b));
  }
});

test('isSafeAlias', () => {
  assert.equal(isSafeAlias('my_host.prod-1'), true);
  for (const b of ['', '-x', 'a b', 'a*', 'a?', '!a', 'a;b', 'a/b', 'x'.repeat(200)]) assert.equal(isSafeAlias(b), false, b);
});
