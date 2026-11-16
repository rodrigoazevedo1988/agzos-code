const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const term = require('../../src/main/ipc/term');

const { resolveShell, shellArgs, createLineDiscipline } = term;

function ld(opts = {}) {
  const out = { echo: '', lines: [], interrupts: 0, eofs: 0 };
  const d = createLineDiscipline({
    echo: (t) => { out.echo += t; },
    submit: (l) => out.lines.push(l),
    interrupt: () => { out.interrupts++; },
    eof: () => { out.eofs++; },
    ...opts,
  });
  return { d, out };
}

// --- disciplina de linha ----------------------------------------------------

test('line discipline: eco local e Enter envia linha com \\n', () => {
  const { d, out } = ld();
  d.feed('echo hi');
  assert.equal(out.echo, 'echo hi');
  assert.deepEqual(out.lines, []);
  d.feed('\r');
  assert.deepEqual(out.lines, ['echo hi\n']);
  assert.equal(out.echo, 'echo hi\r\n');
  assert.equal(d.buffer, '');
});

test('line discipline: eol do Windows', () => {
  const { d, out } = ld({ eol: '\r\n' });
  d.feed('dir\r');
  assert.deepEqual(out.lines, ['dir\r\n']);
});

test('line discipline: backspace apaga do buffer e da tela', () => {
  const { d, out } = ld();
  d.feed('lsx\x7f');
  assert.equal(d.buffer, 'ls');
  assert.ok(out.echo.endsWith('\b \b'));
  d.feed('\b\b\b\b'); // além do início: não apaga o prompt
  assert.equal(d.buffer, '');
  assert.equal(out.echo.split('\b \b').length - 1, 3);
  d.feed('\r');
  assert.deepEqual(out.lines, ['\n']);
});

test('line discipline: backspace remove code point inteiro (emoji)', () => {
  const { d } = ld();
  d.feed('a😀\x7f');
  assert.equal(d.buffer, 'a');
});

test('line discipline: Ctrl+C limpa a linha e interrompe', () => {
  const { d, out } = ld();
  d.feed('sleep 100');
  d.feed('\x03');
  assert.equal(out.interrupts, 1);
  assert.equal(d.buffer, '');
  assert.ok(out.echo.endsWith('^C\r\n'));
  assert.deepEqual(out.lines, []);
});

test('line discipline: Ctrl+D só com linha vazia', () => {
  const { d, out } = ld();
  d.feed('x\x04');
  assert.equal(out.eofs, 0);
  d.feed('\x7f\x04');
  assert.equal(out.eofs, 1);
});

test('line discipline: Ctrl+U apaga a linha toda', () => {
  const { d, out } = ld();
  d.feed('abc\x15');
  assert.equal(d.buffer, '');
  assert.ok(out.echo.endsWith('\b \b\b \b\b \b'));
});

test('line discipline: paste multi-linha com \\r\\n executa cada linha uma vez', () => {
  const { d, out } = ld();
  d.feed('echo 1\r\necho 2\r\npartial');
  assert.deepEqual(out.lines, ['echo 1\n', 'echo 2\n']);
  assert.equal(d.buffer, 'partial');
  d.feed('\n');
  assert.deepEqual(out.lines, ['echo 1\n', 'echo 2\n', 'partial\n']);
});

test('line discipline: sequências de escape (setas) são ignoradas', () => {
  const { d, out } = ld();
  d.feed('a\x1b[A\x1b[1;5Cb\x1bOPc');
  assert.equal(d.buffer, 'abc');
  assert.equal(out.echo, 'abc');
});

// --- allowlist de shell -----------------------------------------------------

const linux = { platform: 'linux', env: { SHELL: '/bin/bash' }, exists: () => true };
const win = { platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, exists: () => true };

test('resolveShell: vazio usa o padrão da plataforma', () => {
  assert.deepEqual(resolveShell(undefined, linux), { shell: '/bin/bash', rejected: null });
  assert.deepEqual(resolveShell('', win), { shell: 'powershell.exe', rejected: null });
});

