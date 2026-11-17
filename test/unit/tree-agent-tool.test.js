const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createToolbox } = require('../../src/main/agent/tools');
const { getModuleTools } = require('../../src/main/modules/agent-tools');
const { DEFAULT_SETTINGS } = require('../../src/main/lib/settings');

function mkRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-tree-tool-')));
  fs.mkdirSync(path.join(root, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'lib', 'x.js'), '');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), '');
  fs.mkdirSync(path.join(root, 'node_modules', 'p'), { recursive: true });
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  return root;
}

const tool = (s = DEFAULT_SETTINGS) => getModuleTools(s).find((t) => t.definition.name === 'project_tree');

test('project_tree: ferramenta read registrada só com o módulo habilitado', () => {
  const t = tool();
  assert.ok(t);
  assert.equal(t.kind, 'read');
  assert.deepEqual(Object.keys(t.definition.input_schema.properties).sort(), ['depth', 'path']);
  assert.equal(tool({ modules: { tree: { enabled: false } } }), undefined);
});

test('project_tree: devolve a árvore respeitando .gitignore e a profundidade', async () => {
  const root = mkRoot();
  try {
    const box = createToolbox({ root, checkpoint: null, extraTools: [tool()] });
    const p = await box.prepare('project_tree', { path: '.', depth: 1 });
    assert.equal(p.category, 'read');
    const r = await p.execute({});
    assert.ok(r.ok);
    assert.equal(r.result, `${path.basename(root)}/\n└── src/`);
    const deep = await (await box.prepare('project_tree', { path: 'src' })).execute({});
    assert.equal(deep.result, 'src/\n├── lib/\n│   └── x.js\n└── a.js');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('project_tree: caminho fora da raiz é negado', async () => {
  const root = mkRoot();
  try {
    const box = createToolbox({ root, checkpoint: null, extraTools: [tool()] });
    assert.throws(() => box.prepare('project_tree', { path: '..' }), /Acesso negado/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
