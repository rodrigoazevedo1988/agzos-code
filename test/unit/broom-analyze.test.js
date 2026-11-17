const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { analyze, DEFAULT_OPTIONS } = require('../../src/main/modules/broom/analyze');
const { applyEdits } = require('../../src/main/modules/broom/apply');

const FIXTURES = path.join(__dirname, 'fixtures', 'broom');

function clean(text, opts = {}) {
  const r = analyze(text, { fileName: 'a.ts', ...opts });
  assert.equal(r.error, undefined, r.error);
  return applyEdits(text, r.edits);
}
const only = (rule) => ({ rules: { console: false, comments: false, unusedImports: false, deadCode: false, [rule]: true } });
const rulesOf = (r) => r.edits.map((e) => e.rule).sort();

function parseErrors(text, fileName) {
  const kind = { '.tsx': ts.ScriptKind.TSX, '.jsx': ts.ScriptKind.JSX, '.ts': ts.ScriptKind.TS }[path.extname(fileName)] || ts.ScriptKind.JS;
  const sf = ts.createSourceFile(fileName, text.replace(/^\uFEFF/, ''), ts.ScriptTarget.Latest, true, kind);
  return sf.parseDiagnostics.length;
}

// ------------------------------------------------------------------ console
test('console: remove a instrução e a linha inteira', () => {
  assert.equal(clean('const a = 1;\nconsole.log(a);\nfoo();\n', only('console')), 'const a = 1;\nfoo();\n');
  assert.equal(clean('function f() {\n  console.debug("x");\n  return 1;\n}\n', only('console')), 'function f() {\n  return 1;\n}\n');
});

test('console: console.log?.() e console.table também saem', () => {
  assert.equal(clean('console.log?.(1);\nconsole.table([]);\nx();\n', only('console')), 'x();\n');
});

test('console: "console.log(1)" em string e template fica intacto', () => {
  const src = 'const s = "console.log(1)";\nconst t = `console.log(2) ${a}`;\n';
  assert.equal(analyze(src, { fileName: 'a.js', ...only('console') }).edits.length, 0);
});

test('console: `${console.log(x)}` e console como valor ficam intactos', () => {
  const src = 'const t = `${console.log(x)}`;\nconst v = a && console.log(x);\nfoo(console.log(1));\nconst g = () => console.log(2);\nfunction h() { return console.log(3); }\n';
  assert.equal(analyze(src, { fileName: 'a.js', ...only('console') }).edits.length, 0);
});

test('console: error e warn mantidos por padrão; keepConsole configurável', () => {
  const src = 'console.error(1);\nconsole.warn(2);\nconsole.log(3);\n';
  assert.equal(clean(src, only('console')), 'console.error(1);\nconsole.warn(2);\n');
  assert.equal(clean(src, { ...only('console'), keepConsole: ['log'] }), 'console.log(3);\n');
});

test('console: corpo de if sem chaves não é removido (mudaria a semântica)', () => {
  const src = 'if (x) console.log(1);\nfoo();\n';
  assert.equal(analyze(src, { fileName: 'a.js', ...only('console') }).edits.length, 0);
});

test('console: instrução no meio da linha sai sem levar o resto', () => {
  assert.equal(clean('a(); console.log(1); b();\n', only('console')), 'a(); b();\n');
  assert.equal(clean('a(); console.log(1);\n', only('console')), 'a();\n');
});

// ----------------------------------------------------------------- comments
test('comments: remove // e /* */ comuns, linha inteira ou fim de linha', () => {
  const src = '// topo\nconst a = 1; // fim\n/* bloco\n   longo */\nconst b = 2;\n';
  assert.equal(clean(src, only('comments')), 'const a = 1;\nconst b = 2;\n');
});

test('comments: mantém @ts-ignore, licença, jsdoc e shebang', () => {
  const src = '#!/usr/bin/env node\n/*! license MIT */\n/* @license Apache */\n/** doc */\nfunction f() {}\n// @ts-ignore\nf();\n// eslint-disable-next-line\nf();\n/// <reference types="node" />\n//# sourceMappingURL=a.js.map\n';
  assert.equal(analyze(src, { fileName: 'a.ts', ...only('comments') }).edits.length, 0);
});

test('comments: keepComments vazio remove jsdoc mas não o shebang', () => {
  const src = '#!/usr/bin/env node\n/** doc */\nfunction f() {}\n';
  assert.equal(clean(src, { ...only('comments'), keepComments: [] }), '#!/usr/bin/env node\nfunction f() {}\n');
});

