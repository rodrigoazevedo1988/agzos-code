/**
 * E/S do histórico local e do Git Slider, isolada para a pasta remota (1.2.0, I1):
 * na integração, estas funções passam a escolher o provider pelo caminho
 * (`providerFor(path)`), sem mudar o resto do módulo.
 *
 *   readFileFor(path) → Promise<Buffer>
 *   writeFileFor(path, buffer) → Promise<void>
 *   runGitFor(root, args) → Promise<{ stdout, stderr }>
 */

const fsp = require('node:fs/promises');
const { runGit } = require('../../git/run');

async function readFileFor(p) {
  return fsp.readFile(p);
}

async function writeFileFor(p, buf) {
  await fsp.writeFile(p, buf);
}

function runGitFor(root, args, opts) {
  return runGit(root, args, opts);
}

module.exports = { readFileFor, writeFileFor, runGitFor };
