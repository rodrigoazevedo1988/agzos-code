const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseFrontmatter, loadSkills, filterDefinitions } = require('../../src/main/agent/skills');
const { DEFINITIONS } = require('../../src/main/agent/tools');

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agzos-skills-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const write = (dir, name, text) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), text); };

test('parseFrontmatter: escalares, listas inline e em bloco, comentários', () => {
  const { data, body } = parseFrontmatter([
    '---', 'id: plan', 'label: "Plan"', 'tools: [list_dir, read_file]  # allowlist', 'readOnly: true', 'order: 3',
    'extra:', '  - a', '  - b', '---', 'Corpo aqui.', '',
  ].join('\n'));
  assert.deepEqual(data, { id: 'plan', label: 'Plan', tools: ['list_dir', 'read_file'], readOnly: true, order: 3, extra: ['a', 'b'] });
  assert.equal(body, 'Corpo aqui.');
  assert.throws(() => parseFrontmatter('sem frontmatter'), /sem frontmatter/);
  assert.throws(() => parseFrontmatter('---\nisto não é chave\n---\n'), /linha inválida/);
});

test('embutidas: agente, chat e os 4 modos novos', () => {
  const { skills, warnings } = loadSkills({ log: () => {} });
  assert.deepEqual(warnings, []);
  const ids = skills.map((s) => s.id);
  for (const id of ['agent', 'chat', 'plan', 'debugger', 'site-builder', 'security']) assert.ok(ids.includes(id), id);
  const plan = skills.find((s) => s.id === 'plan');
  assert.deepEqual(plan.tools, ['list_dir', 'read_file', 'search']);
  assert.equal(plan.readOnly, true);
  assert.equal(skills.find((s) => s.id === 'chat').kind, 'chat');
  assert.equal(skills.find((s) => s.id === 'security').readOnly, true);
  assert.ok(skills.every((s) => s.prompt.length > 50));
});

test('precedência projeto > usuário > embutida; inválida é ignorada com aviso', () => {
  const builtinDir = path.join(tmp, 'builtin');
  const userDir = path.join(tmp, 'user');
  const project = path.join(tmp, 'proj');
  write(builtinDir, 'plan.md', '---\nid: plan\nlabel: Plan embutido\n---\nA');
  write(userDir, 'plan.md', '---\nid: plan\nlabel: Plan usuário\n---\nB');
  write(userDir, 'minha.md', '---\nid: minha\nlabel: Minha\n---\nC');
  write(path.join(project, '.agzos', 'skills'), 'p.md', '---\nid: plan\nlabel: Plan projeto\n---\nD');
  write(path.join(project, '.agzos', 'skills'), 'ruim.md', '---\nid: Inválido!\n---\nX');
  write(path.join(project, '.agzos', 'skills'), 'ruim2.md', 'sem frontmatter');
  const logs = [];
  const { skills, warnings } = loadSkills({ builtinDir, userDir, projectRoot: project, log: (m) => logs.push(m) });
  const plan = skills.find((s) => s.id === 'plan');
  assert.equal(plan.label, 'Plan projeto');
  assert.equal(plan.source, 'project');
  assert.equal(plan.overrides, 'user');
  assert.equal(plan.prompt, 'D');
  assert.ok(skills.some((s) => s.id === 'minha' && s.source === 'user'));
  assert.equal(warnings.length, 2);
  assert.equal(logs.length, 2);
});

test('allowlist da skill filtra as definitions', () => {
  const defs = filterDefinitions(DEFINITIONS, { tools: ['list_dir', 'read_file', 'search'] });
  assert.deepEqual(defs.map((d) => d.name), ['list_dir', 'read_file', 'search']);
  assert.equal(filterDefinitions(DEFINITIONS, { tools: null }).length, DEFINITIONS.length);
});

test('sessão com skill: allowlist nas definitions, ferramenta fora dela é recusada, prompt inclui o modo', async () => {
  const { createAgentSessions } = require('../../src/main/agent/session');
  const { createCheckpointStore } = require('../../src/main/agent/checkpoints');
  fs.writeFileSync(path.join(tmp, 'a.js'), 'x\n');
  const seen = [];
  let i = 0;
  const turns = [{ calls: [{ name: 'write_file', input: { path: 'b.js', content: 'y' } }] }, { text: 'plano' }];
  const provider = {
    async* chatTools({ messages, tools }) {
      seen.push({ messages, tools });
      const turn = turns[i++] || { text: 'fim' };
      if (turn.text) yield { type: 'text', delta: turn.text };
      for (const [k, c] of (turn.calls || []).entries()) yield { type: 'tool_call', id: `c${k}`, name: c.name, input: c.input };
    },
  };
  const events = [];
  const { skills } = loadSkills({ log: () => {} });
  const sessions = createAgentSessions({
    getRoot: () => tmp, getProvider: () => ({ provider, model: 'm' }), checkpoints: createCheckpointStore({}),
    send: (_id, e) => events.push(e), getEnv: () => ({}), getSkill: (id) => skills.find((s) => s.id === id),
  });
  sessions.run('r', { messages: [{ role: 'user', content: 'planeje' }], mode: 'auto', skill: 'plan' });
  await sessions.wait('r');
  assert.deepEqual(seen[0].tools.map((t) => t.name), ['list_dir', 'read_file', 'search']);
  assert.match(seen[0].messages[0].content, /## Modo ativo: Plan/);
  assert.ok(events.some((e) => e.type === 'tool_end' && e.ok === false && /não está disponível no modo Plan/.test(e.summary)));
  assert.equal(fs.existsSync(path.join(tmp, 'b.js')), false);
});

test('skill readOnly força aprovação mesmo no modo auto', async () => {
  const { runAgent } = require('../../src/main/agent/loop');
  const { createCheckpointStore } = require('../../src/main/agent/checkpoints');
  const { createToolbox } = require('../../src/main/agent/tools');
  let i = 0;
  const provider = {
    async* chatTools() {
      if (i++ === 0) yield { type: 'tool_call', id: 'c1', name: 'write_file', input: { path: 'n.txt', content: 'z' } };
      else yield { type: 'text', delta: 'ok' };
    },
  };
  const checkpoint = createCheckpointStore({}).create({ root: tmp });
  const asked = [];
  await runAgent({
    provider, model: 'm', history: [{ role: 'user', content: 'x' }], mode: 'auto', toolbox: createToolbox({ root: tmp, checkpoint }),
    checkpoint, emit: () => {}, signal: new AbortController().signal, systemPrompt: 'S', readOnly: true,
    requestApproval: async (id) => { asked.push(id); return 'deny'; },
  });
  assert.deepEqual(asked, ['c1']);
  assert.equal(fs.existsSync(path.join(tmp, 'n.txt')), false);
});
