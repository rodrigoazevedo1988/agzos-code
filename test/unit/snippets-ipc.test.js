const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const snippetsIpc = require('../../src/main/ipc/snippets');
const { getSnippetsRuntime } = require('../../src/main/modules/snippets/runtime');

let dir;
let settings;
function fakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    handle: (ch, fn) => handlers.set(ch, fn),
    call: (ch, ...args) => handlers.get(ch)({ sender: { id: 1 } }, ...args),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-snip-ipc-'));
  settings = { modules: { snippets: { enabled: true, variables: [{ name: 'cor_primaria', value: '#123456' }, { name: 'nome_marca', value: 'ACME' }] } } };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function setup(extra = {}) {
  const ipc = fakeIpc();
  const sent = [];
  const res = snippetsIpc.register(ipc, {
    userDataDir: dir,
    settingsStore: { load: () => settings },
    broadcast: (ch, payload) => sent.push([ch, payload]),
    ...extra,
  });
  return { ipc, sent, ...res };
}

test('ipc snippets: registra todos os canais', () => {
  const { ipc } = setup();
  for (const ch of snippetsIpc.CHANNELS) assert.ok(ipc.handlers.has(`snippets:${ch}`), ch);
  assert.deepEqual([...snippetsIpc.CHANNELS].sort(), [
    'duplicate', 'export', 'get', 'import', 'interpolate', 'list', 'remove', 'render', 'restoreDefaults', 'save', 'tailwind',
  ]);
});

test('ipc snippets: list devolve a biblioteca inicial e as categorias', async () => {
  const { ipc } = setup();
  const res = await ipc.call('snippets:list');
  assert.ok(res.snippets.length >= 20);
  assert.ok(res.categories.includes('Hero'));
  const filtered = await ipc.call('snippets:list', { category: 'FAQ' });
  assert.equal(filtered.snippets.length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'snippets.json')));
});

test('ipc snippets: save/get/duplicate/remove avisam as janelas', async () => {
  const { ipc, sent } = setup();
  const s = await ipc.call('snippets:save', { name: 'Meu', category: 'X', language: 'html', body: '<p class="a">{{nome_marca}}</p>' });
  assert.equal((await ipc.call('snippets:get', s.id)).name, 'Meu');
  const d = await ipc.call('snippets:duplicate', s.id);
  assert.equal(d.name, 'Meu (cópia)');
  assert.deepEqual(await ipc.call('snippets:remove', d.id), { removed: true });
  assert.ok(sent.filter(([ch]) => ch === 'snippets:changed').length >= 3);
});

test('ipc snippets: render interpola e converte para JSX quando pedido', async () => {
  const { ipc } = setup();
  const s = await ipc.call('snippets:save', { name: 'R', category: 'X', language: 'html', body: '<label class="c-[{{cor_primaria}}]" for="a">{{nome_marca}} {{x}}</label><br>' });
  assert.deepEqual(await ipc.call('snippets:render', s.id), { text: '<label class="c-[#123456]" for="a">ACME {{x}}</label><br>', language: 'html' });
  const jsx = await ipc.call('snippets:render', s.id, { jsx: true });
  // Variável desconhecida no texto JSX vira chaves escapadas (JSX válido).
  assert.equal(jsx.text, `<label className="c-[#123456]" htmlFor="a">ACME {'{'}{'{'}x{'}'}{'}'}</label><br />`);
  const css = await ipc.call('snippets:save', { name: 'C', category: 'X', language: 'css', body: '.a{color:{{cor_primaria}}}' });
  assert.equal((await ipc.call('snippets:render', css.id, { jsx: true })).text, '.a{color:#123456}');
  await assert.rejects(() => ipc.call('snippets:render', 'nao-existe'), /não encontrado/i);
});

test('ipc snippets: interpolate usa as variáveis atuais das settings', async () => {
  const { ipc } = setup();
  assert.equal(await ipc.call('snippets:interpolate', '{{nome_marca}}'), 'ACME');
  settings.modules.snippets.variables = [{ name: 'nome_marca', value: 'Outra' }];
  assert.equal(await ipc.call('snippets:interpolate', '{{nome_marca}}'), 'Outra');
  assert.equal(await ipc.call('snippets:interpolate', 42), '');
});

test('ipc snippets: restoreDefaults', async () => {
  const { ipc } = setup();
  await ipc.call('snippets:remove', 'faq-details');
  assert.equal(await ipc.call('snippets:get', 'faq-details'), null);
  const r = await ipc.call('snippets:restoreDefaults');
  assert.ok(r.restored >= 20);
  assert.ok(await ipc.call('snippets:get', 'faq-details'));
});

test('ipc snippets: import de texto e por diálogo; export por diálogo (arquivo 0600)', async () => {
  const exportPath = path.join(dir, 'saida.json');
  const importPath = path.join(dir, 'entrada.json');
  fs.writeFileSync(importPath, JSON.stringify([{ name: 'Do arquivo', category: 'Y', language: 'css', body: 'a{}' }]));
  const dialog = {
    showOpenDialog: async () => ({ canceled: false, filePaths: [importPath] }),
    showSaveDialog: async () => ({ canceled: false, filePath: exportPath }),
  };
  const { ipc } = setup({ dialog });
  assert.deepEqual(await ipc.call('snippets:import', JSON.stringify({ snippets: [{ name: 'T', category: 'Y', language: 'html', body: '' }] })),
    { added: 1, updated: 0, skipped: 0 });
  assert.deepEqual(await ipc.call('snippets:import'), { added: 1, updated: 0, skipped: 0 });
  const ex = await ipc.call('snippets:export');
  assert.equal(ex.path, exportPath);
  const data = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
  assert.ok(data.snippets.some((s) => s.name === 'Do arquivo'));
  if (process.platform !== 'win32') assert.equal(fs.statSync(exportPath).mode & 0o777, 0o600);
});

test('ipc snippets: diálogo cancelado não faz nada; import grande demais é recusado', async () => {
  const big = path.join(dir, 'grande.json');
  fs.writeFileSync(big, 'x'.repeat(6 * 1024 * 1024));
  let open = { canceled: true, filePaths: [] };
  const dialog = {
    showOpenDialog: async () => open,
    showSaveDialog: async () => ({ canceled: true }),
  };
  const { ipc } = setup({ dialog });
  assert.deepEqual(await ipc.call('snippets:import'), { canceled: true });
  assert.deepEqual(await ipc.call('snippets:export'), { canceled: true });
  open = { canceled: false, filePaths: [big] };
  await assert.rejects(() => ipc.call('snippets:import'), /grande/i);
});

test('ipc snippets: tailwind devolve o script vendorizado (sem </script>)', async () => {
  const twFile = path.join(dir, 'tw.js');
  fs.writeFileSync(twFile, 'var a="</script>";');
  const { ipc } = setup({ tailwindPath: twFile });
  const src = await ipc.call('snippets:tailwind');
  assert.equal(src, 'var a="<\\/script>";');
});

test('runtime: register configura store e variáveis para o agente', async () => {
  setup();
  const rt = getSnippetsRuntime();
  assert.ok(rt && rt.store);
  assert.equal(rt.variables().find((v) => v.name === 'nome_marca').value, 'ACME');
});
