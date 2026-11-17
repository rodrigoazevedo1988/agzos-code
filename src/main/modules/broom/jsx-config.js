/**
 * Vassoura — fábrica JSX configurada no tsconfig.json/jsconfig.json mais próximo
 * (roda dentro do worker dos módulos, junto com analyze.js).
 *
 * jsxFactoryNames(fileName) → string[] com o identificador-raiz de `jsxFactory` e
 * `jsxFragmentFactory` (ex.: "preact.h" → "preact"). Sobe a partir da pasta do
 * arquivo até achar um tsconfig.json/jsconfig.json (ou a raiz do disco / uma pasta
 * com .git). Segue `extends` relativo. Cache por pasta durante a vida do worker.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];
const MAX_EXTENDS = 5;
const cache = new Map(); // pasta → string[]

function readJson(file) {
  try {
    const { config } = ts.parseConfigFileTextToJson(file, fs.readFileSync(file, 'utf8'));
    return config && typeof config === 'object' ? config : null;
  } catch {
    return null;
  }
}

/** compilerOptions efetivas de jsxFactory/jsxFragmentFactory (com extends relativo). */
function jsxOptions(file) {
  const out = {};
  let current = file;
  for (let depth = 0; current && depth <= MAX_EXTENDS; depth++) {
    const cfg = readJson(current);
    if (!cfg) break;
    const co = cfg.compilerOptions || {};
    for (const k of ['jsxFactory', 'jsxFragmentFactory']) {
      if (out[k] === undefined && typeof co[k] === 'string') out[k] = co[k];
    }
    const ext = typeof cfg.extends === 'string' && cfg.extends.startsWith('.') ? cfg.extends : null;
    if (!ext) break;
    let next = path.resolve(path.dirname(current), ext);
    if (!next.endsWith('.json') && !fs.existsSync(next)) next += '.json';
    current = next;
  }
  return out;
}

function rootIdentifier(value) {
  const m = /^\s*([A-Za-z_$][\w$]*)/.exec(String(value || ''));
  return m ? m[1] : null;
}

function namesForDir(dir) {
  if (cache.has(dir)) return cache.get(dir);
  let names = [];
  const config = CONFIG_NAMES.map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  if (config) {
    const o = jsxOptions(config);
    names = [o.jsxFactory, o.jsxFragmentFactory].map(rootIdentifier).filter(Boolean);
  } else {
    const parent = path.dirname(dir);
    if (parent !== dir && !fs.existsSync(path.join(dir, '.git'))) names = namesForDir(parent);
  }
  cache.set(dir, names);
  return names;
}

function jsxFactoryNames(fileName) {
  if (typeof fileName !== 'string' || !path.isAbsolute(fileName)) return [];
  try {
    return namesForDir(path.dirname(fileName));
  } catch {
    return [];
  }
}

module.exports = { jsxFactoryNames, clearJsxConfigCache: () => cache.clear() };
