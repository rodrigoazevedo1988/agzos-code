/**
 * Skills (modos) do Agzos IA: arquivos Markdown com frontmatter.
 *
 *   ---
 *   id: plan
 *   label: Plan
 *   icon: list-checks
 *   description: …
 *   kind: agent            # agent (padrão, com ferramentas) | chat (só conversa)
 *   tools: [list_dir, read_file, search]   # allowlist; omitido = todas
 *   readOnly: true         # toda escrita/comando pede OK, em qualquer autonomia
 *   order: 30              # posição no seletor (opcional)
 *   ---
 *   <instruções do modo — vão no system prompt, junto com o prompt base>
 *
 * Fontes, da menor para a maior precedência (mesmo `id` sobrescreve):
 *   embutidas  src/main/agent/skills/*.md
 *   usuário    userData/skills/*.md
 *   projeto    <projeto>/.agzos/skills/*.md
 * Frontmatter inválido → skill ignorada com aviso no log (nunca derruba o agente).
 * Só usam system prompt + allowlist + regras do laço: funcionam com qualquer provider
 * que tenha tool calling.
 */

const fs = require('fs');
const path = require('path');

const BUILTIN_DIR = path.join(__dirname, 'skills');
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_FILE = 64 * 1024;
const MAX_FILES = 100;

function parseScalar(raw) {
  const v = raw.trim();
  if (v === '') return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith('[')) {
    if (!v.endsWith(']')) throw new Error(`lista sem "]": ${v}`);
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((x) => parseScalar(x)).filter((x) => x !== '') : [];
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/**
 * Frontmatter YAML simples (chave: valor, listas [a, b] ou "- item").
 * @returns {{ data: object, body: string }}  lança Error se malformado.
 */
function parseFrontmatter(text) {
  const src = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!match) throw new Error('sem frontmatter (--- … ---) no início');
  const data = {};
  let listKey = null;
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s*(.*)$/) || line.match(/^-\s+(.*)$/);
    if (item && listKey) { data[listKey].push(parseScalar(item[1])); continue; }
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!kv) throw new Error(`linha inválida no frontmatter: "${rawLine.trim()}"`);
    const [, key, value] = kv;
    if (value.trim() === '') { data[key] = []; listKey = key; continue; }
    listKey = null;
    data[key] = parseScalar(value);
  }
  return { data, body: src.slice(match[0].length).trim() };
}

/** Valida e normaliza uma skill lida de `file`. Lança Error com o motivo. */
function normalizeSkill(data, body, { source, file }) {
  const id = String(data.id ?? '').trim();
  if (!ID_RE.test(id)) throw new Error(`id inválido "${data.id ?? ''}" (use minúsculas, números e "-")`);
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim().slice(0, 40) : id;
  let tools = null;
  if (data.tools != null) {
    if (!Array.isArray(data.tools)) throw new Error('"tools" deve ser uma lista, ex.: [read_file, search]');
    tools = data.tools.map(String).filter(Boolean);
  }
  const kind = data.kind == null ? 'agent' : String(data.kind);
  if (!['agent', 'chat'].includes(kind)) throw new Error(`kind inválido "${kind}" (agent ou chat)`);
  if (data.readOnly != null && typeof data.readOnly !== 'boolean') throw new Error('"readOnly" deve ser true ou false');
  return {
    id,
    label,
    icon: typeof data.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(data.icon) ? data.icon : 'sparkles',
    description: typeof data.description === 'string' ? data.description.trim().slice(0, 300) : '',
    kind,
    tools,
    readOnly: data.readOnly === true,
    order: Number.isFinite(data.order) ? data.order : 100,
    prompt: body,
    source,
    file,
  };
}

function readSkillFile(file, source) {
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE) throw new Error('arquivo grande demais (máx. 64 KB)');
  const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  return normalizeSkill(data, body, { source, file });
}

function listMarkdown(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.toLowerCase().endsWith('.md'))
      .map((d) => path.join(dir, d.name))
      .sort()
      .slice(0, MAX_FILES);
  } catch { return []; }
}

/**
 * Carrega as skills das três fontes. Erros viram avisos (`warnings` + log), nunca exceção.
 * @returns {{ skills: Array, warnings: Array<{ file, source, message }> }}
 */
function loadSkills({ builtinDir = BUILTIN_DIR, userDir = null, projectRoot = null, log = console.warn } = {}) {
  const sources = [['builtin', builtinDir], ['user', userDir], ['project', projectRoot ? path.join(projectRoot, '.agzos', 'skills') : null]];
  const byId = new Map();
  const warnings = [];
  for (const [source, dir] of sources) {
    if (!dir) continue;
    for (const file of listMarkdown(dir)) {
      try {
        const skill = readSkillFile(file, source);
        const previous = byId.get(skill.id);
        if (previous) skill.overrides = previous.source;
        byId.set(skill.id, skill);
      } catch (err) {
        const warning = { file, source, message: err.message };
        warnings.push(warning);
        try { log(`[skills] ignorada ${file}: ${err.message}`); } catch { /* log opcional */ }
      }
    }
  }
  const skills = [...byId.values()].sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
  return { skills, warnings };
}

/** Definições de ferramentas filtradas pela allowlist da skill (null = todas). */
function filterDefinitions(definitions, skill) {
  if (!skill || !Array.isArray(skill.tools)) return definitions;
  const allowed = new Set(skill.tools);
  return definitions.filter((d) => allowed.has(d.name));
}

/** Versão pública (sem o prompt completo) para o renderer. */
function describeSkill(skill) {
  const { id, label, icon, description, kind, tools, readOnly, source, file, overrides, order } = skill;
  return { id, label, icon, description, kind, tools, readOnly, source, file, overrides: overrides || null, order };
}

const SKILL_TEMPLATE = `---
id: minha-skill
label: Minha skill
icon: sparkles
description: O que este modo faz, em uma linha.
# kind: agent            # agent (usa ferramentas) ou chat (só conversa)
# tools: [list_dir, read_file, search]   # allowlist; sem esta linha = todas
# readOnly: true         # toda escrita/comando pede OK
---
Você está no modo "Minha skill".

Descreva aqui, em português, como o agente deve trabalhar neste modo:
- objetivo e entregável esperado;
- passos que ele deve seguir;
- o que ele NÃO deve fazer.
`;

module.exports = {
  parseFrontmatter, normalizeSkill, loadSkills, filterDefinitions, describeSkill, SKILL_TEMPLATE, BUILTIN_DIR,
};
