/**
 * Histórico local de arquivos (Agzos Git Slider).
 *
 * Layout: <dir>/<sha1(caminho)>/<id> (cópia do conteúdo) + <dir>/<sha1(caminho)>/index.json
 *   index.json = { path, entries: [{ id, ts, size, origin, hash }] } (mais antiga primeiro)
 * id = timestamp em ms (com sufixo -N se repetir no mesmo ms).
 * Pasta 0700, arquivos 0600 (o conteúdo pode ter segredos).
 *
 * createHistoryStore({ dir, getLimits, now }) →
 *   record(path, origin, { content? }) → entry | null   (null: ignorado/igual ao último)
 *   list(path) → entries (mais nova primeiro) · read(path, id) → Buffer
 *   clear(path?) · prune()
 * `content` (Buffer) permite guardar a cópia de um arquivo que não está no disco local
 * (pasta remota). Sem `content`, lê o arquivo de `path`.
 * Ignora binários (byte NUL nos primeiros 8 KB) e arquivos > 1 MB.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { planPrune } = require('./prune');

const MAX_FILE_BYTES = 1024 * 1024;
const ORIGINS = ['salvar', 'agente', 'vassoura', 'cofre', 'externo', 'restaurar'];
const ID_RE = /^\d{10,16}(?:-\d{1,4})?$/;
const KEY_RE = /^[0-9a-f]{40}$/;
const DEFAULT_LIMITS = { maxPerFile: 50, maxDays: 30, maxTotalMB: 300 };

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function createHistoryStore({ dir, getLimits = () => DEFAULT_LIMITS, now = () => Date.now() } = {}) {
  if (!dir) throw new Error('createHistoryStore: dir obrigatório');

  const keyOf = (p) => sha1(String(p));
  let totalBytes = null; // total em cache (null = ainda não varrido nesta sessão)
  const folderOf = (key) => path.join(dir, key);
  const indexFile = (key) => path.join(folderOf(key), 'index.json');

  function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(p, 0o700); } catch {}
  }

  function writePrivate(file, data) {
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch {}
    fs.renameSync(tmp, file);
  }

  function readIndex(key) {
    try {
      const data = JSON.parse(fs.readFileSync(indexFile(key), 'utf8'));
      if (!data || !Array.isArray(data.entries)) return null;
      data.entries = data.entries.filter((e) => e && ID_RE.test(String(e.id)));
      return data;
    } catch {
      return null;
    }
  }

  function writeIndex(key, index) {
    writePrivate(indexFile(key), JSON.stringify(index));
  }

  function limits() {
    const l = { ...DEFAULT_LIMITS, ...(getLimits() || {}) };
    return { maxPerFile: l.maxPerFile, maxDays: l.maxDays, maxTotalBytes: l.maxTotalMB * 1024 * 1024 };
  }

  function record(p, origin, { content } = {}) {
    let buf = content;
    if (buf === undefined) {
      let st;
      try { st = fs.statSync(p); } catch { return null; }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
      buf = fs.readFileSync(p);
    }
    if (typeof buf === 'string') buf = Buffer.from(buf, 'utf8');
    if (!Buffer.isBuffer(buf) || buf.length > MAX_FILE_BYTES || looksBinary(buf)) return null;

    const key = keyOf(p);
    ensureDir(dir);
    ensureDir(folderOf(key));
    const index = readIndex(key) || { path: String(p), entries: [] };
    index.path = String(p);
    const hash = sha1(buf);
    const last = index.entries[index.entries.length - 1];
    if (last && last.hash === hash) return null;

    const ts = now();
    let id = String(ts);
    for (let n = 1; index.entries.some((e) => e.id === id); n++) id = `${ts}-${n}`;
    const entry = { id, ts, size: buf.length, origin: ORIGINS.includes(origin) ? origin : 'externo', hash };
    writePrivate(path.join(folderOf(key), id), buf);
    index.entries.push(entry);
    writeIndex(key, index);
    // Varredura completa na 1ª gravação da sessão (poda por idade de todos) e quando o
    // total passa do limite; nas demais, só a poda deste arquivo.
    if (totalBytes === null || totalBytes + buf.length > limits().maxTotalBytes) prune();
    else {
      totalBytes += buf.length;
      pruneFiles([{ key, index }]);
    }
    return { ...entry, path: String(p) };
  }

  function list(p) {
    const index = readIndex(keyOf(p));
    if (!index) return [];
    return [...index.entries].sort((a, b) => b.ts - a.ts).map((e) => ({ ...e, path: index.path }));
  }

  function read(p, id) {
    if (!ID_RE.test(String(id))) throw new Error('Versão inválida');
    const key = keyOf(p);
    const index = readIndex(key);
    if (!index || !index.entries.some((e) => e.id === id)) throw new Error('Versão não encontrada no histórico local');
    return fs.readFileSync(path.join(folderOf(key), id));
  }

  function keys() {
    try { return fs.readdirSync(dir).filter((k) => KEY_RE.test(k)); } catch { return []; }
  }

  function clear(p) {
    const targets = p === undefined || p === null ? keys() : [keyOf(p)];
    for (const key of targets) fs.rmSync(folderOf(key), { recursive: true, force: true });
    totalBytes = null;
  }

  /** Poda completa (todos os arquivos); recalcula o total em cache. */
  function prune() {
    const all = [];
    for (const key of keys()) {
      const index = readIndex(key);
      if (index) all.push({ key, index });
    }
    const removed = pruneFiles(all, { total: true });
    totalBytes = 0;
    for (const { index } of all) for (const e of index.entries) totalBytes += e.size || 0;
    return removed;
  }

  function pruneFiles(list, { total = false } = {}) {
    const indexes = new Map(list.map(({ key, index }) => [key, index]));
    const files = list.map(({ key, index }) => ({ key, entries: index.entries }));
    const l = limits();
    const del = planPrune(files, { ...l, maxTotalBytes: total ? l.maxTotalBytes : Infinity, now: now() });
    if (!del.length) return 0;
    const byKey = new Map();
    for (const d of del) {
      if (!byKey.has(d.key)) byKey.set(d.key, new Set());
      byKey.get(d.key).add(d.id);
    }
    for (const [key, ids] of byKey) {
      const index = indexes.get(key);
      for (const id of ids) {
        try { fs.unlinkSync(path.join(folderOf(key), id)); } catch {}
      }
      const gone = index.entries.filter((e) => ids.has(e.id));
      if (totalBytes !== null) for (const e of gone) totalBytes -= e.size || 0;
      index.entries = index.entries.filter((e) => !ids.has(e.id));
      if (index.entries.length) writeIndex(key, index);
      else fs.rmSync(folderOf(key), { recursive: true, force: true });
    }
    return del.length;
  }

  return { record, list, read, clear, prune };
}

module.exports = { createHistoryStore, looksBinary, MAX_FILE_BYTES, ORIGINS };
