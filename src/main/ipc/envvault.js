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
const { providerFor, runAsOwner, isRemote, parseRemoteUri, toRemoteUri } = require('../workspace/provider-for');
const { shQuote } = require('../remote/sh');

const REMOTE_ONLY_LOCAL = 'Indisponível em pasta remota.';

/**
 * Pasta remota: io em memória (path POSIX) com os .env* do host lidos pelo provider,
 * para o núcleo síncrono do Cofre (vault.js) analisar localmente.
 */
async function remoteEnvIo(prov, rootUri) {
  const rootPath = prov.pathOf(rootUri);
  const script = `cd ${shQuote(rootPath)} && find . -maxdepth 4 \\( -name node_modules -o -name .git -o -name dist \\) -prune -o -type f -name '.env*' -print 2>/dev/null | head -n 200`;
  const res = await prov.execRaw(script, { timeoutMs: 30_000 });
  const files = new Map(); // caminho POSIX → { size, text }
  for (const line of String(res.stdout).split('\n')) {
    const rel = line.trim().replace(/^\.\//, '');
    if (!rel) continue;
    const full = path.posix.join(rootPath, rel);
    const uri = toRemoteUri(prov.authority, full);
    try {
      const st = await prov.stat(uri);
      files.set(full, { size: st.size, text: st.size > vault.MAX_BYTES ? '' : await prov.readFile(uri, 'utf8') });
    } catch { /* sumiu */ }
  }
  return memoryIo(files);
}

async function remoteFileIo(prov, uri) {
  const full = prov.pathOf(uri);
  const st = await prov.stat(uri);
  const files = new Map([[full, { size: st.size, text: st.size > vault.MAX_BYTES ? '' : await prov.readFile(uri, 'utf8') }]]);
  return memoryIo(files);
}

function memoryIo(files) {
  return {
    path: path.posix,
    readdir(dir) {
      const names = new Map();
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      for (const f of files.keys()) {
        if (!f.startsWith(prefix)) continue;
        const [first, ...rest] = f.slice(prefix.length).split('/');
        if (!names.has(first)) names.set(first, { name: first, isDirectory: rest.length > 0, isFile: rest.length === 0 });
      }
      return [...names.values()];
    },
    stat(p) {
      const f = files.get(p);
      if (!f) throw Object.assign(new Error(`Não encontrado: ${p}`), { code: 'ENOENT' });
      return { isFile: true, size: f.size };
    },
    readFile(p) {
      const f = files.get(p);
      if (!f) throw Object.assign(new Error(`Não encontrado: ${p}`), { code: 'ENOENT' });
      return f.text;
    },
  };
}

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
      if (isRemote(abs)) return abs; // pasta remota: a raiz já foi conferida no workspace:open
      if (!fs.statSync(abs).isDirectory()) throw new Error('A raiz do Cofre precisa ser uma pasta');
      return abs;
    }

    function envFile(p) {
      if (typeof p !== 'string' || !p || p.includes('\0')) throw new Error('Caminho inválido');
      const abs = g.assertAllowed(p);
      if (!vault.isEnvName(isRemote(abs) ? path.posix.basename(abs) : path.basename(abs))) throw new Error('O Cofre só edita arquivos .env');
      return abs;
    }

    const prov = (uri) => providerFor(uri, sender);

    /** Pasta remota: escreve no host guardando o original no checkpoint local. */
    async function writeRemoteWithCheckpoint(uri, text) {
      if (cpDir) {
        fs.mkdirSync(cpDir, { recursive: true, mode: 0o700 });
        try { fs.chmodSync(cpDir, 0o700); } catch {}
      }
      const cp = checkpoints.create({ root: null });
      await cp.recordRemote(uri, prov(uri));
      // Histórico local: cópia do original lido no host.
      try { recordBefore(uri, 'cofre', { content: await prov(uri).readFile(uri) }); } catch { /* novo */ }
      await prov(uri).writeFile(uri, text);
      cp.noteRemote(uri, text);
      cp.finalize();
      owners.set(cp.id, senderId(sender));
      while (owners.size > 200) owners.delete(owners.keys().next().value);
      return cp.id;
    }

    async function readRemoteEnv(uri) {
      const io = await remoteFileIo(prov(uri), uri);
      return vault.readEnvText(prov(uri).pathOf(uri), io);
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
      if (isRemote(abs)) {
        return readRemoteEnv(abs).then(async (text) => ({ checkpointId: await writeRemoteWithCheckpoint(abs, fn(text)) }));
      }
      const next = fn(vault.readEnvText(abs));
      return { checkpointId: writeWithCheckpoint(abs, next) };
    }

    async function gitRoot(root) {
      try {
        const { stdout } = await runGit(root, ['rev-parse', '--show-toplevel']);
        if (isRemote(root)) return toRemoteUri(parseRemoteUri(root).authority, stdout.trim());
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

    async function listRemote(rootUri) {
      const pr = prov(rootUri);
      const io = await remoteEnvIo(pr, rootUri);
      const res = vault.listVault(pr.pathOf(rootUri), { detectOptions: detectOptions(), io });
      const toUri = (p) => toRemoteUri(pr.authority, p);
      return { ...res, root: rootUri, files: res.files.map((f) => ({ ...f, path: toUri(f.path) })) };
    }

    async function valueOf(p, key) {
      const abs = envFile(p);
      if (!isRemote(abs)) return vault.readValue(abs, String(key));
      const io = await remoteFileIo(prov(abs), abs);
      return vault.readValue(prov(abs).pathOf(abs), String(key), io);
    }

    async function generateExampleRemote(src) {
      const pr = prov(src);
      const dirUri = toRemoteUri(pr.authority, path.posix.dirname(pr.pathOf(src)));
      const siblings = (await pr.readDir(dirUri)).map((e) => e.path);
      const existing = findExampleFile(siblings.map((u) => pr.pathOf(u)));
      const target = existing ? toRemoteUri(pr.authority, existing) : toRemoteUri(pr.authority, path.posix.join(pr.pathOf(dirUri), '.env.example'));
      g.assertAllowed(target);
      const srcText = await readRemoteEnv(src);
      if (!existing) {
        const text = vault.exampleFromText(srcText);
        return { path: target, created: true, added: [], checkpointId: await writeRemoteWithCheckpoint(target, text) };
      }
      const { text, added } = vault.mergeExample(await readRemoteEnv(target), srcText);
      const checkpointId = added.length ? await writeRemoteWithCheckpoint(target, text) : null;
      return { path: target, created: false, added, checkpointId };
    }

    const localOnly = async (root) => {
      if (isRemote(resolveRoot(root))) throw new Error(REMOTE_ONLY_LOCAL);
      return repoOrThrow(root);
    };

    return {
      list: (root) => {
        const r = resolveRoot(root);
        return isRemote(r) ? listRemote(r) : vault.listVault(r, { detectOptions: detectOptions() });
      },

      reveal: async (p, key) => ({ value: await valueOf(p, key) }),

      copy: async (p, key) => {
        getClipboard().writeText(await valueOf(p, key));
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
        return checkpoints.undoAsync(id, { assertPath: (p) => g.assertAllowed(p), providerFor: (p) => prov(p) }).then((result) => {
          if (!result.errors.length || result.restored.length) owners.delete(id);
          return result;
        });
      },

      generateExample: (p) => {
        const src = envFile(p);
        if (isRemote(src)) return generateExampleRemote(src);
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

      // Gancho pre-commit grava em .git/hooks local: não suportado na pasta remota.
      installHook: async (root) => hook.installHook(await localOnly(root)),
      removeHook: async (root) => hook.removeHook(await localOnly(root)),
      hookStatus: async (root) => (isRemote(resolveRoot(root)) ? { installed: false, remote: true } : hook.hookStatus(await repoOrThrow(root))),

      gitignoreStatus: async (root) => {
        const dir = resolveRoot(root);
        const hasEnv = isRemote(dir)
          ? await prov(dir).exists(toRemoteUri(parseRemoteUri(dir).authority, path.posix.join(parseRemoteUri(dir).path, '.env')))
          : fs.existsSync(path.join(dir, '.env'));
        const repo = await gitRoot(dir);
        if (!repo) return { repo: false, hasEnv, ignored: false };
        try {
          await runGit(dir, ['check-ignore', '-q', '--no-index', '.env']);
          return { repo: true, hasEnv, ignored: true };
        } catch {
          return { repo: true, hasEnv, ignored: false };
        }
      },

      addToGitignore: async (root) => {
        const dir = resolveRoot(root);
        const remote = isRemote(dir);
        const file = remote ? toRemoteUri(parseRemoteUri(dir).authority, path.posix.join(parseRemoteUri(dir).path, '.gitignore')) : path.join(dir, '.gitignore');
        let text = '';
        if (remote) { try { text = await prov(file).readFile(file, 'utf8'); } catch {} } else { try { text = fs.readFileSync(file, 'utf8'); } catch {} }
        const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
        const added = GITIGNORE_LINES.filter((l) => !have.has(l));
        if (!added.length) return { added };
        const eol = text.includes('\r\n') ? '\r\n' : '\n';
        const sep = text && !text.endsWith('\n') ? eol : '';
        if (remote) await prov(file).writeFile(file, `${text}${sep}${added.join(eol)}${eol}`);
        else fs.writeFileSync(file, `${text}${sep}${added.join(eol)}${eol}`);
        return { added, path: file };
      },
    };
  }

  const handlers = handlersFor(null);
  for (const name of Object.keys(handlers)) {
    ipcMain.handle(`envvault:${name}`, async (e, ...args) => runAsOwner(e?.sender, () => handlersFor(e?.sender)[name](...args)));
  }
  return { handlers };
}

module.exports = { register, CHANNELS };
