const { test } = require('node:test');
const assert = require('node:assert/strict');

test('ICON_THEMES lista os temas disponíveis', async () => {
  const { ICON_THEMES } = await import('../../src/renderer/scripts/icon-theme.js');
  assert.ok(Array.isArray(ICON_THEMES));
  const ids = ICON_THEMES.map((t) => t.id);
  assert.ok(ids.includes('lucide-color'));
  assert.ok(ids.includes('lucide-minimal'));
  assert.ok(ids.includes('badges'));
  assert.ok(ids.includes('emoji'));
});

test('getFileIconMeta mapeia linguagens e arquivos especiais', async () => {
  const { getFileIconMeta } = await import('../../src/renderer/scripts/icon-theme.js');

  const js = getFileIconMeta('app.js');
  assert.equal(js.badge, 'JS');
  assert.equal(js.emoji, '🟨');

  const ts = getFileIconMeta('types.ts');
  assert.equal(ts.badge, 'TS');
  assert.equal(ts.emoji, '🟦');

  const html = getFileIconMeta('index.html');
  assert.equal(html.badge, 'HTML');
  assert.equal(html.icon, 'globe');

  const css = getFileIconMeta('styles.css');
  assert.equal(css.badge, 'CSS');
  assert.equal(css.icon, 'palette');

  const pkg = getFileIconMeta('package.json');
  assert.equal(pkg.badge, 'PKG');
  assert.equal(pkg.icon, 'package');

  const gitignore = getFileIconMeta('.gitignore');
  assert.equal(gitignore.badge, 'GIT');
  assert.equal(gitignore.icon, 'git-branch');

  const env = getFileIconMeta('.env.local');
  assert.equal(env.badge, 'ENV');
  assert.equal(env.icon, 'file-key');

  const fallback = getFileIconMeta('sample.customext');
  assert.equal(fallback.icon, 'file');
  assert.equal(fallback.emoji, '📄');
});

test('getFolderIconMeta trata estados de expansão e pastas especiais', async () => {
  const { getFolderIconMeta } = await import('../../src/renderer/scripts/icon-theme.js');

  const closed = getFolderIconMeta(false, 'components');
  assert.equal(closed.icon, 'folder');
  assert.equal(closed.emoji, '📁');

  const open = getFolderIconMeta(true, 'components');
  assert.equal(open.icon, 'folder-open');
  assert.equal(open.emoji, '📂');

  const git = getFolderIconMeta(false, '.git');
  assert.equal(git.icon, 'folder-git');

  const nodeModules = getFolderIconMeta(false, 'node_modules');
  assert.equal(nodeModules.icon, 'folder-code');
});
