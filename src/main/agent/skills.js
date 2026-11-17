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
 * Fontes:
 *   embutidas  src/main/agent/skills/*.md
 *   usuário    userData/skills/*.md          (mesmo `id` sobrescreve a embutida)
 *   projeto    <projeto>/.agzos/skills/*.md  (namespace próprio: id `project:<id>`)
 * Skills de projeto vêm do repositório (fonte não confiável): nunca substituem embutidas
 * nem do usuário, e só rodam depois que o usuário confia nelas ("Workspace Trust").
 * A confiança vale para raiz + caminho + sha256 do arquivo (settings.aiSkills.trusted);
 * mudou o conteúdo, precisa confiar de novo. `pickSkill` lança `skill_untrusted`.
 * Frontmatter inválido → skill ignorada com aviso no log (nunca derruba o agente).
 * Só usam system prompt + allowlist + regras do laço: funcionam com qualquer provider
 * que tenha tool calling.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUILTIN_DIR = path.join(__dirname, 'skills');
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_FILE = 64 * 1024;
const MAX_FILES = 100;
const PROJECT_PREFIX = 'project:';
const PREVIEW_LINES = 12;

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
  const raw = fs.readFileSync(file);
  const { data, body } = parseFrontmatter(raw.toString('utf8'));
  const skill = normalizeSkill(data, body, { source, file });
  if (source === 'project') skill.sha256 = crypto.createHash('sha256').update(raw).digest('hex');
  return skill;
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
  const projectDir = projectRoot ? path.join(projectRoot, '.agzos', 'skills') : null;
  const sources = [['builtin', builtinDir], ['user', userDir], ['project', projectDir]];
  const byId = new Map();
  const warnings = [];
  for (const [source, dir] of sources) {
    if (!dir) continue;
    for (const file of listMarkdown(dir)) {
      try {
        const skill = readSkillFile(file, source);
        if (source === 'project') {
          // Namespace próprio: nunca colide com embutidas/usuário.
          skill.localId = skill.id;
          skill.id = `${PROJECT_PREFIX}${skill.id}`;
          skill.root = projectRoot;
        }
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

const samePath = (a, b) => typeof a === 'string' && typeof b === 'string'
  && (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

/** Registro de confiança gravado em settings.aiSkills.trusted. */
function trustRecord(skill) {
  return { root: skill.root, path: skill.file, sha256: skill.sha256 };
}

/** Embutidas/usuário: sempre. Projeto: só com registro de raiz + caminho + sha256 iguais. */
function isSkillTrusted(skill, trusted = []) {
  if (!skill || skill.source !== 'project') return true;
  if (!skill.root || !skill.file || !skill.sha256) return false;
  return (Array.isArray(trusted) ? trusted : []).some((t) => t && t.sha256 === skill.sha256
    && samePath(t.root, skill.root) && samePath(t.path, skill.file));
}

/**
 * Skill pelo id (opcionalmente só de um `kind`). Skill de projeto não confiada →
 * Error com code 'skill_untrusted'. Não encontrada → null.
 */
function pickSkill(skills, id, { trusted = [], kind = null } = {}) {
  const skill = (Array.isArray(skills) ? skills : []).find((s) => s.id === id && (!kind || s.kind === kind)) || null;
  if (skill && !isSkillTrusted(skill, trusted)) {
    const err = new Error(`A skill "${skill.label}" vem do projeto e ainda não foi marcada como confiável. Escolha-a de novo no seletor para revisar e confiar.`);
    err.code = 'skill_untrusted';
    throw err;
  }
  return skill;
}

/** Definições de ferramentas filtradas pela allowlist da skill (null = todas). */
function filterDefinitions(definitions, skill) {
  if (!skill || !Array.isArray(skill.tools)) return definitions;
  const allowed = new Set(skill.tools);
  return definitions.filter((d) => allowed.has(d.name));
}

/**
 * Versão pública (sem o prompt completo) para o renderer. Skills de projeto levam o
 * necessário para o diálogo de confiança: caminho relativo, hash e primeiras linhas.
 */
function describeSkill(skill, { trusted = [] } = {}) {
  const { id, label, icon, description, kind, tools, readOnly, source, file, overrides, order } = skill;
  const out = { id, label, icon, description, kind, tools, readOnly, source, file, overrides: overrides || null, order };
  if (source === 'project') {
    out.localId = skill.localId;
    out.sha256 = skill.sha256;
    out.sha256Short = String(skill.sha256 || '').slice(0, 12);
    out.relPath = skill.root ? path.relative(skill.root, file).split(path.sep).join('/') : file;
    out.preview = String(skill.prompt || '').split('\n').slice(0, PREVIEW_LINES).join('\n');
    out.trusted = isSkillTrusted(skill, trusted);
  }
  return out;
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
  pickSkill, isSkillTrusted, trustRecord, PROJECT_PREFIX,
};
