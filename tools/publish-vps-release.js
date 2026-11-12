#!/usr/bin/env node
'use strict';

/**
 * Prepare an immutable electron-builder release on a VPS and atomically point
 * `current` at it. This script never uploads files and never removes releases.
 *
 * Usage:
 *   node tools/publish-vps-release.js --source dist --destination /var/www/agzos-code-releases
 *   node tools/publish-vps-release.js --source dist --destination /var/www/agzos-code-releases --version 1.2.3
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PACKAGE = require(path.join(ROOT, 'package.json'));

function usage() {
  console.error('Uso: node tools/publish-vps-release.js --source <dist> --destination <diretório> [--version <semver>]');
  process.exitCode = 2;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--source', '--destination', '--version'].includes(key) || options[key]) {
      throw new Error(`Opção inválida ou repetida: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Valor ausente para ${key}`);
    options[key] = value;
    index += 1;
  }
  if (!options['--source'] || !options['--destination']) return null;
  return {
    source: path.resolve(options['--source']),
    destination: path.resolve(options['--destination']),
    version: options['--version'] || PACKAGE.version,
  };
}

function safeVersion(version) {
  // SemVer (including prerelease/build metadata) with no path separators.
  return typeof version === 'string'
    && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

function isReleaseArtifact(name) {
  return /^latest[^/]*\.yml$/i.test(name)
    || /\.(?:exe|zip|dmg|appimage|deb|rpm|blockmap|snap|tar\.gz)$/i.test(name);
}

async function listArtifacts(source) {
  let entries;
  try {
    entries = await fs.readdir(source, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Não foi possível ler o diretório de origem ${source}: ${error.message}`);
  }
  const selected = [];
  for (const entry of entries) {
    if (!isReleaseArtifact(entry.name)) continue;
    if (!entry.isFile()) {
      throw new Error(`Artefato precisa ser arquivo regular (symlink/diretório recusado): ${entry.name}`);
    }
    selected.push(entry.name);
  }
  selected.sort((a, b) => a.localeCompare(b));
  if (!selected.some((name) => /^latest[^/]*\.yml$/i.test(name))) {
    throw new Error('Nenhum manifesto latest*.yml encontrado na origem. Gere os metadados do electron-builder antes de publicar.');
  }
  if (selected.length < 2) throw new Error('Nenhum instalador/arquivo de atualização reconhecido foi encontrado junto aos manifestos.');
  return selected;
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = require('node:fs').createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function copyAndHash(source, destination) {
  const input = await fs.open(source, 'r');
  try {
    const stat = await input.stat();
    if (!stat.isFile()) throw new Error(`Origem deixou de ser arquivo regular: ${source}`);
    await fs.copyFile(source, destination, require('node:fs').constants.COPYFILE_EXCL);
    await fs.chmod(destination, 0o644);
    return { size: stat.size, sha256: await sha256(destination) };
  } finally {
    await input.close();
  }
}

async function exists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function publish({ source, destination, version }) {
  if (!safeVersion(version)) throw new Error(`Versão inválida: ${version}`);
  if (version !== PACKAGE.version) {
    throw new Error(`A versão solicitada (${version}) não corresponde à versão do package.json (${PACKAGE.version}).`);
  }
  if (source === destination || destination.startsWith(`${source}${path.sep}`)) {
    throw new Error('O destino não pode estar dentro do diretório de origem.');
  }

  const artifacts = await listArtifacts(source);
  await fs.mkdir(destination, { recursive: true, mode: 0o755 });
  const destinationStat = await fs.lstat(destination);
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) {
    throw new Error('O destino precisa ser um diretório real, não um symlink.');
  }

  const releasesDir = path.join(destination, 'releases');
  await fs.mkdir(releasesDir, { recursive: true, mode: 0o755 });
  const releaseDir = path.join(releasesDir, version);
  if (await exists(releaseDir)) throw new Error(`A release ${version} já existe; releases existentes nunca são sobrescritas.`);

  const lockPath = path.join(destination, '.publish.lock');
  try {
    await fs.mkdir(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Publicação concorrente detectada (${lockPath}). Verifique se outro processo está ativo antes de remover o lock manualmente.`);
    throw error;
  }

  const token = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const stageDir = path.join(destination, `.staging-${version}-${token}`);
  let stageCreated = false;
  try {
    await fs.mkdir(stageDir, { mode: 0o755 });
    stageCreated = true;
    const records = [];
    for (const name of artifacts) {
      const result = await copyAndHash(path.join(source, name), path.join(stageDir, name));
      records.push({ name, ...result });
    }
    const sums = records.map(({ sha256: digest, name }) => `${digest}  ${name}`).join('\n') + '\n';
    await fs.writeFile(path.join(stageDir, 'SHA256SUMS'), sums, { flag: 'wx', mode: 0o644 });
    const inventory = {
      application: PACKAGE.name,
      version,
      createdAt: new Date().toISOString(),
      files: records,
    };
    await fs.writeFile(path.join(stageDir, 'release-manifest.json'), `${JSON.stringify(inventory, null, 2)}\n`, { flag: 'wx', mode: 0o644 });

    // First atomically install the complete, immutable release directory.
    await fs.rename(stageDir, releaseDir);
    stageCreated = false;

    // Then atomically replace only our own `current` symlink. It intentionally
    // remains a symlink into releases/, making rollback a later pointer swap.
    const current = path.join(destination, 'current');
    if (await exists(current)) {
      const currentStat = await fs.lstat(current);
      if (!currentStat.isSymbolicLink()) throw new Error(`Refusing to replace ${current}: expected a symlink.`);
      const oldTarget = await fs.readlink(current);
      if (!oldTarget.startsWith('releases/') || !safeVersion(oldTarget.slice('releases/'.length))) {
        throw new Error(`Refusing to replace unexpected current target: ${oldTarget}`);
      }
    }
    const nextLink = path.join(destination, `.current-${token}`);
    await fs.symlink(path.posix.join('releases', version), nextLink, 'dir');
    try {
      await fs.rename(nextLink, current);
    } catch (error) {
      await fs.unlink(nextLink).catch(() => {});
      throw error;
    }
    console.log(`Release ${version} preparada em ${releaseDir}`);
    console.log(`Ponteiro atômico atualizado: ${current} -> releases/${version}`);
    console.log(`Arquivos: ${records.length}; checksums: ${path.join(releaseDir, 'SHA256SUMS')}`);
  } finally {
    if (stageCreated) await fs.rm(stageDir, { recursive: true, force: true });
    await fs.rmdir(lockPath).catch(() => {});
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    usage();
    return;
  }
  if (!options) {
    usage();
    return;
  }
  try {
    await publish(options);
  } catch (error) {
    console.error(`Publicação não concluída: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