test('resolveShell: nomes da allowlist passam', () => {
  for (const s of ['bash', 'zsh', 'sh', 'fish', 'pwsh', 'powershell.exe', 'cmd.exe', 'PowerShell.EXE']) {
    assert.equal(resolveShell(s, win).shell, s);
  }
  assert.equal(resolveShell('/usr/bin/zsh', linux).shell, '/usr/bin/zsh');
  assert.equal(resolveShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe', win).shell, 'C:\\Program Files\\PowerShell\\7\\pwsh.exe');
});

test('resolveShell: executáveis fora da allowlist são rejeitados', () => {
  for (const s of ['python', 'node', '/tmp/evil', 'C:\\evil\\bash.bat', 'rm', 'bash -c "rm -rf /"', 'calc.exe']) {
    const r = resolveShell(s, s.includes('\\') ? win : linux);
    assert.notEqual(r.shell, s, s);
    assert.equal(r.rejected, s, s);
  }
});

test('resolveShell: caminho relativo, inexistente ou não-string é rejeitado', () => {
  assert.equal(resolveShell('./bash', linux).rejected, './bash');
  assert.equal(resolveShell('/opt/bash', { ...linux, exists: () => false }).rejected, '/opt/bash');
  assert.equal(resolveShell({ toString: () => 'bash' }, linux).shell, '/bin/bash');
  assert.equal(resolveShell('bash\0', linux).shell, '/bin/bash');
});

test('resolveShell: $SHELL do ambiente é aceito mesmo fora da allowlist', () => {
  const env = { platform: 'linux', env: { SHELL: '/usr/local/bin/nu' }, exists: () => true };
  assert.equal(resolveShell('/usr/local/bin/nu', env).shell, '/usr/local/bin/nu');
  assert.equal(resolveShell('/usr/local/bin/xonsh', env).rejected, '/usr/local/bin/xonsh');
});

test('shellArgs: pty x pipe', () => {
  assert.deepEqual(shellArgs('/bin/bash', 'pty', 'linux'), []);
  assert.deepEqual(shellArgs('/bin/zsh', 'pty', 'darwin'), ['-l']);
  assert.deepEqual(shellArgs('/bin/bash', 'pipe', 'linux'), ['--noediting', '-i']);
  assert.deepEqual(shellArgs('/bin/sh', 'pipe', 'linux'), ['-i']);
  assert.deepEqual(shellArgs('powershell.exe', 'pty', 'win32'), ['-NoLogo', '-ExecutionPolicy', 'Bypass']);
  assert.deepEqual(shellArgs('powershell.exe', 'pipe', 'win32'), ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command', '-']);
  assert.deepEqual(shellArgs('cmd.exe', 'pty', 'win32'), []);
});

// --- IPC: integração real (modo pipe e pty no Linux) -------------------------

function fakeIpc() {
  const handlers = new Map();
  return { handle: (ch, fn) => handlers.set(ch, fn), handlers };
}

function fakeSender(id = 1) {
  const s = new EventEmitter();
  s.id = id;
  s.sent = [];
  s.isDestroyed = () => false;
  s.send = (ch, ...args) => s.sent.push([ch, ...args]);
  return s;
}

function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fn()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('timeout'));
      setTimeout(tick, 30);
    };
    tick();
  });
}

const posix = process.platform !== 'win32';

