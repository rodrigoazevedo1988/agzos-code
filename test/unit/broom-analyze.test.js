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

// ------------------------------------------------- correções da revisão (1.1.0)
const vm = require('node:vm');
const os = require('node:os');

/** Executa JS (sloppy) num contexto novo e devolve o valor de `expr`. */
function runJs(code, expr) {
  return JSON.stringify(vm.runInNewContext(`${code}\n;(${expr})`, {}));
}

/** Limpa e confere: faz parse e mantém o resultado de `expr` (JS). */
function sameBehavior(src, expr, opts = only('deadCode')) {
  const out = clean(src, { fileName: 'a.js', ...opts });
  assert.equal(parseErrors(out, 'a.js'), 0, out);
  assert.deepEqual(runJs(out, expr), runJs(src, expr), out);
  return out;
}

test('deadCode: var após return é preservado (içamento)', () => {
  const out = sameBehavior('function f() {\n  x = 5;\n  return x;\n  var x;\n}\n', '[f(), typeof x]');
  assert.match(out, /var x;/);
});

test('deadCode: var usado por função içada após return é preservado', () => {
  const src = 'function f() {\n  return h();\n  function h() { return v; }\n  var v = 1;\n}\n';
  const out = clean(src, { fileName: 'a.js', ...only('deadCode') });
  assert.match(out, /var v/);
  assert.equal(runJs(out, 'f()'), undefined);
});

test('deadCode: var aninhado em bloco/laço morto é preservado', () => {
  const src = 'function f() {\n  y = 2;\n  return y;\n  for (var i = 0; i < 1; i++) { var y; }\n  if (a) { var z; }\n}\n';
  sameBehavior(src, '[f(), typeof y]');
});

test('deadCode: type/interface/enum/declare/namespace/class após return ficam (TS)', () => {
  const src = 'function f(): X {\n  return 1;\n  type X = number;\n  interface I {}\n  enum E { A }\n  declare const d: number;\n  namespace N {}\n  class C {}\n  foo();\n}\n';
  const out = clean(src, only('deadCode'));
  assert.equal(out, 'function f(): X {\n  return 1;\n  type X = number;\n  interface I {}\n  enum E { A }\n  declare const d: number;\n  namespace N {}\n  class C {}\n}\n');
});

test('deadCode: let/const após return ficam (escopo de bloco/TDZ)', () => {
  const src = 'function f() {\n  return () => x;\n  let x = 1;\n  const y = 2;\n}\n';
  assert.equal(analyze(src, { fileName: 'a.ts', ...only('deadCode') }).edits.length, 0);
});

test('deadCode: if (0) com var/function dentro não é removido', () => {
  sameBehavior('if (0) { var v = 2; }\nvar r = typeof v;\n', '[r, typeof v]');
  sameBehavior('if (false) {\n  for (var k in o) {}\n}\nvar r = typeof k;\n', 'r');
  assert.equal(analyze('if (0) { function g() {} }\n', { fileName: 'a.js', ...only('deadCode') }).edits.length, 0);
  // Função aninhada com var próprio não impede a remoção.
  assert.equal(clean('if (0) { const g = function () { var q; }; }\nfoo();\n', only('deadCode')), 'foo();\n');
});

test('deadCode: else com let/const/function mantém as chaves (sem colisão de escopo)', () => {
  const src = 'let a = 1;\nif (0) {\n  b();\n} else {\n  let a = 2;\n  c(a);\n}\n';
  const out = clean(src, only('deadCode'));
  assert.equal(parseErrors(out, 'a.ts'), 0);
  assert.match(out, /\{\s*let a = 2;\s*c\(a\);\s*\}/);
  assert.equal(analyze(out, { fileName: 'a.ts', ...only('deadCode') }).edits.length, 0);
});

test('imports: fábrica JSX h (Stencil/Preact) mantida em .tsx', () => {
  const src = "import { Component, h } from '@stencil/core';\n@Component({})\nexport class X {\n  render() { return <div />; }\n}\n";
  assert.equal(analyze(src, { fileName: 'a.tsx', ...only('unusedImports') }).edits.length, 0);
  for (const name of ['createElement', 'Fragment', 'jsx', 'jsxs', 'jsxDEV']) {
    const s = `import { ${name} } from 'x';\nexport const el = <div />;\n`;
    assert.equal(analyze(s, { fileName: 'a.jsx', ...only('unusedImports') }).edits.length, 0, name);
  }
  // Sem JSX, h não usado sai.
  assert.equal(clean("import { h } from 'preact';\nexport const n = 1;\n", { fileName: 'a.tsx', ...only('unusedImports') }), 'export const n = 1;\n');
});

test('imports: pragmas @jsx/@jsxFrag em //, /* */ e /** */ mantêm o identificador', () => {
  for (const pragma of ['// @jsx mk\n// @jsxFrag Fr\n', '/* @jsx mk */\n/* @jsxFrag Fr */\n', '/** @jsx mk @jsxFrag Fr */\n']) {
    const src = `${pragma}import { mk, Fr, outro } from 'lib';\nexport const el = <><div /></>;\n`;
    const out = clean(src, { fileName: 'a.jsx' });
    assert.match(out, /import \{ mk, Fr \} from 'lib';/, out);
  }
});

test('imports: jsxFactory/jsxFragmentFactory do tsconfig.json mais próximo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'broom-tsconfig-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tsconfig.base.json'), '{ "compilerOptions": { "jsxFragmentFactory": "Frag" } }');
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{\n  // comentário\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "jsx": "react", "jsxFactory": "preact.h", },\n}\n');
    const file = path.join(dir, 'src', 'ui', 'a.tsx');
    const src = "import * as preact from 'preact';\nimport { Frag } from 'preact';\nimport { nada } from 'x';\nexport const el = <><div /></>;\n";
    const out = clean(src, { fileName: file, ...only('unusedImports') });
    assert.equal(out, "import * as preact from 'preact';\nimport { Frag } from 'preact';\nexport const el = <><div /></>;\n");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('console: argumentos com efeito colateral não são removidos', () => {
  const impure = ['i++', '--i', 'await save()', 'x = 1', 'x += 1', 'fn()', 'new Foo()', 'a?.b()', 'delete o.k',
    'tag`x`', '`${f()}`', '...xs', '[g()]', '{ k: g() }', 'a || b()', 'c ? d() : e', '(x = 2)', 'class { static { f(); } }',
    'yieldy, f()', 'import("x")', 'a.b.c()'];
  for (const arg of impure) {
    const src = `async function w() {\n  console.log(${arg});\n}\n`;
    assert.equal(analyze(src, { fileName: 'a.js', ...only('console') }).edits.length, 0, arg);
  }
  const g = 'function* gen() {\n  console.log(yield 1);\n}\n';
  assert.equal(analyze(g, { fileName: 'a.js', ...only('console') }).edits.length, 0);
});

test('console: argumentos livres de efeito continuam removíveis', () => {
  const pure = ['1, "s", `t`, null, true, undefined', 'a, this, a.b, a?.b, a[0], a?.[k]', '`x ${a.b} y`',
    '!a, -b, +c, typeof d, void 0', 'a + b * c, a && b, a ?? b, a ? b : c', '[a, 1], { a, b: 2, [k]: 3, m() {} }',
    '() => f(), function () { g(); }', '/re/g, 10n', '(a as any), a!', 'import.meta'];
  for (const arg of pure) {
    const src = `console.log(${arg});\nfoo();\n`;
    assert.equal(clean(src, { fileName: 'a.ts', ...only('console') }), 'foo();\n', arg);
  }
});
