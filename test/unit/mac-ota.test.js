const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseLatestMacYaml,
  selectMacArtifact,
  compareSemver,
  findAppBundlePath,
  createMacOtaManager,
} = require('../../src/main/lib/mac-ota');

test('parseLatestMacYaml extrai versão e arquivos com sha512', () => {
  const yaml = `
version: 0.4.0
files:
  - url: Agzos Code-0.4.0-mac.zip
    sha512: dGVzdDE=
    size: 120000000
  - url: Agzos Code-0.4.0-arm64-mac.zip
    sha512: dGVzdDI=
    size: 115000000
path: Agzos Code-0.4.0-mac.zip
sha512: dGVzdDE=
  `;
  const parsed = parseLatestMacYaml(yaml);
  assert.equal(parsed.version, '0.4.0');
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].url, 'Agzos Code-0.4.0-mac.zip');
  assert.equal(parsed.files[0].sha512, 'dGVzdDE=');
  assert.equal(parsed.files[1].url, 'Agzos Code-0.4.0-arm64-mac.zip');
  assert.equal(parsed.files[1].sha512, 'dGVzdDI=');
});

test('selectMacArtifact seleciona o artefato correto por arquitetura', () => {
  const manifest = {
    version: '0.4.0',
    files: [
      { url: 'Agzos Code-0.4.0-mac.zip', sha512: 'x64' },
      { url: 'Agzos Code-0.4.0-arm64-mac.zip', sha512: 'arm64' },
    ],
  };

  const arm = selectMacArtifact(manifest, 'arm64');
  assert.equal(arm.url, 'Agzos Code-0.4.0-arm64-mac.zip');

  const x64 = selectMacArtifact(manifest, 'x64');
  assert.equal(x64.url, 'Agzos Code-0.4.0-mac.zip');
});

test('compareSemver compara versões corretamente', () => {
  assert.equal(compareSemver('0.4.0', '0.3.0'), 1);
  assert.equal(compareSemver('0.3.0', '0.4.0'), -1);
  assert.equal(compareSemver('0.3.0', '0.3.0'), 0);
  assert.equal(compareSemver('1.0.0', '0.9.9'), 1);
});

test('findAppBundlePath localiza o diretório .app a partir do executável', () => {
  const execPath = '/Applications/Agzos Code.app/Contents/MacOS/Agzos Code';
  const bundle = findAppBundlePath(execPath);
  assert.equal(bundle, '/Applications/Agzos Code.app');
});

test('createMacOtaManager realiza check e download com validação sha512', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-mac-ota-test-'));
  const zipContent = Buffer.from('conteudo-falso-de-zip-para-teste');
  const expectedSha512 = crypto.createHash('sha512').update(zipContent).digest('base64');

  const fakeYaml = `
version: 0.4.0
files:
  - url: Agzos Code-0.4.0-arm64-mac.zip
    sha512: ${expectedSha512}
    size: ${zipContent.length}
  `;

  const notifications = [];
  const fakeFetch = async (url) => {
    if (url.endsWith('latest-mac.yml')) {
      return {
        ok: true,
        status: 200,
        text: async () => fakeYaml,
      };
    }
    if (url.endsWith('.zip')) {
      return {
        ok: true,
        status: 200,
        headers: new Map([['content-length', String(zipContent.length)]]),
        arrayBuffer: async () => zipContent.buffer.slice(zipContent.byteOffset, zipContent.byteOffset + zipContent.byteLength),
      };
    }
    return { ok: false, status: 404 };
  };

  const manager = createMacOtaManager({
    feedUrl: 'https://code.rsolutionsbr.com/release',
    currentVersion: '0.3.0',
    arch: 'arm64',
    tempDir: tmpDir,
    notify: (n) => notifications.push(n),
    fetchImpl: fakeFetch,
  });

  const checkRes = await manager.check();
  assert.equal(checkRes.available, true);
  assert.equal(checkRes.version, '0.4.0');

  const downloadRes = await manager.download(checkRes);
  assert.equal(downloadRes, true);
  assert.equal(manager.getDownloadedVersion(), '0.4.0');
  assert.ok(fs.existsSync(manager.getDownloadedZipPath()));
  assert.ok(notifications.some((n) => n.type === 'ready' && n.version === '0.4.0'));
});
