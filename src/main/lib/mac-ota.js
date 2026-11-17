/**
 * OTA Multiplataforma para macOS.
 *
 * Permite atualização automática transparente (Over-The-Air) no macOS mesmo
 * sem assinatura paga Apple Developer ID (que o Squirrel.Mac nativo bloqueia).
 *
 * Lê `latest-mac.yml`, baixa o ZIP com validação de hash SHA-512,
 * remove quarentena (xattr -cr), substitui o bundle .app e reinicia a aplicação.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function parseLatestMacYaml(yamlContent) {
  if (typeof yamlContent !== 'string') return null;
  const versionMatch = yamlContent.match(/^version:\s*([^\s\r\n]+)/m);
  if (!versionMatch) return null;
  const version = versionMatch[1].trim();

  const files = [];
  const lines = yamlContent.split(/\r?\n/);
  let inFiles = false;
  let currentFile = null;

  for (const rawLine of lines) {
    const isIndented = /^\s+/.test(rawLine);
    const line = rawLine.trim();

    if (line.startsWith('files:')) {
      inFiles = true;
      continue;
    }

    if (inFiles && !isIndented && line.length > 0 && !line.startsWith('-')) {
      // Saiu do bloco files:
      inFiles = false;
      if (currentFile && currentFile.url) {
        files.push(currentFile);
        currentFile = null;
      }
    }

    if (inFiles) {
      if (line.startsWith('- url:') || line.startsWith('url:')) {
        if (currentFile && currentFile.url) files.push(currentFile);
        currentFile = { url: line.replace(/^-\s*url:\s*|^url:\s*/, '').trim() };
      } else if (line.startsWith('sha512:') && currentFile) {
        currentFile.sha512 = line.replace(/^sha512:\s*/, '').trim();
      } else if (line.startsWith('size:') && currentFile) {
        currentFile.size = parseInt(line.replace(/^size:\s*/, '').trim(), 10) || 0;
      }
    }
  }
  if (currentFile && currentFile.url) files.push(currentFile);

  return { version, files };
}

/**
 * Escolhe o ZIP compatível com a arquitetura.
 * - arm64: prefere ZIP arm64; aceita ZIP x64/universal como fallback (Rosetta).
 * - x64: NUNCA escolhe ZIP arm64 (não roda em Intel).
 * Retorna null quando não há ZIP compatível.
 */
function selectMacArtifact(manifest, arch = process.arch) {
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length === 0) return null;
  const zips = manifest.files.filter((f) => f && typeof f.url === 'string' && /\.zip$/i.test(f.url));
  const isArmZip = (f) => /arm64/i.test(f.url);
  const nonArmZip = zips.find((f) => !isArmZip(f)) || null;

  if (arch === 'arm64') {
    return zips.find(isArmZip) || nonArmZip;
  }
  return nonArmZip;
}

function compareSemver(v1, v2) {
  if (!v1 || !v2) return 0;
  const clean1 = v1.replace(/^v/, '').split('-')[0].split('.').map(Number);
  const clean2 = v2.replace(/^v/, '').split('-')[0].split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const n1 = clean1[i] || 0;
    const n2 = clean2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

async function sha512File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('base64')));
    stream.on('error', reject);
  });
}

function findAppBundlePath(execPath) {
  // execPath ex: /Applications/Agzos Code.app/Contents/MacOS/Agzos Code
  const parts = execPath.split(path.sep);
  const appIndex = parts.findLastIndex((p) => p.endsWith('.app'));
  if (appIndex >= 0) {
    return parts.slice(0, appIndex + 1).join(path.sep);
  }
  return null;
}

