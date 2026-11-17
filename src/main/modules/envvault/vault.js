/**
 * Núcleo do Cofre .env sem Electron: localizar arquivos `.env*`, montar a listagem
 * mascarada (sem valores) e editar entradas pontualmente.
 *
 * Só `readValue` devolve um valor — usado por `envvault:reveal`/`copy`, nunca pela listagem
 * nem pela ferramenta do agente.
 *
 * `io` (opcional, padrão = disco local): { path, readdir(dir) → [{ name, isDirectory, isFile }],
 * stat(p) → { isFile, size }, readFile(p) → texto }. A pasta remota (ipc/envvault.js) passa um
 * io em memória com os .env lidos do host e path POSIX.
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseEnv, setEntry, removeEntry, isValidKey, _scan: scan } = require('./parse');
const { compareEnv, findExampleFile, isExampleFile } = require('./compare');
const { detectSecrets } = require('./detect');

const ENV_NAME_RE = /^\.env(?:\..+)?$/;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist']);
const MAX_DEPTH = 3;
const MAX_FILES = 200;
const MAX_BYTES = 1024 * 1024;
const MASK = '••••••••';

const LOCAL_IO = {
  path,
  readdir: (dir) => fs.readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, isDirectory: d.isDirectory(), isFile: d.isFile() })),
  stat: (p) => { const st = fs.statSync(p); return { isFile: st.isFile(), size: st.size }; },
  readFile: (p) => fs.readFileSync(p, 'utf8'),
};

function isEnvName(name) {
  return ENV_NAME_RE.test(name);
}

/** `.env*` da raiz e de subpastas até profundidade 3 (sem node_modules/.git/dist). */
function findEnvFiles(root, io = LOCAL_IO) {
  const P = io.path || path;
  const out = [];
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length && out.length < MAX_FILES) {
    const { dir, depth } = queue.shift();
    let items;
    try { items = io.readdir(dir); } catch { continue; }
    items.sort((a, b) => a.name.localeCompare(b.name));
    for (const it of items) {
      const full = P.join(dir, it.name);
      if (it.isDirectory) {
        if (depth < MAX_DEPTH && !IGNORED_DIRS.has(it.name)) queue.push({ dir: full, depth: depth + 1 });
      } else if (it.isFile && isEnvName(it.name)) {
        out.push(full);
        if (out.length >= MAX_FILES) break;
      }
    }
  }
  return out;
}

function readEnvText(file, io = LOCAL_IO) {
  const st = io.stat(file);
  if (!st.isFile) throw new Error('Não é um arquivo');
  if (st.size > MAX_BYTES) throw new Error('Arquivo .env grande demais (> 1 MB)');
  return io.readFile(file);
}

/** Linha final (1-based) de cada entrada, para mapear achados multilinha. */
function entrySpans(text) {
  return scan(text).map((e) => ({
    key: e.key,
    from: e.line,
    to: e.line + (text.slice(e.start, e.end).match(/\n/g) || []).length,
  }));
}

/**
 * Lista mascarada de um arquivo. Nunca inclui valores.
 * → { path, rel, name, isExample, entries: [{ key, masked, line, rule?, flags }], compare, otherSecrets }
 */
function describeFile(file, { root, example, detectOptions = {}, io = LOCAL_IO }) {
  const P = io.path || path;
  const text = readEnvText(file, io);
  const { entries } = parseEnv(text);
  const findings = detectSecrets(text, { ...detectOptions, fileName: P.basename(file) });
  const spans = entrySpans(text);
  const secretByIndex = new Map();
  let otherSecrets = 0;
  for (const f of findings) {
    const idx = spans.findIndex((s) => f.line >= s.from && f.line <= s.to);
    if (idx === -1) otherSecrets++;
    else if (!secretByIndex.has(idx)) secretByIndex.set(idx, f.rule);
  }
  let compare = null;
  if (example && example !== file) {
    const exText = readEnvText(example, io);
    compare = { example: rel(root, example, P), ...compareEnv(parseEnv(exText).entries, entries) };
  }
  const extra = new Set(compare?.extra || []);
  const lastIndex = new Map();
  entries.forEach((e, i) => lastIndex.set(e.key, i));
  const out = entries.map((e, i) => {
    const rule = secretByIndex.get(i);
    const isEmpty = e.value === '';
    return {
      key: e.key,
      masked: isEmpty ? '' : MASK,
      line: e.line,
      ...(rule ? { rule } : {}),
      flags: {
        secret: Boolean(rule),
        empty: isEmpty && lastIndex.get(e.key) === i && !isExampleFile(file),
        missing: false,
        extra: extra.has(e.key),
      },
    };
  });
  for (const key of compare?.missing || []) {
    out.push({ key, masked: '', line: null, flags: { secret: false, empty: false, missing: true, extra: false } });
  }
  return {
    path: file,
    rel: rel(root, file, P),
    name: P.basename(file),
    isExample: isExampleFile(file),
    entries: out,
    compare,
    otherSecrets,
  };
}

