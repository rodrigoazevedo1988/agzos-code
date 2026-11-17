const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/mods/highlight-tags.js')).href);

const TAGS = ['!=#FF5252', '?=#4FC3F7', 'TODO=#FF9800', 'FIXME=#FF9800', '*=#98C379', '//=#7A7A7A'];
const brief = (ranges) => ranges.map((r) => [r.startLine, r.startColumn, r.endLine, r.endColumn, r.tag]);

test('parseTags lê "marcador=#cor" e descarta inválidos', async () => {
  const { parseTags, DEFAULT_TAGS } = await load();
  assert.deepEqual(parseTags(['TODO=#ff9800', 'sem-cor', '=#fff', 'X=vermelho', ' ! = #F00 ']), [
    { tag: 'TODO', color: '#ff9800', strike: false },
    { tag: '!', color: '#F00', strike: false },
  ]);
  assert.equal(parseTags(['//=#777'])[0].strike, true);
  assert.equal(parseTags(DEFAULT_TAGS).length, 6);
});

test('JavaScript: comentários de linha e bloco; ignora // dentro de strings', async () => {
  const { findTaggedComments } = await load();
  const text = [
    "const url = 'http://x'; // ! cuidado aqui",
    '// TODO: refatorar',
    '// comentário comum',
    '/* ? por que isso */ const a = 1;',
    '//// código antigo',
    'const s = "// TODO não é comentário";',
    '// todo minúsculo também',
  ].join('\n');
  assert.deepEqual(brief(findTaggedComments(text, 'javascript', TAGS)), [
    [1, 25, 1, 42, '!'],
    [2, 1, 2, 19, 'TODO'],
    [4, 1, 4, 21, '?'],
    [5, 1, 5, 19, '//'],
    [7, 1, 7, 25, 'TODO'],
  ]);
});

test('palavra-marcador exige separação (TODOS não é TODO)', async () => {
  const { findTaggedComments } = await load();
  assert.deepEqual(findTaggedComments('// TODOS os itens\n// TODO: x', 'typescript', TAGS).map((r) => r.startLine), [2]);
});

test('bloco multilinha: marcador no início destaca o bloco; linhas internas com marcador também', async () => {
  const { findTaggedComments } = await load();
  const text = '/**\n * ! não apague\n * normal\n */\n/* FIXME:\n  tudo */';
  assert.deepEqual(brief(findTaggedComments(text, 'javascript', TAGS)), [
    [2, 4, 2, 16, '!'],
    [5, 1, 6, 10, 'FIXME'],
  ]);
});

test('Python, Shell e YAML usam #; SQL usa --', async () => {
  const { findTaggedComments } = await load();
  assert.deepEqual(brief(findTaggedComments("x = '#'  # ! atenção\n", 'python', TAGS)), [[1, 10, 1, 21, '!']]);
  assert.deepEqual(brief(findTaggedComments('echo ${#arr}\n# ? ver isso', 'shell', TAGS)), [[2, 1, 2, 13, '?']]);
  assert.deepEqual(brief(findTaggedComments('a: 1 # * importante', 'yaml', TAGS)), [[1, 6, 1, 20, '*']]);
  assert.deepEqual(brief(findTaggedComments("SELECT '--' -- TODO índice", 'sql', TAGS)), [[1, 13, 1, 27, 'TODO']]);
});

test('HTML e Markdown usam <!-- -->; CSS usa /* */', async () => {
  const { findTaggedComments } = await load();
  assert.deepEqual(brief(findTaggedComments('<p>a</p><!-- ! remover -->', 'html', TAGS)), [[1, 9, 1, 27, '!']]);
  assert.deepEqual(brief(findTaggedComments('<!-- TODO -->\n// ! não', 'markdown', TAGS)), [[1, 1, 1, 14, 'TODO']]);
  assert.deepEqual(brief(findTaggedComments('a { color: red; } /* ? cor */\n// ! não', 'css', TAGS)), [[1, 19, 1, 30, '?']]);
  assert.deepEqual(brief(findTaggedComments('// ! sim', 'scss', TAGS)), [[1, 1, 1, 9, '!']]);
});

test('linguagem sem comentários conhecidos ou sem marcadores → vazio', async () => {
  const { findTaggedComments } = await load();
  assert.deepEqual(findTaggedComments('// ! x', 'plaintext', TAGS), []);
  assert.deepEqual(findTaggedComments('// ! x', 'javascript', []), []);
});