test('comments: "// não é comentário" em string e URL http:// intactos', () => {
  const src = 'const s = "// não é comentário";\nconst u = \'http://exemplo.com\';\nconst r = /\\/\\/x/;\n';
  assert.equal(analyze(src, { fileName: 'a.js', ...only('comments') }).edits.length, 0);
});

test('comments: {/* comentário */} no JSX sai junto com as chaves', () => {
  const src = 'const el = (\n  <div>\n    {/* comentário */}\n    <span>oi</span>\n  </div>\n);\n';
  assert.equal(clean(src, { fileName: 'a.tsx', ...only('comments') }), 'const el = (\n  <div>\n    <span>oi</span>\n  </div>\n);\n');
});

test('comments: texto JSX com // não é comentário', () => {
  const src = 'const el = <p>// texto /* também */</p>;\n';
  assert.equal(analyze(src, { fileName: 'a.jsx', ...only('comments') }).edits.length, 0);
});

test('comments: comentário entre tokens não os cola', () => {
  const out = clean('const a = b /* x */ + c;\nreturnValue/**/;\n', { fileName: 'a.js', ...only('comments') });
  assert.equal(parseErrors(out, 'a.js'), 0);
  assert.match(out, /const a = b \+ c;/);
});

// ----------------------------------------------------------- unusedImports
test('imports: default/named/namespace não usados saem; usados ficam', () => {
  const src = "import a from 'a';\nimport { b, c } from 'b';\nimport * as ns from 'ns';\nimport d from 'd';\nd(c);\n";
  assert.equal(clean(src, only('unusedImports')), "import { c } from 'b';\nimport d from 'd';\nd(c);\n");
});

test('imports: type-only e uso só em tipo conta', () => {
  const src = "import type { T, U } from 't';\nimport { V } from 'v';\nlet x: T;\nfunction f(y: V) {}\n";
  assert.equal(clean(src, only('unusedImports')), "import type { T } from 't';\nimport { V } from 'v';\nlet x: T;\nfunction f(y: V) {}\n");
});

test('imports: uso em JSX conta; a.Nome e chave de objeto não contam', () => {
  const src = "import { Botao } from './b';\nimport { Nome } from './n';\nimport { Chave } from './c';\nconst x = <Botao />;\nconst y = a.Nome;\nconst z = { Chave: 1 };\n";
  assert.equal(clean(src, { fileName: 'a.tsx', ...only('unusedImports') }), "import { Botao } from './b';\nconst x = <Botao />;\nconst y = a.Nome;\nconst z = { Chave: 1 };\n");
});

test('imports: shorthand e export { X } contam como uso', () => {
  const src = "import { a } from 'a';\nimport { b } from 'b';\nconst o = { a };\nexport { b };\n";
  assert.equal(analyze(src, { fileName: 'a.ts', ...only('unusedImports') }).edits.length, 0);
});

test('imports: efeito colateral mantido; React mantido com JSX', () => {
  const src = "import './estilo.css';\nimport React from 'react';\nexport const el = <div />;\n";
  assert.equal(analyze(src, { fileName: 'a.jsx', ...only('unusedImports') }).edits.length, 0);
  assert.equal(clean("import React from 'react';\nexport const n = 1;\n", { fileName: 'a.jsx', ...only('unusedImports') }), 'export const n = 1;\n');
});

test('imports: remoção parcial de especificadores (início, meio, fim, multilinha)', () => {
  assert.equal(clean("import { a, b, c } from 'x';\nb();\n", only('unusedImports')), "import { b } from 'x';\nb();\n");
  assert.equal(clean("import { a, b, c } from 'x';\na(c);\n", only('unusedImports')), "import { a, c } from 'x';\na(c);\n");
  assert.equal(clean("import {\n  a,\n  b,\n  c,\n} from 'x';\na();\n", only('unusedImports')), "import {\n  a,\n} from 'x';\na();\n");
  assert.equal(clean("import D, { a } from 'x';\na();\n", only('unusedImports')), "import { a } from 'x';\na();\n");
  assert.equal(clean("import D, { a } from 'x';\nD();\n", only('unusedImports')), "import D from 'x';\nD();\n");
  assert.equal(clean("import D, * as ns from 'x';\nD();\n", only('unusedImports')), "import D from 'x';\nD();\n");
});

