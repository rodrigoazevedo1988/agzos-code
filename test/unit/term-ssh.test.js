const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const term = require('../../src/main/ipc/term');

const { findSsh, resolveSshLaunch, resolveLaunch, listProfiles, SSH_ALLOWLIST } = term;

function fakeFs(paths) {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (p) => set.has(String(p).toLowerCase());
}

const WIN_ENV = { SystemRoot: 'C:\\Windows', Path: 'C:\\Windows\\system32;C:\\Tools' };
const WIN_SSH = 'C:\\Windows\\System32\\OpenSSH\\ssh.exe';
const LIN = { platform: 'linux', env: { PATH: '/usr/local/bin:/usr/bin', SHELL: '/bin/bash' } };

test('allowlist do SSH contém só o cliente ssh', () => {
  assert.deepEqual(SSH_ALLOWLIST, ['ssh']);
});

test('findSsh: Windows prefere System32\\OpenSSH, depois PATH; ausente → null', () => {
  assert.equal(findSsh({ platform: 'win32', env: WIN_ENV, exists: fakeFs([WIN_SSH]) }), WIN_SSH);
  assert.equal(findSsh({ platform: 'win32', env: WIN_ENV, exists: fakeFs(['C:\\Tools\\ssh.exe']) }), 'C:\\Tools\\ssh.exe');
  assert.equal(findSsh({ platform: 'win32', env: WIN_ENV, exists: fakeFs([]) }), null);
});

test('findSsh: POSIX pelo PATH ou caminhos comuns', () => {
  assert.equal(findSsh({ ...LIN, exists: fakeFs(['/usr/bin/ssh']) }), '/usr/bin/ssh');
  assert.equal(findSsh({ ...LIN, env: {}, exists: fakeFs(['/usr/bin/ssh']) }), '/usr/bin/ssh');
  assert.equal(findSsh({ ...LIN, exists: fakeFs([]) }), null);
});

test('resolveSshLaunch: alias e alvo viram argumentos em array', () => {
  const exists = fakeFs(['/usr/bin/ssh']);
  const a = resolveSshLaunch({ alias: 'prod' }, { ...LIN, exists });
  assert.equal(a.shell, '/usr/bin/ssh');
  assert.deepEqual(a.args, ['prod']);
  assert.equal(a.label, 'SSH: prod');
  assert.equal(a.profileId, 'ssh');

  const t = resolveSshLaunch({ user: 'deploy', host: '10.0.0.5', port: 2222 }, { ...LIN, exists });
  assert.deepEqual(t.args, ['-p', '2222', 'deploy@10.0.0.5']);
  assert.equal(t.label, 'SSH: 10.0.0.5');

  const w = resolveSshLaunch({ alias: 'prod' }, { platform: 'win32', env: WIN_ENV, exists: fakeFs([WIN_SSH]) });
  assert.equal(w.shell, WIN_SSH);
  assert.deepEqual(w.args, ['prod']);
});

test('resolveSshLaunch: rejeita argumentos perigosos', () => {
  const ctx = { ...LIN, exists: fakeFs(['/usr/bin/ssh']) };
  const bad = [
    { alias: '-oProxyCommand=touch /tmp/x' },
    { alias: 'a b' },
    { alias: 'a;b' },
    { host: '-oProxyCommand=x' },
    { host: 'h', user: '-l' },
    { host: 'h', user: 'a b' },
    { host: 'h;id' },
    { host: 'h', port: '22 -oX' },
    { host: 'h', port: 99999 },
    'prod',
    null,
    { alias: 'prod', extraArgs: ['-o', 'x'] },
  ];
  for (const b of bad) {
    const r = resolveSshLaunch(b, ctx);
    if (b && typeof b === 'object' && b.extraArgs) {
      // Campos extras são ignorados: só o alias vira argumento.
      assert.deepEqual(r.args, ['prod']);
      continue;
    }
    assert.ok(r.error, `deveria rejeitar ${JSON.stringify(b)}`);
    assert.equal(r.args, undefined);
  }
});

test('resolveSshLaunch: ssh ausente devolve erro com instrução de instalação', () => {
  const lin = resolveSshLaunch({ alias: 'prod' }, { ...LIN, exists: fakeFs([]) });
  assert.equal(lin.code, 'ssh-missing');
  assert.match(lin.error, /openssh-client|OpenSSH/);
  const win = resolveSshLaunch({ alias: 'prod' }, { platform: 'win32', env: WIN_ENV, exists: fakeFs([]) });
  assert.equal(win.code, 'ssh-missing');
  assert.match(win.error, /Cliente OpenSSH|recurso opcional/i);
});

test('resolveLaunch: opção ssh tem prioridade e não aceita shell/args do renderer', () => {
  const r = resolveLaunch({ ssh: { alias: 'prod' }, shell: '/bin/sh', args: ['-c', 'id'] },
    { ...LIN, exists: fakeFs(['/usr/bin/ssh', '/bin/bash']) });
  assert.equal(r.shell, '/usr/bin/ssh');
  assert.deepEqual(r.sshArgs, ['prod']);
  assert.equal(r.profileId, 'ssh');
});

test('resolveShell continua rejeitando ssh como shell comum', () => {
  const { resolveShell } = term;
  assert.ok(resolveShell('ssh', { platform: 'linux', env: { SHELL: '/bin/bash' }, exists: () => true }).rejected);
});

test('listProfiles acrescenta o perfil SSH… (seletor) sem mudar o padrão', () => {
  const { profiles, defaultId } = listProfiles({ ...LIN, exists: fakeFs(['/bin/bash', '/usr/bin/ssh']) });
  const ssh = profiles.find((p) => p.id === 'ssh');
  assert.deepEqual(ssh, { id: 'ssh', label: 'SSH…', shell: '', args: [], icon: 'remote', picker: true });
  assert.equal(defaultId, 'bash');
  assert.equal(profiles[profiles.length - 1].id, 'ssh');
});

test('IPC term:create com ssh: inicia o ssh com args em array (sem shell)', { skip: process.platform === 'win32' }, async () => {
  const handlers = new Map();
  term.register({ handle: (ch, fn) => handlers.set(ch, fn) });
  const sender = new EventEmitter();
  sender.id = 99;
  sender.sent = [];
  sender.isDestroyed = () => false;
  sender.send = (ch, ...args) => sender.sent.push([ch, ...args]);
  const prev = process.env.AGZOS_TEST;
  process.env.AGZOS_TEST = '1';
  try {
    const bad = await handlers.get('term:create')({ sender }, 80, 24, { ssh: { alias: '-oProxyCommand=id' } });
    assert.ok(bad.error);
    assert.equal(bad.id, undefined);

    const res = await handlers.get('term:create')({ sender }, 80, 24, { ssh: { user: 'ninguem', host: '127.0.0.1', port: 1 } });
    if (res.code === 'ssh-missing') return; // sem cliente ssh na máquina de teste
    assert.ok(res.id);
    assert.equal(res.label, 'SSH: 127.0.0.1');
    assert.deepEqual(global.__agzosLastSpawn.args, ['-p', '1', 'ninguem@127.0.0.1']);
    assert.match(global.__agzosLastSpawn.shell, /ssh$/);
  } finally {
    term.killAll();
    if (prev === undefined) delete process.env.AGZOS_TEST;
    else process.env.AGZOS_TEST = prev;
  }
});
