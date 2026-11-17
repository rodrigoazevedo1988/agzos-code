const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRegQuery, expandVars, buildRegistryEnv, refreshEnv, readRegistryEnv, captureStartupEnv, freshEnv,
} = require('../../src/main/lib/win-env');

const REG_USER = [
  '',
  'HKEY_CURRENT_USER\\Environment',
  '    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Programs\\bin;C:\\tools',
  '    TEMP    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Temp',
  '    ANTHROPIC_API_KEY    REG_SZ    sk-ant-velha',
  '    EMPTY    REG_SZ',
  '',
].join('\r\n');

test('parseRegQuery lê REG_SZ/REG_EXPAND_SZ, incluindo vazio', () => {
  assert.deepEqual(parseRegQuery(REG_USER), {
    Path: '%USERPROFILE%\\AppData\\Local\\Programs\\bin;C:\\tools',
    TEMP: '%USERPROFILE%\\AppData\\Local\\Temp',
    ANTHROPIC_API_KEY: 'sk-ant-velha',
    EMPTY: '',
  });
});

test('expandVars é case-insensitive e mantém desconhecidas', () => {
  assert.equal(expandVars('%userprofile%\\x;%NOPE%', { USERPROFILE: 'C:\\Users\\R' }), 'C:\\Users\\R\\x;%NOPE%');
});

test('buildRegistryEnv: usuário sobrescreve máquina e Path é concatenado', () => {
  const env = buildRegistryEnv(
    { Path: 'C:\\Windows', OS: 'Windows_NT', FOO: 'maq' },
    { PATH: 'C:\\tools', foo: 'user' },
    {},
  );
  assert.equal(env.Path, 'C:\\Windows;C:\\tools');
  assert.equal(env.foo, 'user');
  assert.equal(env.FOO, undefined);
  assert.equal(env.OS, 'Windows_NT');
});

test('refreshEnv remove variável apagada do registro depois do início do app', () => {
  const startup = { ANTHROPIC_API_KEY: 'sk-ant-velha', Path: 'C:\\Windows' };
  const current = { Path: 'C:\\Windows' };
  const base = { ANTHROPIC_API_KEY: 'sk-ant-velha', Path: 'C:\\Windows', ELECTRON_X: '1' };
  const env = refreshEnv(base, startup, current);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.ELECTRON_X, '1');
});

test('refreshEnv aplica valor novo/alterado e preserva o que o processo definiu', () => {
  const startup = { A: '1', B: 'reg', Path: 'C:\\Windows' };
  const current = { A: '2', B: 'reg', C: 'novo', Path: 'C:\\Windows;C:\\novo' };
  const base = { A: '1', B: 'processo', Path: 'C:\\app\\bin;C:\\Windows' };
  const env = refreshEnv(base, startup, current);
  assert.equal(env.A, '2');
  assert.equal(env.B, 'processo');
  assert.equal(env.C, 'novo');
  assert.equal(env.Path, 'C:\\app\\bin;C:\\Windows;C:\\novo');
});

test('refreshEnv não remove variável removida do registro se o processo mudou o valor', () => {
  const env = refreshEnv({ X: 'outro' }, { X: 'reg' }, {});
  assert.equal(env.X, 'outro');
});

test('fora do Windows não consulta o registro', () => {
  let called = false;
  const exec = () => { called = true; return ''; };
  assert.equal(readRegistryEnv({ platform: 'linux', exec }), null);
  assert.deepEqual(freshEnv({ platform: 'linux', baseEnv: { A: '1' } }), { A: '1' });
  assert.equal(called, false);
});

test('freshEnv no Windows reflete remoção feita após o startup', () => {
  let userOut = REG_USER;
  const exec = (_cmd, args) => (args[1].startsWith('HKCU') ? userOut : '\r\nHKEY_LOCAL_MACHINE\\...\r\n    Path    REG_EXPAND_SZ    C:\\Windows\r\n');
  const baseEnv = { USERPROFILE: 'C:\\Users\\R', ANTHROPIC_API_KEY: 'sk-ant-velha', Path: 'C:\\Windows' };
  captureStartupEnv({ platform: 'win32', exec, baseEnv });
  userOut = REG_USER.replace(/^.*ANTHROPIC_API_KEY.*$/m, '');
  const env = freshEnv({ platform: 'win32', exec, baseEnv });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.match(env.Path, /C:\\Users\\R\\AppData\\Local\\Programs\\bin/);
  captureStartupEnv({ platform: 'linux' });
});

const { cleanEnv } = require('../../src/main/lib/win-env');

test('cleanEnv descarta variáveis herdadas que não estão no registro (ex.: ANTHROPIC_* de outro processo)', () => {
  const base = {
    SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\R', ComSpec: 'C:\\Windows\\system32\\cmd.exe',
    ANTHROPIC_MODEL: 'claude-3-5-sonnet', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1337', ELECTRON_X: '1',
    Path: 'C:\\velho',
  };
  const env = cleanEnv(base, { Path: 'C:\\Windows;C:\\tools', OneDrive: 'C:\\OD' });
  assert.equal(env.ANTHROPIC_MODEL, undefined);
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.ELECTRON_X, undefined);
  assert.equal(env.SystemRoot, 'C:\\Windows');
  assert.equal(env.ComSpec, 'C:\\Windows\\system32\\cmd.exe');
  assert.equal(env.Path, 'C:\\Windows;C:\\tools');
  assert.equal(env.OneDrive, 'C:\\OD');
});

test('freshEnv: modo limpo por padrão; AGZOS_TERM_INHERIT_ENV=1 herda; registro ilegível mantém process.env', () => {
  const machine = '\r\n    Path    REG_EXPAND_SZ    C:\\Windows\r\n';
  const exec = (_c, args) => (args[1].startsWith('HKLM') ? machine : '');
  const base = { SystemRoot: 'C:\\Windows', ANTHROPIC_MODEL: 'x', Path: 'C:\\Windows' };
  captureStartupEnv({ platform: 'win32', exec, baseEnv: base });
  assert.equal(freshEnv({ platform: 'win32', exec, baseEnv: base }).ANTHROPIC_MODEL, undefined);
  assert.equal(freshEnv({ platform: 'win32', exec, baseEnv: { ...base, AGZOS_TERM_INHERIT_ENV: '1' } }).ANTHROPIC_MODEL, 'x');
  const failing = () => { throw new Error('reg indisponível'); };
  assert.equal(freshEnv({ platform: 'win32', exec: failing, baseEnv: base }).ANTHROPIC_MODEL, 'x');
  captureStartupEnv({ platform: 'linux' });
});