test('IPC: valida dono da sessão, cwd inválido e mata shells quando o renderer some', { skip: !posix }, async () => {
  const ipc = fakeIpc();
  term.register(ipc);
  const sender = fakeSender(42);
  const evt = { sender };
  const res = await ipc.handlers.get('term:create')(evt, 80, 24, { cwd: '/definitely/not/here', shell: '/bin/sh' });
  assert.equal(res.cwd, require('os').homedir());
  assert.ok(term._sessions.has(res.id));
  const pid = term._sessions.get(res.id).pid;

  // Outro webContents não escreve nem mata a sessão
  const other = { sender: fakeSender(7) };
  assert.equal(await ipc.handlers.get('term:write')(other, res.id, 'x'), false);
  assert.equal(await ipc.handlers.get('term:kill')(other, res.id), false);
  assert.ok(term._sessions.has(res.id));

  sender.emit('render-process-gone');
  assert.equal(term._sessions.has(res.id), false);
  await waitFor(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
});

test('IPC modo pipe: echo + Enter executa e devolve a saída', { skip: !posix }, async () => {
  process.env.AGZOS_TERM_NO_PTY = '1';
  // módulo novo para reler a env
  delete require.cache[require.resolve('../../src/main/ipc/term')];
  const fresh = require('../../src/main/ipc/term');
  const ipc = fakeIpc();
  fresh.register(ipc);
  const sender = fakeSender(5);
  const evt = { sender };
  try {
    const res = await ipc.handlers.get('term:create')(evt, 80, 24, { shell: '/bin/sh', cwd: '/tmp' });
    assert.equal(res.mode, 'pipe');
    const out = () => sender.sent.filter((m) => m[0] === 'term:data' && m[1] === res.id).map((m) => m[2]).join('');
    for (const ch of 'echo agzos-ok') await ipc.handlers.get('term:write')(evt, res.id, ch);
    await ipc.handlers.get('term:write')(evt, res.id, '\r');
    await waitFor(() => /agzos-ok\r\n[\s\S]*agzos-ok/.test(out()));
    // Escrever depois que o shell morreu não pode lançar (EPIPE)
    await ipc.handlers.get('term:write')(evt, res.id, 'exit\r');
    await waitFor(() => sender.sent.some((m) => m[0] === 'term:exit' && m[1] === res.id));
    assert.equal(await ipc.handlers.get('term:write')(evt, res.id, 'more\r'), false);
  } finally {
    fresh.killAll();
    delete process.env.AGZOS_TERM_NO_PTY;
  }
});

// --- perfis de terminal -------------------------------------------------------

const { detectProfiles, resolveLaunch, profileArgs } = term;

function fakeFs(paths) {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return (p) => set.has(String(p).toLowerCase());
}

const WIN_ENV = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\rod\\AppData\\Local',
  ComSpec: 'C:\\Windows\\system32\\cmd.exe',
  Path: 'C:\\Windows\\system32;C:\\Program Files\\PowerShell\\7',
};
const WIN_PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const WIN_PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const WIN_GIT = 'C:\\Users\\rod\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';
const WIN_WSL = 'C:\\Windows\\System32\\wsl.exe';

test('detectProfiles (Windows): todos instalados, pwsh é o padrão', () => {
  const exists = fakeFs([WIN_PS, WIN_PWSH, WIN_GIT, WIN_WSL, WIN_ENV.ComSpec]);
  const { profiles, defaultId } = detectProfiles({ platform: 'win32', env: WIN_ENV, exists });
  assert.equal(defaultId, 'pwsh');
  assert.deepEqual(profiles.map((p) => p.id), ['pwsh', 'powershell', 'cmd', 'gitbash', 'wsl']);
  const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
  assert.equal(byId.pwsh.shell.toLowerCase(), WIN_PWSH.toLowerCase());
  assert.equal(byId.gitbash.shell, WIN_GIT);
  assert.deepEqual(byId.gitbash.args, ['--login', '-i']);
  assert.deepEqual(byId.wsl.args, []);
  assert.equal(byId.wsl.icon, 'wsl');
  assert.equal(byId.cmd.icon, 'cmd');
  assert.equal(byId.pwsh.icon, 'powershell');
  assert.equal(byId.gitbash.icon, 'bash');
});

test('detectProfiles (Windows): sem pwsh, sem git/wsl → powershell padrão', () => {
  const exists = fakeFs([WIN_PS, WIN_ENV.ComSpec]);
  const { profiles, defaultId } = detectProfiles({ platform: 'win32', env: { ...WIN_ENV, Path: '' }, exists });
  assert.equal(defaultId, 'powershell');
  assert.deepEqual(profiles.map((p) => p.id), ['powershell', 'cmd']);
});

test('detectProfiles (Windows): pwsh em ProgramFiles fora do PATH, Git em ProgramFiles', () => {
  const git = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const exists = fakeFs([WIN_PWSH, git]);
  const { profiles } = detectProfiles({ platform: 'win32', env: { ...WIN_ENV, Path: 'C:\\Windows' }, exists });
  assert.deepEqual(profiles.map((p) => [p.id, p.shell]), [['pwsh', WIN_PWSH], ['gitbash', git]]);
});

