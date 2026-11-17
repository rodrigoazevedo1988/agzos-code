// Agzos Formatador: leitura segura da configuração do Prettier do projeto.
// Nunca executa código do projeto: configs .js/.cjs/.mjs/.ts e configs compartilhadas
// (string no package.json) são ignoradas com aviso; plugins nunca passam.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPrettierConfig, sanitizeOptions, optionsForFile, parseSimpleYaml } = require('../../src/main/modules/formatter/config');

function tmp(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-prettier-cfg-')));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test('.prettierrc em JSON', () => {
  const dir = tmp({ '.prettierrc': '{ "semi": false, "singleQuote": true }' });
  const r = readPrettierConfig(dir);
  assert.deepEqual(r.config, { semi: false, singleQuote: true });
  assert.equal(r.file, path.join(dir, '.prettierrc'));
  assert.equal(r.ignored, undefined);
});

test('.prettierrc em YAML, .prettierrc.yaml e .yml', () => {
  assert.deepEqual(readPrettierConfig(tmp({ '.prettierrc': 'semi: false\n# comentário\ntabWidth: 4\n' })).config, { semi: false, tabWidth: 4 });
  assert.deepEqual(readPrettierConfig(tmp({ '.prettierrc.yaml': "singleQuote: true\ntrailingComma: 'es5'\n" })).config, { singleQuote: true, trailingComma: 'es5' });
  assert.deepEqual(readPrettierConfig(tmp({ '.prettierrc.yml': 'printWidth: 100' })).config, { printWidth: 100 });
});

test('.prettierrc.json e "prettier" do package.json', () => {
  assert.deepEqual(readPrettierConfig(tmp({ '.prettierrc.json': '{"useTabs": true}' })).config, { useTabs: true });
  assert.deepEqual(readPrettierConfig(tmp({ 'package.json': '{"name":"x","prettier":{"semi":false}}' })).config, { semi: false });
  // package.json sem "prettier" não conta: segue procurando.
  assert.deepEqual(readPrettierConfig(tmp({ 'package.json': '{"name":"x"}', '.prettierrc.json': '{"semi":true}' })).config, { semi: true });
});

for (const name of ['.prettierrc.js', '.prettierrc.cjs', '.prettierrc.mjs', '.prettierrc.ts', 'prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs', 'prettier.config.ts']) {
  test(`${name} é ignorado com aviso (nenhum código do projeto executa)`, () => {
    const marker = path.join(os.tmpdir(), `agzos-prettier-pwned-${process.pid}-${name}`);
    const dir = tmp({ [name]: `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = { semi: false };` });
    const r = readPrettierConfig(dir);
    assert.equal(r.config, null);
    assert.equal(r.ignored, path.join(dir, name));
    assert.match(r.warning, /ignorad/i);
    assert.equal(fs.existsSync(marker), false);
  });
}

test('config compartilhada (string no package.json) é ignorada com aviso', () => {
  const r = readPrettierConfig(tmp({ 'package.json': '{"prettier":"@empresa/prettier-config"}' }));
  assert.equal(r.config, null);
  assert.match(r.warning, /compartilhada/i);
});

test('sobe pastas até a raiz e não passa dela', () => {
  const dir = tmp({ '.prettierrc': '{"semi":false}', 'proj/src/a.js': '' });
  assert.deepEqual(readPrettierConfig(path.join(dir, 'proj/src'), { root: dir }).config, { semi: false });
  assert.equal(readPrettierConfig(path.join(dir, 'proj/src'), { root: path.join(dir, 'proj') }).config, null);
  // Sem root: só a própria pasta.
  assert.equal(readPrettierConfig(path.join(dir, 'proj/src')).config, null);
});

test('JSON inválido → sem config, com aviso', () => {
  const r = readPrettierConfig(tmp({ '.prettierrc.json': '{ semi: ' }));
  assert.equal(r.config, null);
  assert.match(r.warning, /inválid/i);
});

test('sanitizeOptions: só opções conhecidas com tipo certo; plugins nunca passam', () => {
  assert.deepEqual(sanitizeOptions({
    semi: false, tabWidth: '4', printWidth: 120, plugins: ['./evil.js'], pluginSearchDirs: ['.'], parser: 'babel',
    trailingComma: 'all', foo: 1, singleQuote: 'sim', endOfLine: 'crlf', filepath: '/etc/passwd',
  }), { semi: false, printWidth: 120, parser: 'babel', trailingComma: 'all', endOfLine: 'crlf' });
  assert.deepEqual(sanitizeOptions({ trailingComma: 'qualquer' }), {});
  assert.deepEqual(sanitizeOptions(null), {});
});

test('optionsForFile aplica overrides por glob e remove plugins dos overrides', () => {
  const cfg = {
    semi: true,
    overrides: [
      { files: '*.md', options: { proseWrap: 'always' } },
      { files: ['src/**/*.ts'], excludeFiles: 'src/gen/**', options: { semi: false, plugins: ['x'] } },
    ],
  };
  assert.deepEqual(optionsForFile(cfg, '/p/docs/a.md', '/p'), { semi: true, proseWrap: 'always' });
  assert.deepEqual(optionsForFile(cfg, '/p/src/deep/a.ts', '/p'), { semi: false });
  assert.deepEqual(optionsForFile(cfg, '/p/src/gen/a.ts', '/p'), { semi: true });
  assert.deepEqual(optionsForFile(null, '/p/a.js', '/p'), {});
});

test('parseSimpleYaml: chave: valor; estruturas aninhadas são recusadas', () => {
  assert.deepEqual(parseSimpleYaml('a: 1\nb: "x # y"\nc: off-text # comentário\nd: false\n'), { a: 1, b: 'x # y', c: 'off-text', d: false });
  assert.throws(() => parseSimpleYaml('overrides:\n  - files: "*.md"'));
});

test('optionsForFile: overrides.files patológico não congela (ReDoS) e inválido é ignorado', () => {
  const cfg = {
    overrides: [
      { files: '**a**a**a**a**a**a**a**b', options: { semi: false } },
      { files: ['[z-a]', '*.{js,ts}'], options: { tabWidth: 4 } },
    ],
  };
  const t0 = process.hrtime.bigint();
  assert.deepEqual(optionsForFile(cfg, `/p/${'a'.repeat(1000)}`, '/p'), {});
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 50);
  assert.deepEqual(optionsForFile(cfg, '/p/src/x.ts', '/p'), { tabWidth: 4 });
});
