/**
 * Agzos Formatador — leitura SEGURA da configuração do Prettier do projeto.
 *
 * Nunca executa código do projeto: só lê .prettierrc (JSON ou YAML simples), .prettierrc.json,
 * .prettierrc.yaml/.yml e a chave "prettier" (objeto) do package.json. Configs em código
 * (.js/.cjs/.mjs/.ts, prettier.config.*) e configs compartilhadas (string no package.json)
 * são ignoradas com aviso. Opções passam por uma lista branca: `plugins` nunca passa.
 *
 * readPrettierConfig(dir, { root? }) → { config: object|null, file?, ignored?, warning? }
 *   Procura em `dir` e sobe até `root` (inclusive); sem root, só em `dir`.
 * sanitizeOptions(obj) → opções conhecidas com tipo válido
 * optionsForFile(config, filePath, configDir) → opções finais (com overrides por glob)
 * parseSimpleYaml(text) → objeto plano (só "chave: valor"); estrutura aninhada lança erro
 */

const fs = require('fs');
const path = require('path');

const MAX_CONFIG_BYTES = 256 * 1024;

// Ordem de busca do próprio Prettier; `safe: false` → nunca lido (código ou formato sem parser seguro).
const CANDIDATES = [
  { name: 'package.json', kind: 'package' },
  { name: '.prettierrc', kind: 'json-or-yaml' },
  { name: '.prettierrc.json', kind: 'json' },
  { name: '.prettierrc.yaml', kind: 'yaml' },
  { name: '.prettierrc.yml', kind: 'yaml' },
  { name: '.prettierrc.json5', kind: 'unsupported' },
  { name: '.prettierrc.js', kind: 'code' },
  { name: '.prettierrc.ts', kind: 'code' },
  { name: '.prettierrc.mjs', kind: 'code' },
  { name: '.prettierrc.mts', kind: 'code' },
  { name: '.prettierrc.cjs', kind: 'code' },
  { name: '.prettierrc.cts', kind: 'code' },
  { name: 'prettier.config.js', kind: 'code' },
  { name: 'prettier.config.ts', kind: 'code' },
  { name: 'prettier.config.mjs', kind: 'code' },
  { name: 'prettier.config.mts', kind: 'code' },
  { name: 'prettier.config.cjs', kind: 'code' },
  { name: 'prettier.config.cts', kind: 'code' },
  { name: '.prettierrc.toml', kind: 'unsupported' },
];

const BOOL = ['semi', 'singleQuote', 'jsxSingleQuote', 'bracketSpacing', 'bracketSameLine', 'useTabs',
  'singleAttributePerLine', 'vueIndentScriptAndStyle', 'experimentalTernaries', 'insertPragma', 'requirePragma'];
const INT = { printWidth: [1, 1000], tabWidth: [0, 32] };
const ENUM = {
  trailingComma: ['all', 'es5', 'none'],
  quoteProps: ['as-needed', 'consistent', 'preserve'],
  arrowParens: ['always', 'avoid'],
  proseWrap: ['always', 'never', 'preserve'],
  htmlWhitespaceSensitivity: ['css', 'strict', 'ignore'],
  endOfLine: ['lf', 'crlf', 'cr', 'auto'],
  embeddedLanguageFormatting: ['auto', 'off'],
  objectWrap: ['preserve', 'collapse'],
  experimentalOperatorPosition: ['start', 'end'],
  // Só os parsers embutidos no Prettier (um nome desconhecido faria o Prettier procurar plugin).
  parser: ['babel', 'babel-flow', 'babel-ts', 'flow', 'typescript', 'espree', 'meriyah', 'acorn', 'css', 'less',
    'scss', 'json', 'json5', 'jsonc', 'json-stringify', 'graphql', 'markdown', 'mdx', 'vue', 'yaml', 'glimmer',
    'html', 'angular', 'lwc'],
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function sanitizeOptions(obj) {
  const out = {};
  if (!isPlainObject(obj)) return out;
  for (const key of BOOL) if (typeof obj[key] === 'boolean') out[key] = obj[key];
  for (const [key, [min, max]] of Object.entries(INT)) {
    const v = obj[key];
    if (Number.isInteger(v) && v >= min && v <= max) out[key] = v;
  }
  for (const [key, values] of Object.entries(ENUM)) if (values.includes(obj[key])) out[key] = obj[key];
  return out;
}

/** YAML mínimo: "chave: valor" por linha (escalares), comentários com #. */
function parseSimpleYaml(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#') || raw.trim() === '---') continue;
    const m = raw.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m || /^\s/.test(raw)) throw new Error('YAML com estrutura não suportada');
    let value = m[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const q = value[0];
      const end = value.indexOf(q, 1);
      if (end === -1) throw new Error('YAML com aspas sem fechar');
      value = value.slice(1, end);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
      if (value === '' || value === '|' || value === '>' || value.startsWith('[') || value.startsWith('{')) {
        throw new Error('YAML com estrutura não suportada');
      }
      if (value === 'true' || value === 'false') value = value === 'true';
      else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    }
    out[m[1]] = value;
  }
  return out;
}

