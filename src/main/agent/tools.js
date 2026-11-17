/**
 * Ferramentas do agente. Todas restritas à raiz do workspace (path-guard com
 * só a raiz liberada); caminhos relativos à raiz.
 *
 * createToolbox(...) → { definitions, prepare(name, input) }
 * prepare valida a entrada e devolve:
 *   { title, category: 'read'|'write'|'destructive'|'command', preview, risky, riskReason,
 *     sessionKey, execute({ onOutput, signal }) → { ok, result, summary, meta, changed } }
 * Entrada inválida ou caminho fora da raiz → lança ToolError (negado, não perguntado).
 *
 * Ferramentas extras (módulos nativos, ver src/main/modules/agent-tools.js):
 *   { definition: { name, description, input_schema }, kind: 'read'|'write'|'command',
 *     prepare(input, ctx) → { title, preview?, run({ signal, onOutput }) → Promise<{ summary, meta?, output?, changed?, ok? }> } }
 *   ctx = { resolvePath, rel, checkpoint, readTextFile, root }. prepare pode ser assíncrono
 *   (então toolbox.prepare devolve Promise). preview.risk = '<motivo>' força aprovação em
 *   qualquer modo. `changed` (caminhos absolutos) vira evento file_changed.
 *   Opcional: commandRisk(command, { cwd, root }) → string|null|Promise<string|null>, consultado
 *   no preparo do run_command (ex.: Cofre .env marca `git commit` com segredos no stage como risco).
 *   Só comandos para os quais algum gancho devolve Promise tornam o preparo assíncrono.
 */

const fs = require('fs');
const path = require('path');
const { createPathGuard } = require('../lib/path-guard');
const { assessCommand } = require('./risk');
const { lineStats, truncateMiddle, stripAnsi, redact } = require('./text');
const { runCommand: defaultRunCommand } = require('./exec');

const EXTRA_KINDS = ['read', 'write', 'command'];

const LIMITS = {
  readLines: 2000,
  readBytes: 256 * 1024,
  searchResults: 200,
  searchFileBytes: 1024 * 1024,
  searchFiles: 20000,
  listEntries: 500,
  listDepth: 3,
  commandOutput: 30 * 1024,
  commandTimeoutDefault: 120,
  commandTimeoutMax: 600,
};

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist']);

class ToolError extends Error {}