test('detectProfiles (POSIX): $SHELL vira padrão, só shells existentes', () => {
  const env = { SHELL: '/usr/bin/zsh', PATH: '/usr/local/bin:/usr/bin:/bin' };
  const exists = fakeFs(['/usr/bin/zsh', '/bin/zsh', '/usr/bin/bash', '/bin/sh']);
  const { profiles, defaultId } = detectProfiles({ platform: 'linux', env, exists });
  assert.equal(defaultId, 'zsh');
  assert.deepEqual(profiles.map((p) => [p.id, p.shell]), [['bash', '/usr/bin/bash'], ['zsh', '/usr/bin/zsh'], ['sh', '/bin/sh']]);
});

test('detectProfiles (POSIX): $SHELL fora da lista vira default-shell', () => {
  const env = { SHELL: '/usr/local/bin/nu', PATH: '/bin' };
  const exists = fakeFs(['/usr/local/bin/nu', '/bin/bash']);
  const { profiles, defaultId } = detectProfiles({ platform: 'darwin', env, exists });
  assert.equal(defaultId, 'default-shell');
  assert.deepEqual(profiles[0], { id: 'default-shell', label: 'nu', shell: '/usr/local/bin/nu', args: [], icon: 'terminal' });
  assert.equal(profiles[1].id, 'bash');
});

test('resolveLaunch: profileId conhecido, desconhecido e shell legado', () => {
  const exists = fakeFs([WIN_PS, WIN_PWSH, WIN_GIT, WIN_WSL, WIN_ENV.ComSpec]);
  const ctx = { platform: 'win32', env: WIN_ENV, exists };

  const git = resolveLaunch({ profileId: 'gitbash' }, ctx);
  assert.equal(git.shell, WIN_GIT);
  assert.equal(git.profileId, 'gitbash');
  assert.equal(git.label, 'Git Bash');
  assert.deepEqual(git.warnings, []);

  const unk = resolveLaunch({ profileId: 'nope' }, ctx);
  assert.equal(unk.profileId, 'pwsh');
  assert.match(unk.warnings[0], /nope/);

  const none = resolveLaunch({}, ctx);
  assert.equal(none.profileId, 'pwsh');

  // Caminho absoluto detectado (wsl.exe / Git Bash) é aceito via `shell`.
  const wsl = resolveLaunch({ shell: WIN_WSL }, ctx);
  assert.equal(wsl.profileId, 'wsl');
  assert.deepEqual(wsl.warnings, []);

  const bad = resolveLaunch({ shell: 'C:\\evil\\calc.exe' }, ctx);
  assert.equal(bad.profileId, 'pwsh');
  assert.match(bad.warnings[0], /não permitido/);

  const legacy = resolveLaunch({ shell: 'cmd.exe' }, ctx);
  assert.equal(legacy.shell, 'cmd.exe');
  assert.equal(legacy.profileId, 'cmd');
});

test('resolveShell: caminho confiável (detectado) passa mesmo com nome fora da allowlist', () => {
  const opts = { platform: 'linux', env: { SHELL: '/bin/bash' }, exists: () => true };
  assert.ok(resolveShell('/opt/x/xonsh', opts).rejected);
  assert.equal(resolveShell('/opt/x/xonsh', { ...opts, trusted: ['/opt/x/xonsh'] }).rejected, null);
});

test('profileArgs: Git Bash --login -i, WSL sem args', () => {
  assert.deepEqual(profileArgs({ id: 'gitbash', shell: WIN_GIT }, 'pty', 'win32'), ['--login', '-i']);
  assert.deepEqual(profileArgs({ id: 'gitbash', shell: WIN_GIT }, 'pipe', 'win32'), ['--login', '--noediting', '-i']);
  assert.deepEqual(profileArgs({ id: 'wsl', shell: WIN_WSL }, 'pty', 'win32'), []);
  assert.deepEqual(profileArgs({ id: 'pwsh', shell: WIN_PWSH }, 'pty', 'win32'), ['-NoLogo', '-ExecutionPolicy', 'Bypass']);
});
