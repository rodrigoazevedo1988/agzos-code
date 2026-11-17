/**
 * IPC do Cofre .env (window.agzos.envVault).
 *
 * Canais (todos `envvault:*`):
 *   list(root?) → { root, files: [{ path, rel, name, isExample, entries: [{ key, masked, line, rule?, flags }], compare }], summary }
 *   reveal(path, key) → { value }            ← ÚNICO canal que devolve um valor ao renderer
 *   copy(path, key) → { ok: true }           (clipboard no main; o valor não passa pelo renderer)
 *   setValue(path, key, value) · addKey(path, key, value) · removeKey(path, key) → { checkpointId }
 *   undo(checkpointId) → { restored, errors }
 *   generateExample(path) → { path, created, added, checkpointId }
 *   scanStaged(root?) → { findings, envFiles }
 *   installHook(root?) · removeHook(root?) · hookStatus(root?)
 *   gitignoreStatus(root?) → { repo, hasEnv, ignored } · addToGitignore(root?) → { added }
 *
 * `root` omitido = pasta da janela que pediu (getWindowRoot(sender), como o agente; sem ele,
 * a mais recente). Todo caminho passa pelo path-guard daquela janela (guardFor(sender)).
 * Valores nunca são logados nem incluídos em mensagens de erro.
 * undo: só a janela que criou o checkpoint desfaz (checkpointId → webContents.id), e cada
 * caminho restaurado passa pelo guard dessa janela.
 *
 * deps: { guard | guardFor, getWindowRoot?, settingsStore, userDataDir, workerHost, clipboard? }
 */

const fs = require('node:fs');
const path = require('node:path');
const { createCheckpointStore } = require('../agent/checkpoints');
const { normalizeModules } = require('../lib/settings');
const { runGit } = require('../git/run');
const { configureCommitGuard } = require('../modules/envvault/commit-guard');
const { scanStaged } = require('../modules/envvault/staged');
const hook = require('../modules/envvault/hook');
const vault = require('../modules/envvault/vault');
const { findExampleFile } = require('../modules/envvault/compare');
const { guardResolver } = require('../lib/window-guards');
const { recordBefore } = require('../modules/history');

const CHANNELS = [
  'list', 'reveal', 'setValue', 'addKey', 'removeKey', 'generateExample', 'copy', 'scanStaged',
  'installHook', 'removeHook', 'hookStatus', 'gitignoreStatus', 'addToGitignore', 'undo',
];

const GITIGNORE_LINES = ['.env', '.env*.local'];