function createMacOtaManager({
  feedUrl,
  currentVersion,
  arch = process.arch,
  tempDir = os.tmpdir(),
  notify = () => {},
  fetchImpl = globalThis.fetch,
  spawnImpl = spawn,
} = {}) {
  let downloadedZipPath = null;
  let downloadedVersion = null;
  let isDownloading = false;

  async function check() {
    try {
      const manifestUrl = `${feedUrl.replace(/\/+$/, '')}/latest-mac.yml`;
      const res = await fetchImpl(manifestUrl);
      if (!res.ok) {
        throw new Error(`Feed retornou status ${res.status}`);
      }
      const text = await res.text();
      const manifest = parseLatestMacYaml(text);
      if (!manifest || !manifest.version) {
        throw new Error('Manifesto latest-mac.yml inválido ou vazio');
      }

      if (compareSemver(manifest.version, currentVersion) <= 0) {
        return { available: false, version: currentVersion };
      }

      const artifact = selectMacArtifact(manifest, arch);
      if (!artifact) {
        throw new Error(
          `Nenhum artefato ZIP compatível com a arquitetura ${arch} no manifesto da versão ${manifest.version}`
        );
      }

      return {
        available: true,
        version: manifest.version,
        artifact,
      };
    } catch (err) {
      throw new Error(`Falha ao verificar OTA no macOS: ${err.message}`);
    }
  }

  async function download(checkResult) {
    if (isDownloading) return false;
    const { version, artifact } = checkResult;

    // Já baixado (mesma versão e arquivo ainda presente): não baixa de novo.
    if (downloadedVersion === version && downloadedZipPath && fs.existsSync(downloadedZipPath)) {
      notify({
        type: 'ready',
        version,
        message: 'A atualização foi baixada e está pronta para instalar.',
      });
      return true;
    }

    isDownloading = true;
    let targetZip = null;
    let fileStream = null;

    try {
      const downloadUrl = artifact.url.startsWith('http')
        ? artifact.url
        : `${feedUrl.replace(/\/+$/, '')}/${artifact.url}`;

      const res = await fetchImpl(downloadUrl);
      if (!res.ok) throw new Error(`Falha ao baixar ZIP da versão ${version}: HTTP ${res.status}`);

      const total = parseInt(res.headers.get('content-length') || String(artifact.size || 0), 10);
      let transferred = 0;

      targetZip = path.join(tempDir, `agzos-update-${version}-${Date.now()}.zip`);
      fileStream = fs.createWriteStream(targetZip);

      // Listeners anexados ANTES de escrever: erro de disco não fica sem handler.
      let streamError = null;
      const finished = new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', (err) => {
          streamError = err;
          reject(err);
        });
      });
      finished.catch(() => {});

      const writeChunk = (chunk) => new Promise((resolve, reject) => {
        if (streamError) return reject(streamError);
        if (fileStream.write(chunk)) return resolve();
        const onDrain = () => { fileStream.off('error', onError); resolve(); };
        const onError = (err) => { fileStream.off('drain', onDrain); reject(err); };
        fileStream.once('drain', onDrain);
        fileStream.once('error', onError);
      });

      if (res.body && typeof res.body.getReader === 'function') {
        const reader = res.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writeChunk(value);
          transferred += value.length;
          if (total > 0) {
            notify({
              type: 'progress',
              percent: (transferred / total) * 100,
              transferred,
              total,
            });
          }
        }
      } else {
        const buffer = await res.arrayBuffer();
        await writeChunk(Buffer.from(buffer));
        transferred = buffer.byteLength;
      }
      fileStream.end();
      await finished;

      // Validação do hash SHA-512
      if (artifact.sha512) {
        const digest = await sha512File(targetZip);
        if (digest !== artifact.sha512) {
          throw new Error('Integridade SHA-512 do pacote macOS não confere com o manifesto');
        }
      }

      // Remove ZIP de versão anterior, se houver.
      if (downloadedZipPath && downloadedZipPath !== targetZip) {
        try { fs.unlinkSync(downloadedZipPath); } catch { /* ignora */ }
      }

      downloadedZipPath = targetZip;
      downloadedVersion = version;
      isDownloading = false;

      notify({
        type: 'ready',
        version,
        message: 'A atualização foi baixada e está pronta para instalar.',
      });

      return true;
    } catch (err) {
      isDownloading = false;
      if (fileStream && !fileStream.destroyed) fileStream.destroy();
      if (targetZip) {
        try { fs.unlinkSync(targetZip); } catch { /* arquivo parcial já ausente */ }
      }
      throw err;
    }
  }

  function install({ execPath = process.execPath, pid = process.pid, appQuit = () => {} } = {}) {
    if (!downloadedZipPath || !fs.existsSync(downloadedZipPath)) {
      return false;
    }

    const appBundle = findAppBundlePath(execPath);
    if (!appBundle) {
      console.error('[mac-ota] Não foi possível determinar o caminho do bundle .app');
      return false;
    }

    const scriptPath = path.join(tempDir, `agzos-apply-${Date.now()}.sh`);
    const extractDir = path.join(tempDir, `agzos-extract-${Date.now()}`);

    const scriptContent = `#!/bin/bash
set -e
PID=${pid}
TARGET="${appBundle}"
ZIP="${downloadedZipPath}"
EXTRACT="${extractDir}"

# Espera o processo atual encerrar
while kill -0 $PID 2>/dev/null; do
  sleep 0.2
done

mkdir -p "$EXTRACT"
ditto -x -k "$ZIP" "$EXTRACT"

NEW_APP=$(find "$EXTRACT" -maxdepth 1 -name "*.app" | head -n 1)
if [ -n "$NEW_APP" ] && [ -d "$NEW_APP" ]; then
  xattr -cr "$NEW_APP" 2>/dev/null || true
  BACKUP="$TARGET.bak"
  rm -rf "$BACKUP"
  if [ -e "$TARGET" ]; then
    mv "$TARGET" "$BACKUP"
  fi
  if mv "$NEW_APP" "$TARGET"; then
    rm -rf "$BACKUP"
  else
    # Falha na troca: restaura o bundle anterior
    rm -rf "$TARGET"
    if [ -e "$BACKUP" ]; then
      mv "$BACKUP" "$TARGET"
    fi
    open -n "$TARGET" || true
    rm -rf "$EXTRACT"
    exit 1
  fi
  open -n "$TARGET"
fi

rm -rf "$EXTRACT" "$ZIP" "$0"
`;

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755 });

    const child = spawnImpl('/bin/bash', [scriptPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    appQuit();
    return true;
  }

  return {
    check,
    download,
    install,
    getDownloadedVersion: () => downloadedVersion,
    getDownloadedZipPath: () => downloadedZipPath,
  };
}

module.exports = {
  parseLatestMacYaml,
  selectMacArtifact,
  compareSemver,
  sha512File,
  findAppBundlePath,
  createMacOtaManager,
};
