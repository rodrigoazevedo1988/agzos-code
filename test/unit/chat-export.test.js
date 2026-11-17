const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { transcriptMarkdown, transcriptHtml, exportFileName } = require('../../src/main/chat-export');
const { buildGlobalIndex, keyFor, register } = require('../../src/main/ipc/chat-history');

const turn = {
  v: 1, mode: 'edit',
  segments: [
    { t: 'text', text: 'Vou criar.' },
    { t: 'step', id: 'c1' },
    { t: 'steer', text: 'use aspas simples' },
    { t: 'step', id: 'c2' },
    { t: 'text', text: 'Pronto.' },
  ],
  steps: {
    c1: { callId: 'c1', tool: 'write_file', title: 'Escrever /w/a.js', input: { path: 'a.js' }, status: 'ok', summary: 'criado', meta: { added: 2, removed: 0, created: true } },
    c2: { callId: 'c2', tool: 'run_command', title: 'npm test', input: { command: 'npm test' }, status: 'ok', summary: '', meta: { exitCode: 0 } },
  },
  done: { checkpointId: 'x', changes: [{ path: 'a.js', added: 2, removed: 0 }] }, error: null, undone: false, cancelled: false,
};
const conversation = {
  id: 'c', title: 'Criar a.js', updatedAt: Date.UTC(2026, 10, 17, 12, 30),
  messages: [
    { role: 'user', content: 'Crie a.js com a chave [redigido] e sk-abcdefghijklmnopqrstuv', attachments: [{ id: 'a'.repeat(32), kind: 'image', name: 'tela.png', size: 2048 }] },
    { role: 'assistant', model: 'fake-1', skill: 'agent', content: `Vou criar.\n\n<!--agzos-agent ${JSON.stringify(turn)}-->\n\n**Ações do agente**` },
  ],
};

test('export Markdown: formato estável com ações, anexos e segredos redigidos', () => {
  const md = transcriptMarkdown(conversation, { root: '/w', exportedAt: Date.UTC(2026, 10, 17, 13, 0), timeZone: 'UTC' });
  assert.equal(md, [
    '# Criar a.js',
    '',
    '- **Data:** 2026-11-17 12:30 UTC',
    '- **Pasta:** `/w`',
    '- **Modo:** Agente',
    '- **Modelo:** fake-1',
    '- **Exportado do Agzos Code em:** 2026-11-17 13:00 UTC',
    '',
    '---',
    '',
    '## Você',
    '',
    'Crie a.js com a chave [redigido] e [redigido]',
    '',
    '**Anexos:** `tela.png` (imagem, 2 KB)',
    '',
    '## Agzos IA (Agente · fake-1)',
    '',
    'Vou criar.',
    '',
    '**Ações do agente**',
    '',
    '- `write_file` · Escrever a.js — ok, +2 −0, novo — criado',
    '',
    '> **Você** _(enviada durante a execução)_',
    '> use aspas simples',
    '',
    '**Ações do agente**',
    '',
    '- `run_command` · $ npm test — ok, exit 0',
    '',
    'Pronto.',
    '',
    '**Arquivos alterados**',
    '',
    '- `a.js` (+2 −0)',
    '',
  ].join('\n'));
  assert.equal(exportFileName(conversation, 'md'), 'agzos-ia-criar-a-js.md');
});

test('HTML do PDF escapa HTML cru e bloqueia rede/JS por CSP', () => {
  const html = transcriptHtml('# T\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))', 'T');
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /default-src 'none'/);
});

test('índice global agrupa por pasta, pasta atual primeiro, busca por título e conteúdo', () => {
  const entries = [
    { key: keyFor('/proj/a'), data: { root: '/proj/a', conversations: [{ id: 'a1', title: 'Login', updatedAt: 10, messages: [{ role: 'user', content: 'arrumar login' }] }] } },
    { key: keyFor('/proj/b'), data: { conversations: [ // arquivo antigo, sem root
      { id: 'b1', title: 'Deploy', updatedAt: 30, messages: [{ role: 'user', content: 'como faço o deploy' }, { role: 'assistant', content: 'Use o script de publicação.' }] },
      { id: 'b2', title: 'Vazia', updatedAt: 40, messages: [] },
    ] } },
  ];
  const groups = buildGlobalIndex(entries, { currentRoot: '/proj/a', knownRoots: ['/proj/b'] });
  assert.deepEqual(groups.map((g) => [g.name, g.current, g.conversations.map((c) => c.id)]), [['a', true, ['a1']], ['b', false, ['b1']]]);
  assert.equal(groups[1].root, '/proj/b');
  const found = buildGlobalIndex(entries, { query: 'publicacao' });
  assert.equal(found.length, 1);
  assert.equal(found[0].conversations[0].id, 'b1');
  assert.match(found[0].conversations[0].snippet, /publicação/);
  assert.equal(buildGlobalIndex(entries, { knownRoots: [] }).find((g) => g.key === keyFor('/proj/b')).name, 'Pasta desconhecida');
});

test('IPC: all/get/rename/delete/export por chave; arquivo grava root', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agzos-chatx-'));
  try {
    const handlers = {};
    register({ handle: (n, fn) => { handlers[n] = fn; } }, { app: { getPath: (k) => (k === 'documents' ? dir : dir) } });
    await handlers['chat:history:save'](null, '/w', { conversations: [conversation], activeId: 'c' });
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'chats', `${keyFor('/w')}.json`), 'utf8'));
    assert.equal(raw.root, '/w');
    assert.deepEqual(raw.conversations[0].messages[0].attachments[0], { id: 'a'.repeat(32), kind: 'image', name: 'tela.png', size: 2048 });
    assert.equal(raw.conversations[0].messages[1].model, 'fake-1');
    const [group] = await handlers['chat:history:all'](null, { currentRoot: '/w' });
    assert.equal(group.current, true);
    assert.equal((await handlers['chat:history:get'](null, group.key, 'c')).conversation.title, 'Criar a.js');
    assert.equal(await handlers['chat:history:rename'](null, group.key, 'c', 'Novo nome'), true);
    const out = path.join(dir, 'x.md');
    process.env.AGZOS_TEST = '1';
    global.__agzosNextSavePath = out;
    assert.equal(await handlers['chat:export'](null, group.key, 'c', 'md'), out);
    assert.match(await fs.readFile(out, 'utf8'), /^# Novo nome/);
    assert.equal(await handlers['chat:history:delete'](null, group.key, 'c'), true);
    assert.deepEqual(await handlers['chat:history:all'](null, {}), []);
    await assert.rejects(handlers['chat:history:get'](null, '../etc', 'c'), /inválida/);
  } finally {
    delete process.env.AGZOS_TEST;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