function readSmall(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) return null;
  if (st.size > MAX_CONFIG_BYTES) throw new Error('arquivo grande demais');
  return fs.readFileSync(file, 'utf8');
}

function exists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

const codeWarning = (name) => `Configuração do Prettier ignorada: ${name} é código e o Agzos Formatador nunca executa código do projeto. Use .prettierrc ou .prettierrc.json.`;

/** Lê uma pasta. → resultado (achou algo) ou null (nada aqui, continue subindo). */
function readDir(dir) {
  for (const cand of CANDIDATES) {
    const file = path.join(dir, cand.name);
    if (!exists(file)) continue;
    if (cand.kind === 'code') {
      return { config: null, ignored: file, warning: codeWarning(cand.name) };
    }
    if (cand.kind === 'unsupported') {
      return { config: null, ignored: file, warning: `Configuração do Prettier ignorada: o formato de ${cand.name} não é suportado. Use .prettierrc ou .prettierrc.json.` };
    }
    let text;
    try {
      text = readSmall(file);
    } catch (e) {
      return { config: null, ignored: file, warning: `Configuração do Prettier ignorada (${cand.name}): ${e.message}.` };
    }
    if (text === null) continue;
    try {
      if (cand.kind === 'package') {
        const pkg = JSON.parse(text);
        if (!isPlainObject(pkg) || pkg.prettier === undefined) continue;
        if (typeof pkg.prettier === 'string') {
          return { config: null, ignored: file, warning: `Configuração do Prettier ignorada: "${pkg.prettier}" é uma config compartilhada (pacote), que exigiria executar código. Copie as opções para .prettierrc.` };
        }
        if (!isPlainObject(pkg.prettier)) throw new Error('"prettier" precisa ser um objeto');
        return { config: pkg.prettier, file };
      }
      if (cand.kind === 'json') return { config: JSON.parse(text), file };
      if (cand.kind === 'yaml') return { config: parseSimpleYaml(text), file };
      // .prettierrc: JSON ou YAML.
      try {
        return { config: JSON.parse(text), file };
      } catch {
        if (/^\s*[{[]/.test(text)) throw new Error('JSON inválido');
        return { config: parseSimpleYaml(text), file };
      }
    } catch (e) {
      return { config: null, ignored: file, warning: `Configuração do Prettier inválida em ${cand.name}: ${e.message}.` };
    }
  }
  return null;
}

function readPrettierConfig(dir, { root } = {}) {
  let current = path.resolve(dir);
  const stop = root ? path.resolve(root) : current;
  const rel = path.relative(stop, current);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { config: null };
  for (;;) {
    const found = readDir(current);
    if (found) {
      if (found.config !== null && !isPlainObject(found.config)) {
        return { config: null, ignored: found.file, warning: 'Configuração do Prettier inválida: precisa ser um objeto.' };
      }
      return found;
    }
    if (current === stop) return { config: null };
    const parent = path.dirname(current);
    if (parent === current) return { config: null };
    current = parent;
  }
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
      i = end;
    } else re += ch.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(patterns, relPath) {
  const list = (Array.isArray(patterns) ? patterns : [patterns]).filter((p) => typeof p === 'string' && p);
  const base = relPath.split('/').pop();
  return list.some((p) => {
    const re = globToRegExp(p.replace(/^\.\//, ''));
    return p.includes('/') ? re.test(relPath) : re.test(base) || re.test(relPath);
  });
}

function optionsForFile(config, filePath, configDir) {
  if (!isPlainObject(config)) return {};
  const out = sanitizeOptions(config);
  if (!Array.isArray(config.overrides) || !filePath) return out;
  const rel = path.relative(configDir || path.dirname(filePath), filePath).split(path.sep).join('/');
  for (const ov of config.overrides) {
    if (!isPlainObject(ov) || !matchesAny(ov.files, rel)) continue;
    if (ov.excludeFiles && matchesAny(ov.excludeFiles, rel)) continue;
    Object.assign(out, sanitizeOptions(ov.options));
  }
  return out;
}

module.exports = { readPrettierConfig, sanitizeOptions, optionsForFile, parseSimpleYaml, CANDIDATES };
