/**
 * Biblioteca de snippets (userData/snippets.json).
 *
 * Formato: { version: 1, snippets: [{ id, name, category, language, body, tags, createdAt, updatedAt, builtin? }] }
 * - Arquivo ausente → grava a biblioteca inicial (seed, builtin: true).
 * - JSON corrompido → `snippets.json.corrupt-<ts>` e volta à biblioteca inicial.
 * - Escrita atômica: `<arquivo>.<pid>.<rand>.tmp` (0600) + rename. Falha → arquivo anterior intacto.
 * - Builtins são editáveis/apagáveis; restoreDefaults() devolve os originais (os do usuário ficam).
 *
 * createSnippetStore({ file, seed, now?, fs? }) → { list, get, save, remove, duplicate, restoreDefaults,
 *   exportData, importData, onChange }
 */

const nodeFs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 1;
const LANGUAGES = ['html', 'jsx', 'css', 'tailwind'];
const MAX_BODY = 256 * 1024;
const MAX_NAME = 120;
const MAX_CATEGORY = 60;
const MAX_TAGS = 20;
const MAX_SNIPPETS = 2000;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Filtro da busca: todos os termos em nome/categoria/tags (sem acento e caixa); categoria exata opcional. */
function searchSnippets(list, query = '', category = '') {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  return list.filter((s) => {
    if (category && s.category !== category) return false;
    if (!terms.length) return true;
    const hay = fold([s.name, s.category, ...(s.tags || [])].join(' '));
    return terms.every((t) => hay.includes(t));
  });
}

function newId() {
  return `s-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

/** Valida e normaliza a entrada; lança Error com mensagem pt-BR. */
function cleanInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Snippet inválido');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new Error('O snippet precisa de um nome');
  if (name.length > MAX_NAME) throw new Error(`Nome longo demais (máx. ${MAX_NAME})`);
  const category = (typeof input.category === 'string' ? input.category.trim() : '').slice(0, MAX_CATEGORY) || 'Outros';
  if (!LANGUAGES.includes(input.language)) throw new Error(`Linguagem inválida (use ${LANGUAGES.join(', ')})`);
  if (typeof input.body !== 'string') throw new Error('O corpo do snippet precisa ser texto');
  if (Buffer.byteLength(input.body, 'utf8') > MAX_BODY) throw new Error('Snippet grande demais (máx. 256 KB)');
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.filter((t) => typeof t === 'string').map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_TAGS)
    : [];
  return { name, category, language: input.language, body: input.body, tags };
}

function fromDisk(item) {
  try {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !ID_RE.test(item.id)) return null;
    const clean = cleanInput(item);
    const out = {
      id: item.id,
      ...clean,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
      updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
    };
    if (item.builtin === true) out.builtin = true;
    return out;
  } catch {
    return null;
  }
}

function createSnippetStore({ file, seed = [], now = Date.now, fs = nodeFs } = {}) {
  if (!file) throw new Error('createSnippetStore: file obrigatório');
  let cache = null; // Array em memória (fonte da verdade após a 1ª leitura)
  const listeners = new Set();

  const seedItems = () => seed.map((s) => {
    const t = now();
    return { id: s.id, ...cleanInput(s), createdAt: t, updatedAt: t, builtin: true };
  });

  function write(list) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, snippets: list }, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw e;
    }
    try { fs.chmodSync(file, 0o600); } catch {}
  }

  function load() {
    if (cache) return cache;
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const list = seedItems();
      write(list);
      cache = list;
      return cache;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.snippets)) throw new Error('formato');
    } catch {
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
      const list = seedItems();
      write(list);
      cache = list;
      return cache;
    }
    const seen = new Set();
    cache = parsed.snippets.map(fromDisk).filter((s) => s && !seen.has(s.id) && seen.add(s.id));
    return cache;
  }

  /** Aplica a mudança numa cópia, grava e só então troca o cache. */
  function commit(next) {
    if (next.length > MAX_SNIPPETS) throw new Error(`Limite de ${MAX_SNIPPETS} snippets atingido`);
    write(next);
    cache = next;
    for (const fn of listeners) {
      try { fn(); } catch {}
    }
  }

  const clone = (s) => (s ? { ...s, tags: [...s.tags] } : null);

  function list({ query = '', category = '' } = {}) {
    return searchSnippets(load(), query, category).map(clone);
  }

  function get(id) {
    return clone(load().find((s) => s.id === id));
  }

  function save(input) {
    const clean = cleanInput(input);
    const items = load();
    const idx = typeof input.id === 'string' ? items.findIndex((s) => s.id === input.id) : -1;
    const t = now();
    let saved;
    const next = [...items];
    if (idx >= 0) {
      const prev = items[idx];
      saved = { ...prev, ...clean, updatedAt: t };
      next[idx] = saved;
    } else {
      const id = typeof input.id === 'string' && ID_RE.test(input.id) ? input.id : newId();
      saved = { id, ...clean, createdAt: t, updatedAt: t };
      next.push(saved);
    }
    commit(next);
    return clone(saved);
  }

  function remove(id) {
    const items = load();
    if (!items.some((s) => s.id === id)) return false;
    commit(items.filter((s) => s.id !== id));
    return true;
  }

  function duplicate(id) {
    const src = load().find((s) => s.id === id);
    if (!src) throw new Error('Snippet não encontrado');
    return save({ name: `${src.name} (cópia)`.slice(0, MAX_NAME), category: src.category, language: src.language, body: src.body, tags: src.tags });
  }

  function restoreDefaults() {
    const originals = seedItems();
    const ids = new Set(originals.map((s) => s.id));
    const next = [...load().filter((s) => !ids.has(s.id)), ...originals];
    commit(next);
    return { restored: originals.length };
  }

  function exportData() {
    return { version: VERSION, snippets: load().map(({ builtin: _b, ...s }) => ({ ...s, tags: [...s.tags] })) };
  }

  function importData(data) {
    let parsed = data;
    if (typeof data === 'string') {
      try { parsed = JSON.parse(data); } catch { throw new Error('Arquivo não é um JSON válido'); }
    }
    const items = Array.isArray(parsed) ? parsed : parsed?.snippets;
    if (!Array.isArray(items)) throw new Error('JSON sem lista de snippets');
    const next = [...load()];
    const t = now();
    let added = 0;
    let updated = 0;
    let skipped = 0;
    for (const item of items) {
      let clean;
      try { clean = cleanInput(item); } catch { skipped++; continue; }
      const id = typeof item.id === 'string' && ID_RE.test(item.id) ? item.id : null;
      const idx = id ? next.findIndex((s) => s.id === id) : -1;
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...clean, updatedAt: t };
        updated++;
      } else {
        next.push({ id: id || newId(), ...clean, createdAt: t, updatedAt: t });
        added++;
      }
    }
    if (added || updated) commit(next);
    return { added, updated, skipped };
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { list, get, save, remove, duplicate, restoreDefaults, exportData, importData, onChange, file };
}

module.exports = { createSnippetStore, searchSnippets, cleanInput, LANGUAGES, MAX_BODY };