const DEFINITIONS = [
  {
    name: 'list_dir',
    description: 'Lista arquivos e pastas (pastas terminam com "/"). Caminho relativo à raiz do projeto. node_modules/.git/dist não são expandidos.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Pasta relativa à raiz ("." para a raiz).' },
        depth: { type: 'integer', minimum: 1, maximum: 3, description: 'Profundidade (1–3, padrão 1).' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Lê um arquivo de texto. Cada linha vem prefixada com o número e um TAB (o prefixo não faz parte do arquivo). Máx. 2000 linhas / 256KB por chamada; use offset/limit para arquivos grandes.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', minimum: 1, description: 'Linha inicial (1 = primeira).' },
        limit: { type: 'integer', minimum: 1, maximum: 2000, description: 'Número de linhas.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search',
    description: 'Busca texto nos arquivos do projeto (ignora node_modules/.git/dist). Sem regex: substring sem diferenciar maiúsculas. Retorna até 200 linhas "caminho:linha: texto".',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        glob: { type: 'string', description: 'Filtro de arquivos, ex.: "**/*.js" ou "*.css".' },
        regex: { type: 'boolean', description: 'Trata query como expressão regular (JavaScript).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo com o conteúdo completo (cria pastas pai). Para mudanças pontuais em arquivo existente prefira edit_file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Substitui old_string por new_string num arquivo existente. old_string deve ser exato (sem os números de linha do read_file) e único no arquivo, a menos que replace_all seja true.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'create_dir',
    description: 'Cria uma pasta (e as pastas pai).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'move_path',
    description: 'Move ou renomeia um arquivo/pasta. O destino não pode existir.',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
  {
    name: 'delete_path',
    description: 'Apaga um arquivo ou pasta (recursivo).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'run_command',
    description: 'Executa um comando no shell do projeto (sem entrada interativa). Retorna exit code e saída (stdout+stderr, truncada a 30KB). Use para instalar dependências, rodar testes, build, git etc.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string', description: 'Pasta relativa à raiz (padrão ".").' },
        timeout_s: { type: 'integer', minimum: 1, maximum: 600, description: 'Tempo máximo em segundos (padrão 120, máx. 600).' },
      },
      required: ['command'],
    },
  },
];

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (ch === '?') re += '[^/]';
    else if (ch === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')).join('|')})`;
        i = end;
      } else re += '\\{';
    } else re += ch.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function statOrNull(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** Ferramentas de módulos podem declarar `input_schema` (estilo Anthropic); os providers leem `parameters`. */
function normalizeDefinition(def) {
  const schema = def.parameters || def.input_schema || { type: 'object', properties: {} };
  const out = { ...def, parameters: schema };
  delete out.input_schema;
  return out;
}

function createToolbox({
  root, checkpoint, platform = process.platform, runCommand = defaultRunCommand,
  shell, env, secrets = [], extraTools = [],
}) {
  const rootAbs = path.resolve(root);
  const guard = createPathGuard({ platform });
  guard.allow(rootAbs);

  const rel = (abs) => (path.relative(rootAbs, abs) || '.').split(path.sep).join('/');

  function resolvePath(p, field = 'path') {
    if (typeof p !== 'string' || !p.trim()) throw new ToolError(`Parâmetro "${field}" obrigatório`);
    if (p.includes('\0')) throw new ToolError(`Caminho inválido: ${p}`);
    const abs = path.resolve(rootAbs, p.trim());
    if (!guard.isAllowed(abs)) throw new ToolError(`Acesso negado: ${p} está fora da pasta do projeto`);
    return abs;
  }

  function notRoot(abs, p) {
    if (path.resolve(abs) === rootAbs) throw new ToolError(`Operação não permitida na raiz do projeto: ${p}`);
  }

  function readTextFile(abs) {
    const buf = fs.readFileSync(abs);
    if (isBinary(buf)) throw new ToolError(`Arquivo binário: ${rel(abs)}`);
    return buf.toString('utf8');
  }

  // ---------------------------------------------------------------- leitura
  function listDir(input) {
    const abs = resolvePath(input.path ?? '.');
    const st = statOrNull(abs);
    if (!st) throw new ToolError(`Não encontrado: ${input.path}`);
    if (!st.isDirectory()) throw new ToolError(`Não é uma pasta: ${input.path}`);
    const depth = Math.min(LIMITS.listDepth, Math.max(1, Number.parseInt(input.depth, 10) || 1));
    return {
      title: `Listar ${rel(abs)}`,
      category: 'read',
      execute: async () => {
        const lines = [];
        let truncated = false;
        const walk = (dir, level) => {
          let names;
          try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          names.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
          for (const d of names) {
            if (lines.length >= LIMITS.listEntries) { truncated = true; return; }
            const full = path.join(dir, d.name);
            const indent = '  '.repeat(level);
            if (d.isDirectory()) {
              const ignored = IGNORED_DIRS.has(d.name);
              lines.push(`${indent}${d.name}/${ignored ? ' (não expandido)' : ''}`);
              if (!ignored && level + 1 < depth) walk(full, level + 1);
            } else {
              const s = statOrNull(full);
              lines.push(`${indent}${d.name}${s ? ` (${formatSize(s.size)})` : ''}`);
            }
          }
        };
        walk(abs, 0);
        if (truncated) lines.push(`[... lista truncada em ${LIMITS.listEntries} itens ...]`);
        const text = lines.length ? lines.join('\n') : '(pasta vazia)';
        return { ok: true, result: text, summary: `${lines.length} itens`, meta: { path: abs, count: lines.length } };
      },
    };
  }

  function readFile(input) {
    const abs = resolvePath(input.path);
    const st = statOrNull(abs);
    if (!st) throw new ToolError(`Arquivo não encontrado: ${input.path}`);
    if (st.isDirectory()) throw new ToolError(`É uma pasta, use list_dir: ${input.path}`);
    const offset = Math.max(1, Number.parseInt(input.offset, 10) || 1);
    const limit = Math.min(LIMITS.readLines, Math.max(1, Number.parseInt(input.limit, 10) || LIMITS.readLines));
    return {
      title: `Ler ${rel(abs)}`,
      category: 'read',
      execute: async () => {
        const text = readTextFile(abs);
        const all = text.split(/\r?\n/);
        if (all.length > 1 && all[all.length - 1] === '') all.pop();
        const out = [];
        let bytes = 0;
        let last = offset - 1;
        for (let i = offset - 1; i < all.length && i < offset - 1 + limit; i++) {
          const line = `${i + 1}\t${all[i]}`;
          bytes += Buffer.byteLength(line) + 1;
          if (bytes > LIMITS.readBytes) break;
          out.push(line);
          last = i + 1;
        }
        let result = out.join('\n');
        if (!text.length) result = '(arquivo vazio)';
        else if (offset > all.length) result = `(offset ${offset} além do fim; o arquivo tem ${all.length} linhas)`;
        else if (offset > 1 || last < all.length) result += `\n[linhas ${offset}–${last} de ${all.length}; use offset/limit para o resto]`;
        return { ok: true, result, summary: `${Math.max(0, last - offset + 1)} linhas`, meta: { path: abs, lines: all.length } };
      },
    };
  }

  function search(input) {
    if (typeof input.query !== 'string' || !input.query) throw new ToolError('Parâmetro "query" obrigatório');
    let matcher;
    if (input.regex) {
      let re;
      try { re = new RegExp(input.query); } catch (err) { throw new ToolError(`Regex inválida: ${err.message}`); }
      matcher = (line) => re.test(line);
    } else {
      const q = input.query.toLowerCase();
      matcher = (line) => line.toLowerCase().includes(q);
    }
    let globRe = null;
    let globBase = false;
    if (typeof input.glob === 'string' && input.glob.trim()) {
      globRe = globToRegExp(input.glob.trim().replace(/^\.\//, ''));
      globBase = !input.glob.includes('/');
    }
    return {
      title: `Buscar “${input.query.slice(0, 60)}”`,
      category: 'read',
      execute: async ({ signal } = {}) => {
        const results = [];
        let scanned = 0;
        let truncated = false;
        const walk = (dir) => {
          if (truncated || signal?.aborted) return;
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          entries.sort((a, b) => a.name.localeCompare(b.name));
          for (const d of entries) {
            if (truncated) return;
            const full = path.join(dir, d.name);
            if (d.isDirectory()) {
              if (!IGNORED_DIRS.has(d.name)) walk(full);
              continue;
            }
            if (!d.isFile()) continue;
            const r = rel(full);
            if (globRe && !globRe.test(globBase ? d.name : r)) continue;
            if (++scanned > LIMITS.searchFiles) { truncated = true; return; }
            const st = statOrNull(full);
            if (!st || st.size > LIMITS.searchFileBytes) continue;
            let buf;
            try { buf = fs.readFileSync(full); } catch { continue; }
            if (isBinary(buf)) continue;
            const lines = buf.toString('utf8').split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
              if (!matcher(lines[i])) continue;
              results.push(`${r}:${i + 1}: ${lines[i].trim().slice(0, 300)}`);
              if (results.length >= LIMITS.searchResults) { truncated = true; return; }
            }
          }
        };
        walk(rootAbs);
        let result = results.length ? results.join('\n') : 'Nenhum resultado.';
        if (truncated) result += `\n[resultados truncados em ${LIMITS.searchResults}]`;
        return { ok: true, result, summary: `${results.length} resultados`, meta: { count: results.length } };
      },
    };
  }

  // ----------------------------------------------------------------- escrita
  function writeFile(input) {
    const abs = resolvePath(input.path);
    if (typeof input.content !== 'string') throw new ToolError('Parâmetro "content" deve ser texto');
    const st = statOrNull(abs);
    if (st && st.isDirectory()) throw new ToolError(`É uma pasta: ${input.path}`);
    const before = st ? readTextFile(abs) : null;
    const created = !st;
    return {
      title: `${created ? 'Criar' : 'Escrever'} ${rel(abs)}`,
      category: 'write',
      sessionKey: 'write_file',
      preview: { diff: { path: abs, before: before ?? '', after: input.content } },
      execute: async () => {
        checkpoint?.recordParents(abs);
        checkpoint?.record(abs);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, input.content, 'utf8');
        const stats = lineStats(before, input.content);
        const meta = { path: abs, ...stats };
        if (created) meta.created = true;
        return {
          ok: true,
          result: `${created ? 'Arquivo criado' : 'Arquivo sobrescrito'}: ${rel(abs)} (+${stats.added} −${stats.removed})`,
          summary: `+${stats.added} −${stats.removed}`,
          meta,
          changed: [abs],
        };
      },
    };
  }

  function editFile(input) {
    const abs = resolvePath(input.path);
    const st = statOrNull(abs);
    if (!st) throw new ToolError(`Arquivo não encontrado: ${input.path} (use write_file para criar)`);
    if (st.isDirectory()) throw new ToolError(`É uma pasta: ${input.path}`);
    if (typeof input.old_string !== 'string' || !input.old_string) throw new ToolError('Parâmetro "old_string" obrigatório e não vazio');
    if (typeof input.new_string !== 'string') throw new ToolError('Parâmetro "new_string" deve ser texto');
    if (input.old_string === input.new_string) throw new ToolError('old_string e new_string são iguais');
    const before = readTextFile(abs);
    let oldStr = input.old_string;
    let newStr = input.new_string;
    const count = (s) => (s ? before.split(s).length - 1 : 0);
    let n = count(oldStr);
    if (n === 0 && before.includes('\r\n') && !oldStr.includes('\r\n')) {
      oldStr = oldStr.replace(/\n/g, '\r\n');
      newStr = newStr.replace(/\r?\n/g, '\r\n');
      n = count(oldStr);
    }
    if (n === 0) throw new ToolError(`old_string não encontrado em ${rel(abs)}. Leia o arquivo de novo e copie o trecho exato.`);
    if (n > 1 && !input.replace_all) {
      throw new ToolError(`old_string aparece ${n} vezes em ${rel(abs)}; inclua mais contexto para torná-lo único ou use replace_all.`);
    }
    let after;
    if (input.replace_all) after = before.split(oldStr).join(newStr);
    else {
      const i = before.indexOf(oldStr);
      after = before.slice(0, i) + newStr + before.slice(i + oldStr.length);
    }
    return {
      title: `Editar ${rel(abs)}`,
      category: 'write',
      sessionKey: 'edit_file',
      preview: { diff: { path: abs, before, after } },
      execute: async () => {
        const current = readTextFile(abs);
        if (current !== before) throw new ToolError(`${rel(abs)} mudou desde a leitura; leia de novo`);
        checkpoint?.record(abs);
        fs.writeFileSync(abs, after, 'utf8');
        const stats = lineStats(before, after);
        return {
          ok: true,
          result: `Editado: ${rel(abs)} (${n} ocorrência${n > 1 ? 's' : ''}; +${stats.added} −${stats.removed})`,
          summary: `+${stats.added} −${stats.removed}`,
          meta: { path: abs, ...stats },
          changed: [abs],
        };
      },
    };
  }

  function createDir(input) {
    const abs = resolvePath(input.path);
    const st = statOrNull(abs);
    if (st && !st.isDirectory()) throw new ToolError(`Já existe um arquivo com esse nome: ${input.path}`);
    return {
      title: `Criar pasta ${rel(abs)}`,
      category: 'write',
      sessionKey: 'create_dir',
      preview: { path: abs, kind: 'create_dir' },
      execute: async () => {
        if (statOrNull(abs)?.isDirectory()) {
          return { ok: true, result: `A pasta já existe: ${rel(abs)}`, summary: 'já existia', meta: { path: abs, added: 0, removed: 0 } };
        }
        checkpoint?.recordParents(abs);
        checkpoint?.record(abs);
        fs.mkdirSync(abs, { recursive: true });
        return { ok: true, result: `Pasta criada: ${rel(abs)}`, summary: 'criada', meta: { path: abs, added: 0, removed: 0, created: true }, changed: [abs] };
      },
    };
  }

  function movePath(input) {
    const from = resolvePath(input.from, 'from');
    const to = resolvePath(input.to, 'to');
    notRoot(from, input.from);
    notRoot(to, input.to);
    const st = statOrNull(from);
    if (!st) throw new ToolError(`Origem não encontrada: ${input.from}`);
    if (statOrNull(to)) throw new ToolError(`Destino já existe: ${input.to}`);
    if ((to + path.sep).startsWith(from + path.sep)) throw new ToolError('Não é possível mover uma pasta para dentro dela mesma');
    return {
      title: `Mover ${rel(from)} → ${rel(to)}`,
      category: 'destructive',
      sessionKey: 'move_path',
      preview: { path: from, to, kind: 'move', isDir: st.isDirectory() },
      execute: async () => {
        checkpoint?.recordTree(from);
        checkpoint?.recordParents(to);
        checkpoint?.record(to);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        try {
          fs.renameSync(from, to);
        } catch (err) {
          if (err.code !== 'EXDEV') throw err;
          fs.cpSync(from, to, { recursive: true });
          fs.rmSync(from, { recursive: true, force: true });
        }
        return {
          ok: true, result: `Movido: ${rel(from)} → ${rel(to)}`, summary: 'movido',
          meta: { path: to, from, added: 0, removed: 0, moved: true }, changed: [from, to],
        };
      },
    };
  }

  function deletePath(input) {
    const abs = resolvePath(input.path);
    notRoot(abs, input.path);
    const st = fs.lstatSync(abs, { throwIfNoEntry: false });
    if (!st) throw new ToolError(`Não encontrado: ${input.path}`);
    const isDir = st.isDirectory();
    return {
      title: `Apagar ${rel(abs)}`,
      category: 'destructive',
      sessionKey: 'delete_path',
      preview: { path: abs, kind: 'delete', isDir },
      execute: async () => {
        let removed = 0;
        if (!isDir && st.isFile()) {
          try { removed = lineStats(readTextFile(abs), null).removed; } catch {}
        }
        checkpoint?.recordTree(abs);
        fs.rmSync(abs, { recursive: true, force: true });
        return {
          ok: true, result: `Apagado: ${rel(abs)}`, summary: 'apagado',
          meta: { path: abs, added: 0, removed, deleted: true }, changed: [abs],
        };
      },
    };
  }

  // ----------------------------------------------------------------- comando
  function command(input) {
    if (typeof input.command !== 'string' || !input.command.trim()) throw new ToolError('Parâmetro "command" obrigatório');
    const cwd = resolvePath(input.cwd ?? '.', 'cwd');
    if (!statOrNull(cwd)?.isDirectory()) throw new ToolError(`cwd não é uma pasta: ${input.cwd}`);
    const timeoutS = Math.min(LIMITS.commandTimeoutMax,
      Math.max(1, Number.parseInt(input.timeout_s, 10) || LIMITS.commandTimeoutDefault));
    const risk = assessCommand(input.command);
    const cmd = input.command.trim();
    const prepared = {
      title: `Executar ${cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd}`,
      category: 'command',
      risky: risk.risky,
      riskReason: risk.reason,
      sessionKey: `run_command:${cmd}`,
      preview: { command: cmd, cwd, risky: risk.risky, reason: risk.reason },
      execute: async ({ onOutput = () => {}, signal } = {}) => {
        const res = await runCommand({
          command: cmd, cwd, timeoutMs: timeoutS * 1000, signal, platform, shell, env,
          onOutput: (chunk) => {
            const clean = redact(stripAnsi(chunk), secrets);
            if (clean) onOutput(clean);
          },
        });
        const output = redact(stripAnsi(res.output), secrets);
        let header = `exit code: ${res.exitCode} (${(res.durationMs / 1000).toFixed(1)}s)`;
        if (res.timedOut) header += ` — tempo esgotado após ${timeoutS}s; processo encerrado`;
        if (res.cancelled) header += ' — cancelado pelo usuário';
        const body = output.trim() ? truncateMiddle(output, LIMITS.commandOutput) : '(sem saída)';
        return {
          ok: res.exitCode === 0 && !res.timedOut && !res.cancelled,
          result: `${header}\n${body}`,
          summary: res.timedOut ? 'tempo esgotado' : `exit ${res.exitCode}`,
          meta: { exitCode: res.exitCode, durationMs: res.durationMs, timedOut: res.timedOut || undefined },
        };
      },
    };
    return withCommandRisk(prepared, cmd, cwd);
  }

  /** Ganchos `commandRisk` das ferramentas extras: o primeiro motivo encontrado vira risco. */
  function withCommandRisk(prepared, cmd, cwd) {
    const hooks = [...EXTRA.values()].filter((t) => typeof t.commandRisk === 'function');
    const results = [];
    for (const t of hooks) {
      try { results.push(t.commandRisk(cmd, { cwd, root: rootAbs })); } catch { /* gancho com erro é ignorado */ }
    }
    const markRisk = (reasons) => {
      const reason = reasons.find((r) => typeof r === 'string' && r);
      if (!reason || prepared.risky) return prepared;
      prepared.risky = true;
      prepared.riskReason = reason;
      prepared.preview = { ...prepared.preview, risky: true, reason };
      return prepared;
    };
    if (!results.some((r) => r && typeof r.then === 'function')) return markRisk(results);
    return Promise.all(results.map((r) => Promise.resolve(r).catch(() => null))).then(markRisk);
  }

  const PREPARE = {
    list_dir: listDir,
    read_file: readFile,
    search,
    write_file: writeFile,
    edit_file: editFile,
    create_dir: createDir,
    move_path: movePath,
    delete_path: deletePath,
    run_command: command,
  };

  // ------------------------------------------------- ferramentas extras (módulos)
  const extraCtx = { resolvePath, rel, checkpoint, readTextFile, root: rootAbs };
  const EXTRA = new Map();
  for (const tool of Array.isArray(extraTools) ? extraTools : []) {
    const name = tool?.definition?.name;
    if (typeof name !== 'string' || !name || typeof tool.prepare !== 'function') continue;
    if (Object.hasOwn(PREPARE, name) || EXTRA.has(name)) continue;
    EXTRA.set(name, tool);
  }
  const definitions = EXTRA.size ? [...DEFINITIONS, ...[...EXTRA.values()].map((t) => normalizeDefinition(t.definition))] : DEFINITIONS;

  function adaptExtra(tool, input, prepared) {
    if (!prepared || typeof prepared.run !== 'function') throw new ToolError(`Ferramenta ${tool.definition.name} inválida`);
    const category = EXTRA_KINDS.includes(tool.kind) ? tool.kind : 'command';
    const preview = prepared.preview || {};
    const risk = typeof preview.risk === 'string' && preview.risk ? preview.risk : null;
    const name = tool.definition.name;
    let sessionKey;
    if (category === 'write') sessionKey = name;
    else if (category === 'command') sessionKey = `${name}:${JSON.stringify(input)}`;
    return {
      title: prepared.title || name,
      category,
      risky: Boolean(risk),
      riskReason: risk,
      sessionKey,
      preview,
      execute: async ({ onOutput = () => {}, signal } = {}) => {
        const r = (await prepared.run({ signal, onOutput })) || {};
        const summary = typeof r.summary === 'string' ? r.summary : '';
        return {
          ok: r.ok !== false,
          result: typeof r.output === 'string' && r.output ? r.output : (summary || 'ok'),
          summary,
          meta: r.meta || {},
          changed: Array.isArray(r.changed) ? r.changed : [],
        };
      },
    };
  }

  function prepare(name, input) {
    const fn = PREPARE[name];
    const extra = fn ? null : EXTRA.get(name);
    if (!fn && !extra) throw new ToolError(`Ferramenta desconhecida: ${name}`);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolError('Entrada inválida');
    if (Object.hasOwn(input, '__invalid')) throw new ToolError('Argumentos JSON inválidos; envie um objeto JSON válido');
    if (fn) return fn(input);
    const prepared = extra.prepare(input, extraCtx);
    if (prepared && typeof prepared.then === 'function') return prepared.then((p) => adaptExtra(extra, input, p));
    return adaptExtra(extra, input, prepared);
  }

  return { definitions, prepare, root: rootAbs, rel };
}

module.exports = { createToolbox, ToolError, DEFINITIONS, LIMITS, IGNORED_DIRS, globToRegExp, EXTRA_KINDS };
