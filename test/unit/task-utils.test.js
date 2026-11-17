const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/task-utils.js')).href);

test('runFileCommand: interpretador por extensão (POSIX)', async () => {
  const { runFileCommand } = await load();
  assert.equal(runFileCommand('/w/a.js', 'linux'), 'node "/w/a.js"');
  assert.equal(runFileCommand('/w/a.mjs', 'linux'), 'node "/w/a.mjs"');
  assert.equal(runFileCommand('/w/a.cjs', 'darwin'), 'node "/w/a.cjs"');
  assert.equal(runFileCommand('/w/a.ts', 'linux'), 'npx tsx "/w/a.ts"');
  assert.equal(runFileCommand('/w/a.py', 'linux'), 'python3 "/w/a.py"');
  assert.equal(runFileCommand('/w/a.sh', 'linux'), 'bash "/w/a.sh"');
  assert.equal(runFileCommand('/w/a.txt', 'linux'), null);
  assert.equal(runFileCommand('/w/a.ps1', 'linux'), null);
});

test('runFileCommand: Windows usa python e PowerShell', async () => {
  const { runFileCommand } = await load();
  assert.equal(runFileCommand('C:\\w\\a.py', 'win32'), 'python "C:\\w\\a.py"');
  assert.equal(runFileCommand('C:\\w\\a.ps1', 'win32'), 'powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\w\\a.ps1"');
  assert.equal(runFileCommand('C:\\w\\a.js', 'win32'), 'node "C:\\w\\a.js"');
});

test('runFileCommand: aspas no caminho são escapadas (POSIX)', async () => {
  const { runFileCommand } = await load();
  assert.equal(runFileCommand('/w/a "b".js', 'linux'), 'node "/w/a \\"b\\".js"');
  assert.equal(runFileCommand('/w/$x`y.js', 'linux'), 'node "/w/\\$x\\`y.js"');
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

test('npmRunCommand: aspas em nomes com caracteres especiais', async () => {
  const { npmRunCommand } = await load();
  assert.equal(npmRunCommand('build'), 'npm run build');
  assert.equal(npmRunCommand('test:unit'), 'npm run test:unit');
  assert.equal(npmRunCommand('a b'), 'npm run "a b"');
});
