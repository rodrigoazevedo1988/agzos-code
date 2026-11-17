/**
 * Checkpoints do agente: antes da 1ª modificação de cada caminho num pedido,
 * guarda o estado original (conteúdo, pasta ou "não existia"). `undo` restaura
 * tudo: recria apagados, sobrescreve editados e apaga o que foi criado.
 *
 * Em memória + userData/agent-checkpoints/<id>.json (máx. 20 checkpoints, 50MB).
 * Os arquivos guardam conteúdo original (pode ter segredos): pasta 0700, arquivos 0600.
 * `undo(id, { assertPath })`: cada caminho passa por assertPath (guard da janela) antes
 * de qualquer mudança; um negado → nada é restaurado e o checkpoint continua.
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

    /** Arquivos alterados desde o início do pedido (estado original vs disco). */
    function changes() {
      const out = [];
      for (const [p, entry] of entries) {
        if (entry.kind === 'dir') continue;
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
      return { id, root: root || null, createdAt: Date.now(), entries: [...entries] };
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

    return { id, record, recordTree, recordParents, changes, finalize, get size() { return entries.size; } };
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

  return { create, undo, load, prune };
}

module.exports = { createCheckpointStore };
