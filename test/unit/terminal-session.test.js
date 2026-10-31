const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const {
  createTerminalSession,
  resolveShell,
  resolveShellArgs,
  normalizePipeInput,
} = require('../../src/main/lib/terminal-session');

/* --------------------------------------------------------------------------
   Helpers: pty e pipe falsos, para exercitar os dois modos sem depender de
   /dev/ptmx (bloqueado em alguns ambientes) nem de node-pty compilado.
   -------------------------------------------------------------------------- */

function fakePty() {
  const proc = {
    pid: 4242,
    written: [],
    resized: [],
    killed: false,
    _data: null,
    _exit: null,
    onData(cb) { this._data = cb; },
    onExit(cb) { this._exit = cb; },
    write(d) { this.written.push(d); },
    resize(c, r) { this.resized.push([c, r]); },
    kill() { this.killed = true; },
    emitData(d) { this._data?.(d); },
    emitExit(code) { this._exit?.({ exitCode: code }); },
  };
  return {
    spawnOptions: null,
    spawn(shell, args, opts) {
      this.spawnOptions = { shell, args, opts };
      return proc;
    },
    proc,
  };
}

function fakePipe() {
  const proc = new EventEmitter();
  proc.pid = 777;
  proc.stdin = { writable: true, written: [], write(d) { this.written.push(d); } };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = () => { proc.killed = true; };
  return proc;
}

/* -------------------------------------------------------------------------- */

test('resolveShell: PowerShell no Windows, SHELL no resto, override explícito', () => {
  assert.equal(resolveShell('win32', { SHELL: '/usr/bin/bash' }), 'powershell.exe');
  assert.equal(resolveShell('darwin', { SHELL: '/bin/zsh' }), '/bin/zsh');
  assert.equal(resolveShell('linux', {}), 'bash');
  assert.equal(resolveShell('win32', { AGZOS_TERM_SHELL: 'pwsh.exe' }), 'pwsh.exe');
});

test('resolveShellArgs: interativo só com pty', () => {
  assert.deepEqual(resolveShellArgs('powershell.exe'), ['-NoLogo']);
  assert.deepEqual(resolveShellArgs('C:\\Windows\\System32\\cmd.exe'), []);
  assert.deepEqual(resolveShellArgs('/bin/bash'), ['-i']);
  assert.deepEqual(resolveShellArgs('/bin/zsh'), ['-i']);

  // Sem pty, `-i` faz o shell tentar gravar histórico/sessão e falhar.
  assert.deepEqual(resolveShellArgs('/bin/zsh', { interactive: false }), []);
  assert.deepEqual(resolveShellArgs('/bin/bash', { interactive: false }), []);
  assert.deepEqual(resolveShellArgs('powershell.exe', { interactive: false }), ['-NoLogo']);
});

test('normalizePipeInput: CR e CRLF viram LF', () => {
  assert.equal(normalizePipeInput('dir\r'), 'dir\n');
  assert.equal(normalizePipeInput('a\r\nb'), 'a\nb');
  assert.equal(normalizePipeInput('sem-quebra'), 'sem-quebra');
});

test('com pty: usa node-pty e repassa dados e saída', () => {
  const pty = fakePty();
  const chunks = [];
  const exits = [];

  const session = createTerminalSession({
    id: 't1',
    platform: 'win32',
    env: { SHELL: '/bin/bash' },
    ptyLoader: () => pty,
    onData: (d) => chunks.push(d),
    onExit: (c) => exits.push(c),
  });

  assert.equal(session.mode, 'pty');
  assert.equal(session.usesPty, true);
  assert.equal(pty.spawnOptions.shell, 'powershell.exe');
  assert.equal(pty.spawnOptions.opts.name, 'xterm-256color');
  assert.equal(pty.spawnOptions.opts.cols, 80);

  pty.proc.emitData('PS C:\\> ');
  assert.deepEqual(chunks, ['PS C:\\> ']);

  pty.proc.emitExit(0);
  assert.deepEqual(exits, [0]);
});