test('imports: uso só dentro de código removido não conta (idempotência)', () => {
  const src = "import dbg from 'dbg';\nconsole.log(dbg);\nexport const n = 1;\n";
  assert.equal(clean(src), 'export const n = 1;\n');
});

test('imports: uso em JSDoc conta', () => {
  const src = "import { Tipo } from './t';\n/** @param {Tipo} x */\nexport function f(x) {}\n";
  assert.equal(analyze(src, { fileName: 'a.js', ...only('unusedImports') }).edits.length, 0);
});

// ----------------------------------------------------------------- deadCode
test('deadCode: instruções após return/throw saem; function hoisted fica', () => {
  const src = 'function f() {\n  return 1;\n  foo();\n  function g() {}\n  bar();\n}\nfunction h() {\n  throw new Error();\n  baz();\n}\n';
  assert.equal(clean(src, only('deadCode')), 'function f() {\n  return 1;\n  function g() {}\n}\nfunction h() {\n  throw new Error();\n}\n');
});

test('deadCode: após break/continue no case e no laço', () => {
  const src = 'switch (x) {\n  case 1:\n    a();\n    break;\n    b();\n  default:\n    c();\n}\nfor (;;) {\n  continue;\n  d();\n}\n';
  assert.equal(clean(src, only('deadCode')), 'switch (x) {\n  case 1:\n    a();\n    break;\n  default:\n    c();\n}\nfor (;;) {\n  continue;\n}\n');
});

test('deadCode: if (false) sem else some; com else fica só o conteúdo do else', () => {
  assert.equal(clean('a();\nif (false) {\n  b();\n}\nc();\n', only('deadCode')), 'a();\nc();\n');
  assert.equal(clean('if (0) {\n  b();\n} else {\n  c();\n  d();\n}\n', only('deadCode')), '  c();\n  d();\n');
  assert.equal(clean('if (false) b(); else c();\n', only('deadCode')), 'c();\n');
  assert.equal(clean('if (false) { b(); } else { c(); }\n', only('deadCode')), 'c();\n');
});

test('deadCode: só literais (if (DEBUG) e if (!true) intactos)', () => {
  const src = 'if (DEBUG) { a(); }\nif (!true) { b(); }\nif (false === x) { c(); }\n';
  assert.equal(analyze(src, { fileName: 'a.js', ...only('deadCode') }).edits.length, 0);
});

test('deadCode + console: console dentro do else continua sendo removido', () => {
  const src = 'if (0) {\n  a();\n} else {\n  console.info(1);\n  b();\n}\n';
  const out = clean(src);
  assert.equal(out, '  b();\n');
  assert.equal(analyze(out, { fileName: 'a.ts' }).edits.length, 0);
});

// ----------------------------------------------------------------- formato
test('CRLF: remover linha inteira consome \\r\\n', () => {
  const src = 'const a = 1;\r\nconsole.log(a);\r\n// c\r\nfoo();\r\n';
  assert.equal(clean(src), 'const a = 1;\r\nfoo();\r\n');
});

test('BOM preservado', () => {
  const src = '\uFEFFconsole.log(1);\nfoo();\n';
  assert.equal(clean(src), '\uFEFFfoo();\n');
  const src2 = '\uFEFF// c\nfoo();\n';
  assert.equal(clean(src2), '\uFEFFfoo();\n');
});

test('.vue/.css → edits []', () => {
  assert.deepEqual(analyze('console.log(1);', { fileName: 'a.vue' }), { edits: [] });
  assert.deepEqual(analyze('/* x */ a {}', { fileName: 'a.css' }), { edits: [] });
});

test('erro de sintaxe → edits [] e error', () => {
  const r = analyze('console.log(1);\nfunction (', { fileName: 'a.js' });
  assert.deepEqual(r.edits, []);
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.length > 0);
});

test('edit tem id, rule, line e preview', () => {
  const r = analyze('const a = 1;\nconsole.log(a);\n', { fileName: 'a.js' });
  assert.equal(r.edits.length, 1);
  const [e] = r.edits;
  assert.equal(e.rule, 'console');
  assert.equal(e.line, 2);
  assert.equal(e.id, `console:${e.start}`);
  assert.equal(e.preview, 'console.log(a);');
});

test('opções padrão exportadas', () => {
  assert.deepEqual(DEFAULT_OPTIONS.keepConsole, ['error', 'warn']);
  assert.deepEqual(DEFAULT_OPTIONS.keepComments, ['jsdoc', 'directives', 'license']);
});

