#!/usr/bin/env node
'use strict';

/**
 * Prepare an immutable electron-builder release on a VPS and atomically point
 * `current` at it. This script never uploads files. After a successful switch it
 * prunes old releases, keeping only the newest `--keep` versions (default 2).
 *
 * Usage:
 *   node tools/publish-vps-release.js --source dist --destination /var/www/agzos-code-releases
 *   node tools/publish-vps-release.js --source dist --destination /var/www/agzos-code-releases --version 1.2.3
 *   node tools/publish-vps-release.js --source dist --destination /var/www/agzos-code-releases --keep 3
 */

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PACKAGE = require(path.join(ROOT, 'package.json'));

function usage() {
  console.error('Uso: node tools/publish-vps-release.js --source <dist> --destination <diretório> [--version <semver>] [--keep <n>]');
  process.exitCode = 2;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--source', '--destination', '--version', '--keep'].includes(key) || options[key]) {
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
    keep: parseKeep(options['--keep']),
  };
}

const DEFAULT_KEEP = 2;

function parseKeep(value) {
  if (value === undefined) return DEFAULT_KEEP;
  const keep = Number(value);
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`--keep precisa ser um inteiro >= 1: ${value}`);
  return keep;
}

function compareSemver(a, b) {
  const parse = (v) => {
    const [core, pre] = v.split('+')[0].split(/-(.*)/s);
    return { nums: core.split('.').map(Number), pre: pre || null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/**
 * Remove releases antigas, mantendo as `keep` versões mais novas (SemVer).
 * Nunca remove a versão apontada por `current` nem entradas que não sejam
 * diretórios de versão válidos.
 */
async function pruneReleases(destination, keep, currentVersion) {
  const releasesDir = path.join(destination, 'releases');
  const entries = await fs.readdir(releasesDir, { withFileTypes: true });
  const versions = entries
    .filter((e) => e.isDirectory() && !e.isSymbolicLink() && safeVersion(e.name))
    .map((e) => e.name)
    .sort((a, b) => compareSemver(b, a));
  const keepSet = new Set(versions.slice(0, keep));
  keepSet.add(currentVersion);
  const removed = [];
  for (const version of versions) {
    if (keepSet.has(version)) continue;
    await fs.rm(path.join(releasesDir, version), { recursive: true, force: true });
    removed.push(version);
  }
  return removed;
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

async function verifyManifestReferences(source, artifacts) {
  const manifests = artifacts.filter((name) => /^latest[^/]*\.yml$/i.test(name));
  for (const manifestName of manifests) {
    const raw = await fs.readFile(path.join(source, manifestName), 'utf-8');
    const matches = raw.matchAll(/(?:url|path):\s*([^\r\n#]+)/g);
    for (const match of matches) {
      const referencedFile = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (referencedFile && !referencedFile.startsWith('http') && !artifacts.includes(referencedFile)) {
        throw new Error(
          `O manifesto ${manifestName} referencia o arquivo '${referencedFile}', mas ele não está presente no diretório de release.`
        );
      }
    }
  }
}

function isManifestName(name) {
  return /^latest[^/]*\.yml$/i.test(name);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameContainsVersion(name, version) {
  // Evita falso positivo: 0.4.0 não pode casar dentro de 10.4.0 nem de 0.4.01.
  return new RegExp(`(?<![0-9.])${escapeRegExp(version)}(?![0-9]|\\.[0-9])`).test(name);
}

/**
 * Recusa instaladores/zips/blockmaps cujo nome não contém a versão da release
 * (sobras de builds antigos em dist/). Manifestos latest*.yml são checados
 * pelo conteúdo em verifyManifestVersions.
 */
function verifyArtifactNames(artifacts, version) {
  const stale = artifacts.filter((name) => !isManifestName(name) && !nameContainsVersion(name, version));
  if (stale.length) {
    throw new Error(
      `Artefatos que não pertencem à versão ${version} encontrados na origem: ${stale.join(', ')}. Limpe o diretório antes de publicar.`
    );
  }
}

async function verifyManifestVersions(source, artifacts, version) {
  for (const manifestName of artifacts.filter(isManifestName)) {
    const raw = await fs.readFile(path.join(source, manifestName), 'utf-8');
    const match = raw.match(/^version:\s*['"]?([^\s'"#]+)['"]?\s*(?:#.*)?$/m);
    if (!match) throw new Error(`O manifesto ${manifestName} não declara 'version:'.`);
    if (match[1] !== version) {
      throw new Error(
        `O manifesto ${manifestName} declara a versão ${match[1]}, mas a release é ${version}. Regere os manifestos antes de publicar.`
      );
    }
  }
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

async function publish({ source, destination, version, keep = DEFAULT_KEEP }) {
  if (!safeVersion(version)) throw new Error(`Versão inválida: ${version}`);
  if (version !== PACKAGE.version) {
    throw new Error(`A versão solicitada (${version}) não corresponde à versão do package.json (${PACKAGE.version}).`);
  }
  if (source === destination || destination.startsWith(`${source}${path.sep}`)) {
    throw new Error('O destino não pode estar dentro do diretório de origem.');
  }

  const artifacts = await listArtifacts(source);
  await verifyManifestVersions(source, artifacts, version);
  verifyArtifactNames(artifacts, version);
  await verifyManifestReferences(source, artifacts);
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
    const removed = await pruneReleases(destination, keep, version);
    console.log(removed.length ? `Releases antigas removidas (mantendo ${keep}): ${removed.join(', ')}` : `Nenhuma release antiga a remover (mantendo ${keep}).`);
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

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  parseKeep,
  compareSemver,
  pruneReleases,
  safeVersion,
  isReleaseArtifact,
  listArtifacts,
  nameContainsVersion,
  verifyArtifactNames,
  verifyManifestVersions,
  verifyManifestReferences,
  publish,
};
