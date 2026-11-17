/**
 * Checkpoints do agente: antes da 1ª modificação de cada caminho num pedido,
 * guarda o estado original (conteúdo, pasta ou "não existia"). `undo` restaura
 * tudo: recria apagados, sobrescreve editados e apaga o que foi criado.
 *
 * Em memória + userData/agent-checkpoints/<id>.json (máx. 20 checkpoints, 50MB).
 * Os arquivos guardam conteúdo original (pode ter segredos): pasta 0700, arquivos 0600.
 * `undo(id, { assertPath })`: cada caminho passa por assertPath (guard da janela) antes
 * de qualquer mudança; um negado → nada é restaurado e o checkpoint continua.
 *
 * Pasta remota (1.2.0): `recordRemote(uri, provider)` guarda o original do host aqui
 * (localmente, mesmas regras de 0600) e `noteRemote(uri, texto|null)` informa o estado
 * depois da escrita (para changes() sem ir ao host). `undoAsync(id, { assertPath,
 * providerFor })` restaura caminhos ssh:// pelo provider da janela.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { lineStats } = require('./text');

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function lstatOrNull(p) {
  try { return fs.lstatSync(p); } catch { return null; }
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function depth(p) {
  return p.split(/[\\/]+/).filter(Boolean).length;
}

function createCheckpointStore({ dir, maxCount = 20, maxBytes = 50 * 1024 * 1024 } = {}) {
  const memory = new Map();

  function fileFor(id) {
    if (!ID_RE.test(String(id))) throw new Error('Checkpoint inválido');
    return dir ? path.join(dir, `${id}.json`) : null;
  }

  /** Mantém os mais recentes (e sempre `keepId`) dentro de maxCount/maxBytes. */
  function prune(keepId) {
    if (!dir) return;
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
        const full = path.join(dir, f);
        const st = lstatOrNull(full);
        return st ? { full, id: f.slice(0, -5), mtime: st.mtimeMs, size: st.size } : null;
      }).filter(Boolean).sort((a, b) => (b.id === keepId) - (a.id === keepId) || b.mtime - a.mtime);
    } catch { return; }
    let total = 0;
    files.forEach((file, index) => {
      total += file.size;
      if (index > 0 && (index >= maxCount || total > maxBytes)) {
        try { fs.unlinkSync(file.full); } catch {}
        memory.delete(file.id);
      }
    });
    // Memória também limitada ao mesmo número.
    const ids = [...memory.keys()];
    while (ids.length > maxCount) memory.delete(ids.shift());
  }

  function create({ root } = {}) {
    const id = randomUUID();
    const entries = new Map();
    let bytes = 0;

    function record(abs) {
      if (entries.has(abs)) return;
      const st = lstatOrNull(abs);
      if (!st) { entries.set(abs, { kind: 'missing' }); return; }
      if (st.isSymbolicLink()) {
        let target = null;
        try { target = fs.readlinkSync(abs); } catch {}
        entries.set(abs, { kind: 'symlink', target });
        return;
      }
      if (st.isDirectory()) { entries.set(abs, { kind: 'dir' }); return; }
      if (bytes + st.size > maxBytes) { entries.set(abs, { kind: 'file', tooLarge: true, mode: st.mode }); return; }
      const data = fs.readFileSync(abs);
      bytes += data.length;
      entries.set(abs, { kind: 'file', data: data.toString('base64'), mode: st.mode });
    }

    /** Registra o caminho e, se for pasta, tudo dentro dela. */
    function recordTree(abs) {
      record(abs);
      const st = lstatOrNull(abs);
      if (!st || !st.isDirectory() || st.isSymbolicLink()) return;
      for (const name of fs.readdirSync(abs)) recordTree(path.join(abs, name));
    }

    /** Registra pastas pai que ainda não existem (serão criadas pela operação). */
    function recordParents(abs) {
      const missing = [];
      let cur = path.dirname(abs);
      while (cur !== path.dirname(cur) && !lstatOrNull(cur)) {
        missing.push(cur);
        if (root && path.resolve(cur) === path.resolve(root)) break;
        cur = path.dirname(cur);
      }
      for (const p of missing) record(p);
    }

    /** Original de um caminho remoto (ssh://), lido pelo provider. */
    async function recordRemote(uri, provider) {
      if (entries.has(uri)) return;
      let st = null;
      try { st = await provider.stat(uri); } catch { st = null; }
      if (!st) { entries.set(uri, { kind: 'missing', remote: true }); return; }
      if (st.isDirectory) { entries.set(uri, { kind: 'dir', remote: true }); return; }
      if (bytes + st.size > maxBytes) { entries.set(uri, { kind: 'file', tooLarge: true, remote: true }); return; }
      const data = await provider.readFile(uri);
      bytes += data.length;
      entries.set(uri, { kind: 'file', data: data.toString('base64'), remote: true });
    }

    async function recordRemoteTree(uri, provider) {
      await recordRemote(uri, provider);
      const e = entries.get(uri);
      if (e?.kind !== 'dir') return;
      for (const child of await provider.readDir(uri)) await recordRemoteTree(child.path, provider);
    }

    /** Estado depois da escrita (texto; null = apagado) para changes() de caminhos remotos. */
    function noteRemote(uri, text) {
      const e = entries.get(uri);
      if (e) { e.after = text; e.afterKnown = true; }
    }

    /** Arquivos alterados desde o início do pedido (estado original vs disco). */
    function changes() {
      const out = [];
      for (const [p, entry] of entries) {
        if (entry.kind === 'dir') continue;
        if (entry.remote) {
          if (!entry.afterKnown) continue;
          const before = entry.kind === 'file' && !entry.tooLarge ? Buffer.from(entry.data, 'base64').toString('utf8') : null;
          if (entry.after === null) { if (entry.kind !== 'missing') out.push({ path: p, ...lineStats(before, null), deleted: true }); continue; }
          if (entry.kind === 'missing') { out.push({ path: p, ...lineStats(null, entry.after), created: true }); continue; }
          if (entry.after !== before) out.push({ path: p, ...lineStats(before, entry.after) });
          continue;
        }
        const st = lstatOrNull(p);
        if (entry.kind === 'missing') {
          if (!st || st.isDirectory()) continue;
          out.push({ path: p, ...lineStats(null, readText(p)), created: true });
          continue;
        }
        if (entry.kind === 'symlink') {
          if (!st) out.push({ path: p, added: 0, removed: 0, deleted: true });
          continue;
        }
        const before = entry.tooLarge ? null : Buffer.from(entry.data, 'base64').toString('utf8');
        if (!st) { out.push({ path: p, ...lineStats(before, null), deleted: true }); continue; }
        if (st.isDirectory()) continue;
        const after = readText(p);
        if (after === before) continue;
        out.push({ path: p, ...lineStats(before, after) });
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    }

    function toJSON() {
      const list = [...entries].map(([p, e]) => {
        if (!e.remote) return [p, e];
        const rest = { ...e };
        delete rest.after;
        delete rest.afterKnown;
        return [p, rest];
      });
      return { id, root: root || null, createdAt: Date.now(), entries: list };
    }

    function finalize() {
      if (!entries.size) return false;
      memory.set(id, toJSON());
      if (dir) {
        try {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
          try { fs.chmodSync(dir, 0o700); } catch { /* Windows/FS sem chmod */ }
          const file = fileFor(id);
          fs.writeFileSync(file, JSON.stringify(toJSON()), { mode: 0o600 });
          try { fs.chmodSync(file, 0o600); } catch { /* Windows/FS sem chmod */ }
        } catch (err) {
          console.error('[agent] checkpoint não gravado', err.message);
        }
      }
      prune(id);
      return true;
    }

    return {
      id, record, recordTree, recordParents, recordRemote, recordRemoteTree, noteRemote, changes, finalize,
      get size() { return entries.size; },
    };
  }

  function load(id) {
    const file = fileFor(id);
    if (memory.has(id)) return memory.get(id);
    if (!file) return null;
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }

  /** Restaura o checkpoint. → { restored: [path], errors: [{ path, message }] } */
  function undo(id, { assertPath = null } = {}) {
    const data = load(id);
    if (!data) return { restored: [], errors: [{ path: null, message: 'Checkpoint não encontrado' }] };
    const entries = data.entries || [];
    // Caminhos ssh:// nunca passam pelo fs local (virariam caminhos relativos).
    if (entries.some(([, e]) => e.remote)) return { restored: [], errors: [{ path: null, message: 'Checkpoint de pasta remota: use undoAsync' }] };
    if (typeof assertPath === 'function') {
      const denied = [];
      for (const [p] of entries) {
        try { assertPath(p); } catch (err) { denied.push({ path: p, message: String(err?.message || err) }); }
      }
      if (denied.length) return { restored: [], errors: denied };
    }
    const restored = [];
    const errors = [];
    const fail = (p, err) => errors.push({ path: p, message: String(err?.message || err) });

    // 1) Apaga o que foi criado (mais fundo primeiro).
    const missing = entries.filter(([, e]) => e.kind === 'missing').sort((a, b) => depth(b[0]) - depth(a[0]));
    for (const [p] of missing) {
      if (!lstatOrNull(p)) continue;
      try { fs.rmSync(p, { recursive: true, force: true }); restored.push(p); } catch (err) { fail(p, err); }
    }
    // 2) Recria pastas que existiam (mais rasas primeiro).
    const dirs = entries.filter(([, e]) => e.kind === 'dir').sort((a, b) => depth(a[0]) - depth(b[0]));
    for (const [p] of dirs) {
      const st = lstatOrNull(p);
      if (st && st.isDirectory()) continue;
      try {
        if (st) fs.rmSync(p, { force: true });
        fs.mkdirSync(p, { recursive: true });
        restored.push(p);
      } catch (err) { fail(p, err); }
    }
    // 3) Restaura arquivos e links.
    for (const [p, e] of entries) {
      if (e.kind !== 'file' && e.kind !== 'symlink') continue;
      if (e.tooLarge) { fail(p, 'Arquivo grande demais para o checkpoint; não restaurado'); continue; }
      try {
        const st = lstatOrNull(p);
        if (e.kind === 'symlink') {
          if (st && st.isSymbolicLink() && fs.readlinkSync(p) === e.target) continue;
          if (st) fs.rmSync(p, { recursive: true, force: true });
          fs.mkdirSync(path.dirname(p), { recursive: true });
          fs.symlinkSync(e.target, p);
          restored.push(p);
          continue;
        }
        const buf = Buffer.from(e.data, 'base64');
        if (st && st.isFile()) {
          try { if (fs.readFileSync(p).equals(buf)) continue; } catch {}
        }
        if (st && !st.isFile()) fs.rmSync(p, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, buf);
        if (e.mode) { try { fs.chmodSync(p, e.mode & 0o7777); } catch {} }
        restored.push(p);
      } catch (err) { fail(p, err); }
    }

    memory.delete(id);
    const file = fileFor(id);
    if (file) { try { fs.unlinkSync(file); } catch {} }
    return { restored, errors };
  }

  /**
   * Como undo, mas também restaura caminhos remotos (ssh://) pelo provider da janela.
   * providerFor(uri) → provider. Sem entradas remotas, é o undo síncrono.
   */
  async function undoAsync(id, { assertPath = null, providerFor } = {}) {
    const data = load(id);
    if (!data) return { restored: [], errors: [{ path: null, message: 'Checkpoint não encontrado' }] };
    const entries = data.entries || [];
    if (!entries.some(([, e]) => e.remote)) return undo(id, { assertPath });
    if (typeof assertPath === 'function') {
      const denied = [];
      for (const [p] of entries) {
        try { assertPath(p); } catch (err) { denied.push({ path: p, message: String(err?.message || err) }); }
      }
      if (denied.length) return { restored: [], errors: denied };
    }
    if (typeof providerFor !== 'function') return { restored: [], errors: [{ path: null, message: 'Pasta remota indisponível' }] };
    const restored = [];
    const errors = [];
    const fail = (p, err) => errors.push({ path: p, message: String(err?.message || err) });
    const exists = async (prov, p) => { try { return await prov.stat(p); } catch { return null; } };
    const missing = entries.filter(([, e]) => e.kind === 'missing').sort((a, b) => depth(b[0]) - depth(a[0]));
    for (const [p] of missing) {
      try {
        const prov = providerFor(p);
        if (!(await exists(prov, p))) continue;
        await prov.remove(p);
        restored.push(p);
      } catch (err) { fail(p, err); }
    }
    const dirs = entries.filter(([, e]) => e.kind === 'dir').sort((a, b) => depth(a[0]) - depth(b[0]));
    for (const [p] of dirs) {
      try {
        const prov = providerFor(p);
        const st = await exists(prov, p);
        if (st && st.isDirectory) continue;
        if (st) await prov.remove(p);
        await prov.mkdir(p);
        restored.push(p);
      } catch (err) { fail(p, err); }
    }
    for (const [p, e] of entries) {
      if (e.kind !== 'file') continue;
      if (e.tooLarge) { fail(p, 'Arquivo grande demais para o checkpoint; não restaurado'); continue; }
      try {
        const prov = providerFor(p);
        const buf = Buffer.from(e.data, 'base64');
        const st = await exists(prov, p);
        if (st && st.isFile) {
          try { if ((await prov.readFile(p)).equals(buf)) continue; } catch {}
        }
        if (st && !st.isFile) await prov.remove(p);
        await prov.writeFile(p, buf);
        restored.push(p);
      } catch (err) { fail(p, err); }
    }
    memory.delete(id);
    const file = fileFor(id);
    if (file) { try { fs.unlinkSync(file); } catch {} }
    return { restored, errors };
  }

  return { create, undo, undoAsync, load, prune };
}

module.exports = { createCheckpointStore };
