const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const load = () => import(pathToFileURL(path.join(__dirname, '../../src/renderer/scripts/snippets-utils.js')).href);

test('buildPreviewDoc: CSP restrita com nonce; Tailwind só com o nonce', async () => {
  const { buildPreviewDoc } = await load();
  const doc = buildPreviewDoc({ body: '<p>oi</p>', tailwind: 'TW()', nonce: 'abc123abc123abc123', background: '#0E0E0E' });
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(doc)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-abc123abc123abc123'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  assert.match(csp, /form-action 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(doc, /<script nonce="abc123abc123abc123">TW\(\)<\/script>/);
  assert.match(doc, /<body><p>oi<\/p><\/body>/);
  assert.match(doc, /background:\s*#0E0E0E/);
});

test('buildPreviewDoc: fundo inválido não injeta CSS', async () => {
  const { buildPreviewDoc } = await load();
  const doc = buildPreviewDoc({ body: '', tailwind: '', nonce: 'nnnnnnnnnnnnnnnnnn', background: 'red;}</style><script>x()</script>' });
  assert.doesNotMatch(doc, /<script>x\(\)/);
  assert.match(doc, /background:\s*transparent/);
});

test('buildPreviewDoc: nonce inválido é recusado', async () => {
  const { buildPreviewDoc } = await load();
  assert.throws(() => buildPreviewDoc({ body: '', tailwind: '', nonce: '" onload="x' }), /nonce/);
});

test('makeNonce: aleatório, base64url, 22+ caracteres', async () => {
  const { makeNonce } = await load();
  const a = makeNonce();
  assert.match(a, /^[A-Za-z0-9_-]{22,}$/);
  assert.notEqual(a, makeNonce());
});

test('indentFollowingLines: indenta a partir da 2ª linha, linhas vazias ficam vazias', async () => {
  const { indentFollowingLines } = await load();
  assert.equal(indentFollowingLines('<a>\n  <b/>\n\n</a>', '  '), '<a>\n    <b/>\n\n  </a>');
  assert.equal(indentFollowingLines('x\ny', ''), 'x\ny');
  assert.equal(indentFollowingLines('x\r\ny', '\t'), 'x\r\n\ty');
});

test('snippetLanguageForPath e isJsxPath', async () => {
  const { snippetLanguageForPath, isJsxPath } = await load();
  assert.equal(snippetLanguageForPath('/a/b.css'), 'css');
  assert.equal(snippetLanguageForPath('/a/b.scss'), 'css');
  assert.equal(snippetLanguageForPath('/a/App.tsx'), 'jsx');
  assert.equal(snippetLanguageForPath('/a/x.jsx'), 'jsx');
  assert.equal(snippetLanguageForPath('/a/index.html'), 'html');
  assert.equal(snippetLanguageForPath('/a/x.vue'), 'html');
  assert.equal(snippetLanguageForPath(null), 'html');
  assert.equal(isJsxPath('C:\\a\\B.TSX'), true);
  assert.equal(isJsxPath('/a/b.ts'), false);
});

test('isPreviewable: só html/tailwind viram miniatura', async () => {
  const { isPreviewable } = await load();
  assert.equal(isPreviewable('html'), true);
  assert.equal(isPreviewable('tailwind'), true);
  assert.equal(isPreviewable('css'), false);
  assert.equal(isPreviewable('jsx'), false);
});