function register(ipcMain, {
  guard, guardFor, getWindowRoot, settingsStore, userDataDir, clipboard,
} = {}) {
  const guardOf = guardResolver({ guard, guardFor });
  const loadSettings = () => settingsStore?.load?.() || {};
  // Bloqueio de commit (ipc/git.js e run_command do agente) lê as settings atuais.
  configureCommitGuard({ getSettings: loadSettings, userDataDir });

  const cpDir = userDataDir ? path.join(userDataDir, 'envvault-checkpoints') : undefined;
  const checkpoints = createCheckpointStore({ dir: cpDir, maxCount: 20 });
  const owners = new Map(); // checkpointId → webContents.id
  const senderId = (sender) => (sender && sender.id !== undefined ? sender.id : null);

  const options = () => normalizeModules(loadSettings().modules).envVault;
  const detectOptions = () => {
    const o = options();
    return { extraPatterns: o.extraPatterns, allowlist: o.allowlist };
  };
  const getClipboard = () => clipboard || require('electron').clipboard;

  /** Handlers com o guard e a pasta da janela que pediu (sender). */
  function handlersFor(sender) {
    const g = guardOf(sender);

    function resolveRoot(root) {
      let candidate = root;
      if (candidate === undefined || candidate === null || candidate === '') {
        if (typeof getWindowRoot === 'function') {
          candidate = sender ? getWindowRoot(sender) : null;
        } else {
          const recent = loadSettings().recentFolders;
          candidate = Array.isArray(recent) ? recent[0] : null;
        }
      }
      if (typeof candidate !== 'string' || !candidate) throw new Error('Abra uma pasta de projeto para usar o Cofre .env.');
      const abs = g.assertAllowed(candidate);
      if (!fs.statSync(abs).isDirectory()) throw new Error('A raiz do Cofre precisa ser uma pasta');
      return abs;
    }

    function envFile(p) {
      if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('Caminho inválido');
      const abs = g.assertAllowed(p);
      if (!vault.isEnvName(path.basename(abs))) throw new Error('O Cofre só edita arquivos .env');
      return abs;
    }

    /** Escreve com checkpoint (userData/envvault-checkpoints, pasta 0700). */
    function writeWithCheckpoint(abs, text) {
      if (cpDir) {
        fs.mkdirSync(cpDir, { recursive: true, mode: 0o700 });
        try { fs.chmodSync(cpDir, 0o700); } catch {}
      }
      const cp = checkpoints.create({ root: path.dirname(abs) });
      cp.record(abs);
      recordBefore(abs, 'cofre');
      fs.writeFileSync(abs, text);
      cp.finalize();
      owners.set(cp.id, senderId(sender));
      while (owners.size > 200) owners.delete(owners.keys().next().value);
      return cp.id;
    }

    function edit(p, fn) {
      const abs = envFile(p);
      const next = fn(vault.readEnvText(abs));
      return { checkpointId: writeWithCheckpoint(abs, next) };
    }

    async function gitRoot(root) {
      try {
        const { stdout } = await runGit(root, ['rev-parse', '--show-toplevel']);
        return path.resolve(stdout.trim());
      } catch {
        return null;
      }
    }

    async function repoOrThrow(root) {
      const r = await gitRoot(resolveRoot(root));
      if (!r) throw new Error('Esta pasta não é um repositório Git.');
      return r;
    }

    return {
      list: (root) => vault.listVault(resolveRoot(root), { detectOptions: detectOptions() }),

      reveal: (p, key) => ({ value: vault.readValue(envFile(p), String(key)) }),

      copy: (p, key) => {
        getClipboard().writeText(vault.readValue(envFile(p), String(key)));
        return { ok: true };
      },

      setValue: (p, key, value) => edit(p, (t) => vault.setValueText(t, key, value)),
      addKey: (p, key, value = '') => edit(p, (t) => vault.addKeyText(t, key, value)),
      removeKey: (p, key) => edit(p, (t) => vault.removeKeyText(t, key)),

      undo: (checkpointId) => {
        const id = String(checkpointId);
        if (owners.has(id) && owners.get(id) !== senderId(sender)) {
          return { restored: [], errors: [{ path: null, message: 'Este checkpoint pertence a outra janela.' }] };
        }
        const result = checkpoints.undo(id, { assertPath: (p) => g.assertAllowed(p) });
        if (!result.errors.length || result.restored.length) owners.delete(id);
        return result;
      },

      generateExample: (p) => {
        const src = envFile(p);
        const dir = path.dirname(src);
        const siblings = fs.readdirSync(dir).map((n) => path.join(dir, n));
        const existing = findExampleFile(siblings);
        const target = existing || path.join(dir, '.env.example');
        g.assertAllowed(target);
        const srcText = vault.readEnvText(src);
        if (!existing) {
          const text = vault.exampleFromText(srcText);
          const checkpointId = writeWithCheckpoint(target, text);
          return { path: target, created: true, added: [], checkpointId };
        }
        const { text, added } = vault.mergeExample(vault.readEnvText(target), srcText);
        const checkpointId = added.length ? writeWithCheckpoint(target, text) : null;
        return { path: target, created: false, added, checkpointId };
      },

      scanStaged: async (root) => scanStaged(await repoOrThrow(root), detectOptions()),

      installHook: async (root) => hook.installHook(await repoOrThrow(root)),
      removeHook: async (root) => hook.removeHook(await repoOrThrow(root)),
      hookStatus: async (root) => hook.hookStatus(await repoOrThrow(root)),

      gitignoreStatus: async (root) => {
        const dir = resolveRoot(root);
        const hasEnv = fs.existsSync(path.join(dir, '.env'));
        const repo = await gitRoot(dir);
        if (!repo) return { repo: false, hasEnv, ignored: false };
        try {
          await runGit(dir, ['check-ignore', '-q', '--no-index', '.env']);
          return { repo: true, hasEnv, ignored: true };
        } catch {
          return { repo: true, hasEnv, ignored: false };
        }
      },

      addToGitignore: (root) => {
        const dir = resolveRoot(root);
        const file = path.join(dir, '.gitignore');
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch {}
        const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
        const added = GITIGNORE_LINES.filter((l) => !have.has(l));
        if (!added.length) return { added };
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const sep = text && !text.endsWith('\n') ? eol : '';
        fs.writeFileSync(file, `${text}${sep}${added.join(eol)}${eol}`);
        return { added, path: file };
      },
    };
  }

  const handlers = handlersFor(null);
  for (const name of Object.keys(handlers)) {
    ipcMain.handle(`envvault:${name}`, async (e, ...args) => handlersFor(e?.sender)[name](...args));
  }
  return { handlers };
}

module.exports = { register, CHANNELS };
