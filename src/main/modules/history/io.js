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
const { isRemote, providerFor } = require('../../workspace/provider-for');

// Pasta remota (ssh://): provider da janela do contexto (runAsOwner no IPC).
// O git já roda no host pelo runGit quando o cwd é ssh://.

async function readFileFor(p) {
  if (isRemote(p)) return providerFor(p).readFile(p);
  return fsp.readFile(p);
}

async function writeFileFor(p, buf) {
  if (isRemote(p)) { await providerFor(p).writeFile(p, buf); return; }
  await fsp.writeFile(p, buf);
}

function runGitFor(root, args, opts) {
  return runGit(root, args, opts);
}

module.exports = { readFileFor, writeFileFor, runGitFor };