// ----------------------------------------------------------------- fixtures
const fixtures = fs.readdirSync(FIXTURES).filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f));

test('fixtures: limpas fazem parse sem erro e segunda análise → 0 edits', () => {
  assert.ok(fixtures.length >= 3);
  for (const name of fixtures) {
    const src = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
    for (const variant of [src, src.replace(/\n/g, '\r\n'), `\uFEFF${src}`]) {
      const r = analyze(variant, { fileName: name });
      assert.equal(r.error, undefined, `${name}: ${r.error}`);
      assert.ok(r.edits.length > 0, name);
      const out = applyEdits(variant, r.edits);
      assert.equal(parseErrors(out, name), 0, `${name} não faz parse:\n${out}`);
      const again = analyze(out, { fileName: name });
      assert.deepEqual(again.edits.map((e) => `${e.rule}@${e.line}: ${e.preview}`), [], `${name} não idempotente`);
      if (variant.startsWith('\uFEFF')) assert.ok(out.startsWith('\uFEFF'));
      if (variant.includes('\r\n')) assert.ok(!/[^\r]\n/.test(out), `${name}: LF solto em CRLF`);
    }
  }
});

test('fixture component.tsx: resultado esperado', () => {
  const src = fs.readFileSync(path.join(FIXTURES, 'component.tsx'), 'utf8');
  const r = analyze(src, { fileName: 'component.tsx' });
  const out = applyEdits(src, r.edits);
  assert.match(out, /^\/\*! Agzos UI/);
  assert.match(out, /import React, \{ useState \} from 'react';/);
  assert.match(out, /import type \{ Props \} from '.\/types';/);
  assert.doesNotMatch(out, /utils|Icon|estado local|rótulo|comentário dentro|console\.log|if \(false\)/);
  assert.match(out, /import '.\/styles.css';/);
  assert.match(out, /\/\*\* Componente principal. \*\//);
  assert.match(out, /console\.error\('nunca removido'\);/);
  assert.match(out, /<p>\/\/ isto é texto, não comentário<\/p>/);
  assert.match(out, /http:\/\/exemplo.com/);
  assert.deepEqual([...new Set(rulesOf(r))], ['comments', 'console', 'deadCode', 'unusedImports']);
});

test('fixture server.js: resultado esperado', () => {
  const src = fs.readFileSync(path.join(FIXTURES, 'server.js'), 'utf8');
  const out = applyEdits(src, analyze(src, { fileName: 'server.js' }).edits);
  assert.ok(out.startsWith("#!/usr/bin/env node\n/* eslint-disable */\n'use strict';\n// @ts-check\n"));
  assert.match(out, /"console.log\(1\) \/\/ não é comentário"/);
  assert.match(out, /`\$\{console.log\('x'\)\} e console.log\(2\)`/);
  assert.match(out, /req && console.log\('valor'\)/);
  assert.match(out, /function hoisted\(\) \{\}/);
  assert.doesNotMatch(out, /morto|bloco de comentário|console\.debug|console\.info|nunca|porta|if \(0\)/);
  assert.match(out, /http\.createServer\(handler\)\.listen\(3000\);\n$/);
});

test('fixture utils.ts: resultado esperado', () => {
  const src = fs.readFileSync(path.join(FIXTURES, 'utils.ts'), 'utf8');
  const out = applyEdits(src, analyze(src, { fileName: 'utils.ts' }).edits);
  assert.ok(out.startsWith("import { readFile } from 'fs/promises';\nimport type { Stats } from 'fs';\nimport { Config } from './config';\n"));
  assert.match(out, /\/\/ eslint-disable-next-line no-console/);
  assert.doesNotMatch(out, /helper'|path'|após throw/);
});

// ------------------------------------------------------------------- apply
test('applyEdits: ordem decrescente e sobreposição mantém o maior', () => {
  const text = '0123456789';
  assert.equal(applyEdits(text, [{ start: 1, end: 3 }, { start: 5, end: 7 }]), '034789');
  assert.equal(applyEdits(text, [{ start: 2, end: 4 }, { start: 1, end: 8 }]), '089');
  assert.equal(applyEdits(text, [{ start: 0, end: 10, keepStart: 3, keepEnd: 6 }, { start: 4, end: 5 }]), '35');
  assert.equal(applyEdits(text, []), text);
});
