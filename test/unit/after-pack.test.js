const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// O hook de afterPack recebe um contexto do electron-builder. Aqui validamos
// que ele limpa o pacote em qualquer plataforma e que só assina no macOS.
const afterPack = require('../../tools/after-pack');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-afterpack-'));
}

function fakeContext(platform) {
  return {
    electronPlatformName: platform,
    appOutDir: tmpDir(),
    packager: { appInfo: { productFilename: 'Agzos Code' } },
  };
}

test('afterPack remove ._* do pacote Windows', async () => {
  const ctx = fakeContext('win32');
  fs.writeFileSync(path.join(ctx.appOutDir, '._Agzos Code.exe'), 'lixo');
  fs.writeFileSync(path.join(ctx.appOutDir, 'Agzos Code.exe'), 'binario');
  const resources = path.join(ctx.appOutDir, 'resources');
  fs.mkdirSync(resources);
  fs.writeFileSync(path.join(resources, '._app.asar'), 'lixo');
  fs.writeFileSync(path.join(resources, 'app.asar'), 'binario');
  let assinou = false;

  await afterPack(ctx, { sign: () => { assinou = true; } });

  assert.equal(fs.existsSync(path.join(ctx.appOutDir, '._Agzos Code.exe')), false);
  assert.equal(fs.existsSync(path.join(resources, '._app.asar')), false);
  assert.equal(fs.existsSync(path.join(ctx.appOutDir, 'Agzos Code.exe')), true);
  assert.equal(fs.existsSync(path.join(resources, 'app.asar')), true);
  assert.equal(assinou, false, 'não assina fora do macOS');
});

test('afterPack remove ._* do pacote Linux', async () => {
  const ctx = fakeContext('linux');
  fs.writeFileSync(path.join(ctx.appOutDir, '._agzos-code'), 'lixo');
  fs.writeFileSync(path.join(ctx.appOutDir, 'agzos-code'), 'binario');

  await afterPack(ctx, { sign: () => {} });

  assert.equal(fs.existsSync(path.join(ctx.appOutDir, '._agzos-code')), false);
  assert.equal(fs.existsSync(path.join(ctx.appOutDir, 'agzos-code')), true);
});

test('afterPack no macOS limpa o .app e chama a assinatura', async () => {
  const ctx = fakeContext('darwin');
  const appPath = path.join(ctx.appOutDir, 'Agzos Code.app');
  fs.mkdirSync(path.join(appPath, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(appPath, 'Contents', '._Info.plist'), 'lixo');
  fs.writeFileSync(path.join(appPath, 'Contents', 'Info.plist'), '<plist/>');
  const assinados = [];

  await afterPack(ctx, { sign: (c) => assinados.push(c.appOutDir) });

  assert.equal(fs.existsSync(path.join(appPath, 'Contents', '._Info.plist')), false);
  assert.equal(fs.existsSync(path.join(appPath, 'Contents', 'Info.plist')), true);
  assert.deepEqual(assinados, [ctx.appOutDir]);
});

test('package.json aponta afterPack para o hook multiplataforma', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
  assert.equal(pkg.build.afterPack, 'tools/after-pack.js');
  const files = pkg.build.files;
  assert.ok(files.includes('!**/._*'), 'build.files deve excluir ._*');
  assert.ok(files.includes('!**/.AppleDouble/**'), 'build.files deve excluir .AppleDouble/');
});