function rel(root, file, P = path) {
  return (P.relative(root, file) || P.basename(file)).split(P.sep).join('/');
}

/** Listagem completa do workspace (sem valores). */
function listVault(root, { detectOptions, io = LOCAL_IO } = {}) {
  const P = io.path || path;
  const files = findEnvFiles(root, io);
  const byDir = new Map();
  for (const f of files) {
    const d = P.dirname(f);
    if (!byDir.has(d)) byDir.set(d, []);
    byDir.get(d).push(f);
  }
  const out = [];
  for (const f of files) {
    try {
      const example = findExampleFile(byDir.get(P.dirname(f)));
      out.push(describeFile(f, { root, example, detectOptions, io }));
    } catch (e) {
      out.push({ path: f, rel: rel(root, f, P), name: P.basename(f), isExample: isExampleFile(f), entries: [], compare: null, otherSecrets: 0, error: e.message });
    }
  }
  let secrets = 0;
  let missing = 0;
  for (const f of out) {
    secrets += f.entries.filter((e) => e.flags.secret).length + f.otherSecrets;
    missing += f.entries.filter((e) => e.flags.missing).length;
  }
  return { root, files: out, summary: { files: out.length, secrets, missing } };
}

/** Valor efetivo (última ocorrência) — SÓ para reveal/copy. */
function readValue(file, key, io = LOCAL_IO) {
  const entries = parseEnv(readEnvText(file, io)).entries.filter((e) => e.key === key);
  if (!entries.length) throw new Error('Chave não encontrada no arquivo');
  return entries[entries.length - 1].value;
}

function hasKey(text, key) {
  return parseEnv(text).entries.some((e) => e.key === key);
}

function assertValue(value) {
  if (typeof value !== 'string') throw new Error('Valor inválido');
  if (value.includes('\0')) throw new Error('Valor inválido (caractere nulo)');
}

function setValueText(text, key, value) {
  if (!isValidKey(key)) throw new Error('Chave inválida (use letras, números, _ . -)');
  assertValue(value);
  if (!hasKey(text, key)) throw new Error('Chave não encontrada no arquivo');
  return setEntry(text, key, value);
}

function addKeyText(text, key, value) {
  if (!isValidKey(key)) throw new Error('Chave inválida (use letras, números, _ . -)');
  assertValue(value);
  if (hasKey(text, key)) throw new Error('Essa chave já existe no arquivo');
  return setEntry(text, key, value);
}

function removeKeyText(text, key) {
  if (!hasKey(text, key)) throw new Error('Chave não encontrada no arquivo');
  return removeEntry(text, key);
}

/** Texto do example gerado: mesmas linhas/comentários, valores vazios (comentário no fim mantido). */
function exampleFromText(text) {
  let out = text;
  const entries = scan(text);
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const comment = /\s#.*$/.exec(e.suffix)?.[0] || '';
    out = out.slice(0, e.start) + e.head + comment + out.slice(e.end);
  }
  return out;
}

/** Acrescenta ao example as chaves que faltam (vazias). → { text, added } */
function mergeExample(exampleText, sourceText) {
  const have = new Set(parseEnv(exampleText).entries.map((e) => e.key));
  const added = [];
  for (const e of parseEnv(sourceText).entries) {
    if (have.has(e.key)) continue;
    have.add(e.key);
    added.push(e.key);
  }
  let text = exampleText;
  for (const key of added) text = setEntry(text, key, '');
  return { text, added };
}

module.exports = {
  findEnvFiles, listVault, describeFile, readValue, readEnvText, isEnvName,
  setValueText, addKeyText, removeKeyText, exampleFromText, mergeExample, MASK, LOCAL_IO, MAX_BYTES,
};
