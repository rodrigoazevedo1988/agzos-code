const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  nameContainsVersion,
  verifyArtifactNames,
  verifyManifestVersions,
  listArtifacts,
  publish,
} = require('../../tools/publish-vps-release');
const PACKAGE = require('../../package.json');

function makeSource(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-publish-src-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

test('nameContainsVersion exige a versão exata no nome', () => {
  assert.equal(nameContainsVersion('Agzos Code Setup 0.4.0.exe', '0.4.0'), true);
  assert.equal(nameContainsVersion('Agzos Code-0.4.0-arm64-mac.zip.blockmap', '0.4.0'), true);
  assert.equal(nameContainsVersion('agzos-code_0.4.0_amd64.deb', '0.4.0'), true);
  assert.equal(nameContainsVersion('Agzos Code-0.3.0-mac.zip', '0.4.0'), false);
  assert.equal(nameContainsVersion('Agzos Code-10.4.0-mac.zip', '0.4.0'), false);
  assert.equal(nameContainsVersion('Agzos Code-0.4.01-mac.zip', '0.4.0'), false);
});

test('verifyArtifactNames recusa artefatos de outra versão e ignora manifestos', () => {
  assert.doesNotThrow(() => verifyArtifactNames(['latest.yml', 'latest-mac.yml', 'Agzos Code Setup 0.4.0.exe'], '0.4.0'));
  assert.throws(
    () => verifyArtifactNames(['latest.yml', 'Agzos Code Setup 0.4.0.exe', 'Agzos Code-0.3.0-mac.zip'], '0.4.0'),
    /Agzos Code-0\.3\.0-mac\.zip/
  );
});

test('verifyManifestVersions recusa latest*.yml com versão diferente da release', async () => {
  const source = makeSource({
    'latest.yml': 'version: 0.4.0\npath: Agzos Code Setup 0.4.0.exe\n',
    'latest-mac.yml': 'version: 0.3.0\npath: Agzos Code-0.3.0-mac.zip\n',
    'Agzos Code Setup 0.4.0.exe': 'x',
  });
  const artifacts = await listArtifacts(source);
  await assert.rejects(verifyManifestVersions(source, artifacts, '0.4.0'), /latest-mac\.yml declara a versão 0\.3\.0/);
});

test('verifyManifestVersions recusa manifesto sem version e aceita versão igual (inclusive entre aspas)', async () => {
  const ok = makeSource({ 'latest.yml': "version: '0.4.0'\n", 'latest-linux.yml': 'version: 0.4.0\n' });
  await assert.doesNotReject(verifyManifestVersions(ok, ['latest.yml', 'latest-linux.yml'], '0.4.0'));
  const bad = makeSource({ 'latest.yml': 'path: x\n' });
  await assert.rejects(verifyManifestVersions(bad, ['latest.yml'], '0.4.0'), /não declara 'version:'/);
});

test('publish rejeita origem com manifesto desatualizado sem criar a release', async () => {
  const v = PACKAGE.version;
  const source = makeSource({
    'latest.yml': `version: ${v}\nfiles:\n  - url: Agzos Code Setup ${v}.exe\npath: Agzos Code Setup ${v}.exe\n`,
    'latest-mac.yml': 'version: 0.0.1\nfiles:\n  - url: Agzos Code-0.0.1-mac.zip\npath: Agzos Code-0.0.1-mac.zip\n',
    [`Agzos Code Setup ${v}.exe`]: 'x',
    'Agzos Code-0.0.1-mac.zip': 'x',
  });
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-publish-dst-'));
  await assert.rejects(publish({ source, destination, version: v }), /latest-mac\.yml declara a versão 0\.0\.1/);
  assert.equal(fs.existsSync(path.join(destination, 'releases', v)), false);
});

test('publish aceita release consistente', async () => {
  const v = PACKAGE.version;
  const source = makeSource({
    'latest.yml': `version: ${v}\nfiles:\n  - url: Agzos Code Setup ${v}.exe\npath: Agzos Code Setup ${v}.exe\n`,
    [`Agzos Code Setup ${v}.exe`]: 'x',
    [`Agzos Code Setup ${v}.exe.blockmap`]: 'x',
  });
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-publish-dst-'));
  const log = console.log;
  console.log = () => {};
  try {
    await publish({ source, destination, version: v });
  } finally {
    console.log = log;
  }
  assert.ok(fs.existsSync(path.join(destination, 'releases', v, 'SHA256SUMS')));
});

const { parseKeep, compareSemver, pruneReleases, parseArgs } = require('../../tools/publish-vps-release');

test('parseKeep: padrão 2, rejeita valores inválidos', () => {
  assert.equal(parseKeep(undefined), 2);
  assert.equal(parseKeep('3'), 3);
  assert.throws(() => parseKeep('0'));
  assert.throws(() => parseKeep('abc'));
  assert.equal(parseArgs(['--source', 'a', '--destination', 'b']).keep, 2);
  assert.equal(parseArgs(['--source', 'a', '--destination', 'b', '--keep', '4']).keep, 4);
});

test('compareSemver ordena numericamente e prerelease antes da final', () => {
  const sorted = ['0.10.0', '0.4.0', '0.5.0', '0.5.0-beta.1', '0.3.0'].sort(compareSemver);
  assert.deepEqual(sorted, ['0.3.0', '0.4.0', '0.5.0-beta.1', '0.5.0', '0.10.0']);
});

test('pruneReleases mantém as N mais novas e nunca a atual', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-prune-'));
  const rel = path.join(dest, 'releases');
  for (const v of ['0.3.0', '0.4.0', '0.5.0', '0.10.0']) fs.mkdirSync(path.join(rel, v), { recursive: true });
  fs.mkdirSync(path.join(rel, 'nao-versao'));
  const removed = await pruneReleases(dest, 2, '0.3.0');
  assert.deepEqual(removed.sort(), ['0.4.0']);
  assert.deepEqual(fs.readdirSync(rel).sort(), ['0.10.0', '0.3.0', '0.5.0', 'nao-versao']);
});