test('com pty: write NÃO normaliza CR (Ctrl+C e atalhos dependem do CR)', () => {
  const pty = fakePty();
  const session = createTerminalSession({
    id: 't1', platform: 'linux', env: {}, ptyLoader: () => pty,
  });

  assert.equal(session.write('echo oi\r'), true);
  assert.deepEqual(pty.proc.written, ['echo oi\r'], 'CR deve chegar intacto ao pty');

  assert.equal(session.write('\x03'), true, 'Ctrl+C vai cru para o pty');
  assert.deepEqual(pty.proc.written.at(-1), '\x03');
});

test('com pty: resize chega ao pty', () => {
  const pty = fakePty();
  const session = createTerminalSession({
    id: 't1', platform: 'linux', env: {}, cols: 100, rows: 40, ptyLoader: () => pty,
  });

  assert.equal(pty.spawnOptions.opts.cols, 100);
  assert.equal(pty.spawnOptions.opts.rows, 40);

  assert.equal(session.resize(132, 43), true);
  assert.deepEqual(pty.proc.resized, [[132, 43]]);

  // valores inválidos são saneados, não explodem
  assert.equal(session.resize(0, -5), true);
  assert.deepEqual(pty.proc.resized.at(-1), [1, 1]);
});

test('com pty: kill encerra o processo', () => {
  const pty = fakePty();
  const session = createTerminalSession({
    id: 't1', platform: 'linux', env: {}, ptyLoader: () => pty,
  });
  session.kill();
  assert.equal(pty.proc.killed, true);
});

test('sem node-pty: cai para pipes e avisa o motivo', () => {
  const proc = fakePipe();
  const chunks = [];
  let spawned = null;

  const session = createTerminalSession({
    id: 't2',
    platform: 'win32',
    env: {},
    ptyLoader: () => null,
    pipeSpawn: (shell, args, opts) => { spawned = { shell, args, opts }; return proc; },
    onData: (d) => chunks.push(d),
  });

  assert.equal(session.mode, 'pipe');
  assert.equal(session.usesPty, false);
  assert.match(session.fallbackReason, /node-pty/);
  assert.equal(spawned.shell, 'powershell.exe');

  proc.stdout.emit('data', Buffer.from('saida\n'));
  assert.deepEqual(chunks, ['saida\n']);
});

test('sem pty: write normaliza CR para o pipe (Enter funciona)', () => {
  const proc = fakePipe();
  const session = createTerminalSession({
    id: 't2', platform: 'linux', env: {}, ptyLoader: () => null,
    pipeSpawn: () => proc,
  });

  session.write('dir\r');
  assert.deepEqual(proc.stdin.written, ['dir\n']);
});

test('sem pty: resize é no-op e não lança', () => {
  const proc = fakePipe();
  const session = createTerminalSession({
    id: 't2', platform: 'linux', env: {}, ptyLoader: () => null,
    pipeSpawn: () => proc,
  });
  assert.equal(session.resize(100, 40), false);
});

test('pty que falha ao spawnar cai para pipes (ex.: /dev/ptmx bloqueado)', () => {
  const proc = fakePipe();
  const pty = {
    spawn() { throw new Error('posix_spawnp failed.'); },
  };

  const session = createTerminalSession({
    id: 't3',
    platform: 'linux',
    env: {},
    ptyLoader: () => pty,
    pipeSpawn: () => proc,
  });

  assert.equal(session.mode, 'pipe');
  assert.match(session.fallbackReason, /posix_spawnp/);
  assert.equal(session.write('ls\r'), true);
  assert.deepEqual(proc.stdin.written, ['ls\n']);
});

test('sem pty: erro do spawn vira mensagem no terminal, não exceção', () => {
  const proc = fakePipe();
  const chunks = [];
  const session = createTerminalSession({
    id: 't4', platform: 'linux', env: {}, ptyLoader: () => null,
    pipeSpawn: () => proc,
    onData: (d) => chunks.push(d),
  });

  proc.emit('error', new Error('ENOENT'));
  assert.match(chunks.join(''), /Falha ao iniciar/);
  assert.equal(session.mode, 'pipe');
});

test('write em sessão morta devolve false em vez de lançar', () => {
  const proc = fakePipe();
  proc.stdin.writable = false;
  const session = createTerminalSession({
    id: 't5', platform: 'linux', env: {}, ptyLoader: () => null,
    pipeSpawn: () => proc,
  });
  assert.equal(session.write('x\r'), false);
});
