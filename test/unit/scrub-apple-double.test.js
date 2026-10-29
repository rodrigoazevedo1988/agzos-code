const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { scrubAppleDouble, isJunk } = require('../../tools/scrub-apple-double');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-scrub-'));
}

test('isJunk reconhece a sujeira do macOS', () => {
  assert.equal(isJunk('._Agzos Code.exe'), true);
  assert.equal(isJunk('._app.asar'), true);
  assert.equal(isJunk('._.DS_Store'), true);
  assert.equal(isJunk('.DS_Store'), true);
  assert.equal(isJunk('.AppleDouble'), true);
  assert.equal(isJunk('.LSOverride'), true);
});

test('isJunk preserva nomes legítimos', () => {
  assert.equal(isJunk('Agzos Code.exe'), false);
  assert.equal(isJunk('app.asar'), false);
  assert.equal(isJunk('._'), false, 'um arquivo chamado apenas "._" não é AppleDouble');
  assert.equal(isJunk('resources'), false);
  assert.equal(isJunk('icon.ico'), false);
});

test('remove ._* e .DS_Store da raiz e de subpastas', () => {
  const dir = tmpDir();
  const res = path.join(dir, 'resources');
  fs.mkdirSync(res);
  const junk = [
    path.join(dir, '._Agzos Code.exe'),
    path.join(dir, '.DS_Store'),
    path.join(res, '._app.asar'),
    path.join(res, '._.DS_Store'),
  ];
  for (const f of junk) fs.writeFileSync(f, 'x');
  const keep = [
    path.join(dir, 'Agzos Code.exe'),
    path.join(res, 'app.asar'),
  ];
  for (const f of keep) fs.writeFileSync(f, 'conteudo');

  const removed = scrubAppleDouble(dir);

  assert.equal(removed.length, 4);
  for (const f of junk) assert.equal(fs.existsSync(f), false, `${path.basename(f)} deveria sair`);
  for (const f of keep) assert.equal(fs.existsSync(f), true, `${path.basename(f)} deveria ficar`);
});

test('remove o diretório .AppleDouble inteiro', () => {
  const dir = tmpDir();
  const apple = path.join(dir, '.AppleDouble');
  fs.mkdirSync(apple);
  fs.writeFileSync(path.join(apple, 'x'), 'lixo');
  fs.writeFileSync(path.join(dir, 'main.js'), 'ok');

  scrubAppleDouble(dir);

  assert.equal(fs.existsSync(apple), false);
  assert.equal(fs.existsSync(path.join(dir, 'main.js')), true);
});

test('não segue symlink (não apaga fora do pacote)', () => {
  const outside = tmpDir();
  const alvo = path.join(outside, '._intocavel.bin');
  fs.writeFileSync(alvo, 'nao apague');

  const dir = tmpDir();
  fs.symlinkSync(outside, path.join(dir, 'link'), 'dir');

  scrubAppleDouble(dir);

  assert.equal(fs.existsSync(alvo), true, 'arquivo atrás do symlink deve sobreviver');
});

test('diretório inexistente não lança', () => {
  assert.deepEqual(scrubAppleDouble(path.join(tmpDir(), 'nao-existe')), []);
});
