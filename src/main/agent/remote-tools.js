/**
 * Ferramentas do agente na pasta remota (ssh://): mesma API e mesmas regras do
 * toolbox local (agent/tools.js) — definições, limites, categorias (risco e
 * aprovação), máscara de .env e redação de segredos —, mas cada operação passa
 * pelo provider SSH da janela (SFTP para arquivos; exec com aspas POSIX para
 * busca e run_command). Os originais vão para o checkpoint local (recordRemote)
 * antes de qualquer mudança no host.
 */

const path = require('path');
const { DEFINITIONS, LIMITS, IGNORED_DIRS, ToolError, isSecretEnvFile, maskEnvText, EXTRA_KINDS } = require('./tools');
const { assessCommand } = require('./risk');
const { lineStats, truncateMiddle, stripAnsi, redact, SECRET_NAME } = require('./text');
const { redactSecrets, isPlaceholder, shannon } = require('../modules/envvault/detect');
const { _scan: scanEnv } = require('../modules/envvault/parse');
const { parseRemoteUri, toRemoteUri, isWithinRemote } = require('../workspace/remote-uri');
const remoteSearch = require('../remote/search');

function isBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function normalizeDefinition(def) {
  const schema = def.parameters || def.input_schema || { type: 'object', properties: {} };
  const out = { ...def, parameters: schema };
  delete out.input_schema;
  return out;
}

function createRemoteToolbox({ root, provider, checkpoint, secrets = [], extraTools = [] }) {
  const parsed = parseRemoteUri(root);
  if (!parsed) throw new Error(`Raiz remota inválida: ${root}`);
  const { authority } = parsed;
  const rootUri = toRemoteUri(authority, parsed.path);
  const rootPath = parsed.path;

  const rel = (uri) => (path.posix.relative(rootPath, parseRemoteUri(uri).path) || '.');

  // Segredos: os conhecidos + valores dos .env* da raiz no host (carregados uma vez).
  let secretsP = null;
  function loadSecrets() {
    if (!secretsP) {
      secretsP = (async () => {
        const values = [...(secrets || [])];
        try {
          const list = await provider.readDir(rootUri);
          for (const e of list.filter((d) => !d.isDirectory && isSecretEnvFile(d.name)).slice(0, 20)) {
            try {
              const st = await provider.stat(e.path);
              if (st.size > 1024 * 1024) continue;
              for (const v of scanEnv(await provider.readFile(e.path, 'utf8'))) {
                const val = v.value;
                if (typeof val !== 'string' || val.length < 8 || isPlaceholder(val)) continue;
                if (SECRET_NAME.test(v.key) || (val.length >= 16 && shannon(val) >= 3.5)) values.push(val);
              }
            } catch { /* ilegível */ }
          }
        } catch { /* sem acesso à raiz */ }
        return [...new Set(values)].sort((a, b) => b.length - a.length);
      })();
    }
    return secretsP;
  }
  const scrubWith = (all, text) => redactSecrets(redact(text, all));

  function resolvePath(p, field = 'path') {
    if (typeof p !== 'string' || !p.trim()) throw new ToolError(`Parâmetro "${field}" obrigatório`);
    if (p.includes('\0')) throw new ToolError(`Caminho inválido: ${p}`);
    const raw = p.trim().replace(/\\/g, '/');
    let target;
    if (raw.startsWith('ssh://')) target = raw;
    else {
      const joined = path.posix.normalize(raw.startsWith('/') ? raw : path.posix.join(rootPath, raw));
      target = toRemoteUri(authority, joined);
    }
    const ok = parseRemoteUri(target) && isWithinRemote(rootUri, target);
    if (!ok) throw new ToolError(`Acesso negado: ${p} está fora da pasta do projeto`);
    return toRemoteUri(authority, parseRemoteUri(target).path);
  }

  function notRoot(uri, p) {
    if (uri === rootUri) throw new ToolError(`Operação não permitida na raiz do projeto: ${p}`);
  }

  const statOrNull = async (uri) => { try { return await provider.stat(uri); } catch { return null; } };

  async function readTextFile(uri) {
    const buf = await provider.readFile(uri);
    if (isBinary(buf)) throw new ToolError(`Arquivo binário: ${rel(uri)}`);
    return buf.toString('utf8');
  }

  async function ensureParents(uri) {
    const missing = [];
    let cur = toRemoteUri(authority, path.posix.dirname(parseRemoteUri(uri).path));
    while (cur !== rootUri && isWithinRemote(rootUri, cur) && !(await statOrNull(cur))) {
      missing.push(cur);
      cur = toRemoteUri(authority, path.posix.dirname(parseRemoteUri(cur).path));
    }
    for (const p of missing) await checkpoint?.recordRemote?.(p, provider);
    if (missing.length) await provider.mkdir(missing[0]);
  }

  // ---------------------------------------------------------------- leitura
  async function listDir(input) {
    const uri = resolvePath(input.path ?? '.');
    const st = await statOrNull(uri);
    if (!st) throw new ToolError(`Não encontrado: ${input.path}`);
    if (!st.isDirectory) throw new ToolError(`Não é uma pasta: ${input.path}`);
    const depth = Math.min(LIMITS.listDepth, Math.max(1, Number.parseInt(input.depth, 10) || 1));
    return {
      title: `Listar ${rel(uri)}`,
      category: 'read',
      execute: async () => {
        const lines = [];
        let truncated = false;
        const walk = async (dir, level) => {
          let names;
          try { names = await provider.readDir(dir); } catch { return; }
          names.sort((a, b) => (b.isDirectory - a.isDirectory) || a.name.localeCompare(b.name));
          for (const d of names) {
            if (lines.length >= LIMITS.listEntries) { truncated = true; return; }
            const indent = '  '.repeat(level);
            if (d.isDirectory) {
              const ignored = IGNORED_DIRS.has(d.name);
              lines.push(`${indent}${d.name}/${ignored ? ' (não expandido)' : ''}`);
              if (!ignored && level + 1 < depth) await walk(d.path, level + 1);
            } else {
              const s = await statOrNull(d.path);
              lines.push(`${indent}${d.name}${s ? ` (${formatSize(s.size)})` : ''}`);
            }
          }
        };
        await walk(uri, 0);
        if (truncated) lines.push(`[... lista truncada em ${LIMITS.listEntries} itens ...]`);
        return { ok: true, result: lines.length ? lines.join('\n') : '(pasta vazia)', summary: `${lines.length} itens`, meta: { path: uri, count: lines.length } };
      },
    };
  }

  async function readFile(input) {
    const uri = resolvePath(input.path);
    const st = await statOrNull(uri);
    if (!st) throw new ToolError(`Arquivo não encontrado: ${input.path}`);
    if (st.isDirectory) throw new ToolError(`É uma pasta, use list_dir: ${input.path}`);
    const offset = Math.max(1, Number.parseInt(input.offset, 10) || 1);
    const limit = Math.min(LIMITS.readLines, Math.max(1, Number.parseInt(input.limit, 10) || LIMITS.readLines));
    return {
      title: `Ler ${rel(uri)}`,
      category: 'read',
      execute: async () => {
        const raw = await readTextFile(uri);
        const text = isSecretEnvFile(path.posix.basename(uri)) ? maskEnvText(raw) : raw;
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
        return { ok: true, result, summary: `${Math.max(0, last - offset + 1)} linhas`, meta: { path: uri, lines: all.length } };
      },
    };
  }

  async function search(input) {
    if (typeof input.query !== 'string' || !input.query) throw new ToolError('Parâmetro "query" obrigatório');
    if (input.regex) {
      try { new RegExp(input.query); } catch (err) { throw new ToolError(`Regex inválida: ${err.message}`); }
    }
    return {
      title: `Buscar “${input.query.slice(0, 60)}”`,
      category: 'read',
      execute: async ({ signal } = {}) => {
        const script = remoteSearch.buildSearchScript(rootPath, input.query, LIMITS.searchResults, {
          ignoreCase: !input.regex, regex: !!input.regex, glob: typeof input.glob === 'string' ? input.glob.replace(/^\.\//, '') : null,
        });
        const res = await provider.execRaw(script, { timeoutMs: 120_000, signal });
        const hits = remoteSearch.parseSearchOutput(res.stdout, LIMITS.searchResults);
        const all = await loadSecrets();
        const results = hits.map((h) => {
          const text = isSecretEnvFile(path.posix.basename(h.rel)) ? maskEnvText(h.text) : h.text;
          return `${h.rel}:${h.line}: ${scrubWith(all, text).slice(0, 300)}`;
        });
        let result = results.length ? results.join('\n') : 'Nenhum resultado.';
        if (results.length >= LIMITS.searchResults) result += `\n[resultados truncados em ${LIMITS.searchResults}]`;
        return { ok: true, result, summary: `${results.length} resultados`, meta: { count: results.length } };
      },
    };
  }

  // ----------------------------------------------------------------- escrita
  async function writeFile(input) {
    const uri = resolvePath(input.path);
    if (typeof input.content !== 'string') throw new ToolError('Parâmetro "content" deve ser texto');
    const st = await statOrNull(uri);
    if (st && st.isDirectory) throw new ToolError(`É uma pasta: ${input.path}`);
    const before = st ? await readTextFile(uri) : null;
    const created = !st;
    return {
      title: `${created ? 'Criar' : 'Escrever'} ${rel(uri)}`,
      category: 'write',
      sessionKey: 'write_file',
      preview: { diff: { path: uri, before: before ?? '', after: input.content } },
      execute: async () => {
        await checkpoint?.recordRemote?.(uri, provider);
        await ensureParents(uri);
        await provider.writeFile(uri, input.content);
        checkpoint?.noteRemote?.(uri, input.content);
        const stats = lineStats(before, input.content);
        const meta = { path: uri, ...stats };
        if (created) meta.created = true;
        return {
          ok: true,
          result: `${created ? 'Arquivo criado' : 'Arquivo sobrescrito'}: ${rel(uri)} (+${stats.added} −${stats.removed})`,
          summary: `+${stats.added} −${stats.removed}`,
          meta,
          changed: [uri],
        };
      },
    };
  }

  async function editFile(input) {
    const uri = resolvePath(input.path);
    const st = await statOrNull(uri);
    if (!st) throw new ToolError(`Arquivo não encontrado: ${input.path} (use write_file para criar)`);
    if (st.isDirectory) throw new ToolError(`É uma pasta: ${input.path}`);
    if (typeof input.old_string !== 'string' || !input.old_string) throw new ToolError('Parâmetro "old_string" obrigatório e não vazio');
    if (typeof input.new_string !== 'string') throw new ToolError('Parâmetro "new_string" deve ser texto');
    if (input.old_string === input.new_string) throw new ToolError('old_string e new_string são iguais');
    const before = await readTextFile(uri);
    let oldStr = input.old_string;
    let newStr = input.new_string;
    const count = (s) => (s ? before.split(s).length - 1 : 0);
    let n = count(oldStr);
    if (n === 0 && before.includes('\r\n') && !oldStr.includes('\r\n')) {
      oldStr = oldStr.replace(/\n/g, '\r\n');
      newStr = newStr.replace(/\r?\n/g, '\r\n');
      n = count(oldStr);
    }
    if (n === 0) throw new ToolError(`old_string não encontrado em ${rel(uri)}. Leia o arquivo de novo e copie o trecho exato.`);
    if (n > 1 && !input.replace_all) {
      throw new ToolError(`old_string aparece ${n} vezes em ${rel(uri)}; inclua mais contexto para torná-lo único ou use replace_all.`);
    }
    let after;
    if (input.replace_all) after = before.split(oldStr).join(newStr);
    else {
      const i = before.indexOf(oldStr);
      after = before.slice(0, i) + newStr + before.slice(i + oldStr.length);
    }
    return {
      title: `Editar ${rel(uri)}`,
      category: 'write',
      sessionKey: 'edit_file',
      preview: { diff: { path: uri, before, after } },
      execute: async () => {
        const current = await readTextFile(uri);
        if (current !== before) throw new ToolError(`${rel(uri)} mudou desde a leitura; leia de novo`);
        await checkpoint?.recordRemote?.(uri, provider);
        await provider.writeFile(uri, after);
        checkpoint?.noteRemote?.(uri, after);
        const stats = lineStats(before, after);
        return {
          ok: true,
          result: `Editado: ${rel(uri)} (${n} ocorrência${n > 1 ? 's' : ''}; +${stats.added} −${stats.removed})`,
          summary: `+${stats.added} −${stats.removed}`,
          meta: { path: uri, ...stats },
          changed: [uri],
        };
      },
    };
  }

  async function createDir(input) {
    const uri = resolvePath(input.path);
    const st = await statOrNull(uri);
    if (st && !st.isDirectory) throw new ToolError(`Já existe um arquivo com esse nome: ${input.path}`);
    return {
      title: `Criar pasta ${rel(uri)}`,
      category: 'write',
      sessionKey: 'create_dir',
      preview: { path: uri, kind: 'create_dir' },
      execute: async () => {
        if ((await statOrNull(uri))?.isDirectory) {
          return { ok: true, result: `A pasta já existe: ${rel(uri)}`, summary: 'já existia', meta: { path: uri, added: 0, removed: 0 } };
        }
        await checkpoint?.recordRemote?.(uri, provider);
        await ensureParents(uri);
        await provider.mkdir(uri);
        return { ok: true, result: `Pasta criada: ${rel(uri)}`, summary: 'criada', meta: { path: uri, added: 0, removed: 0, created: true }, changed: [uri] };
      },
    };
  }

  async function movePath(input) {
    const from = resolvePath(input.from, 'from');
    const to = resolvePath(input.to, 'to');
    notRoot(from, input.from);
    notRoot(to, input.to);
    const st = await statOrNull(from);
    if (!st) throw new ToolError(`Origem não encontrada: ${input.from}`);
    if (await statOrNull(to)) throw new ToolError(`Destino já existe: ${input.to}`);
    if (isWithinRemote(from, to)) throw new ToolError('Não é possível mover uma pasta para dentro dela mesma');
    return {
      title: `Mover ${rel(from)} → ${rel(to)}`,
      category: 'destructive',
      sessionKey: 'move_path',
      preview: { path: from, to, kind: 'move', isDir: st.isDirectory },
      execute: async () => {
        await checkpoint?.recordRemoteTree?.(from, provider);
        await checkpoint?.recordRemote?.(to, provider);
        await ensureParents(to);
        await provider.rename(from, to);
        return {
          ok: true, result: `Movido: ${rel(from)} → ${rel(to)}`, summary: 'movido',
          meta: { path: to, from, added: 0, removed: 0, moved: true }, changed: [from, to],
        };
      },
    };
  }

  async function deletePath(input) {
    const uri = resolvePath(input.path);
    notRoot(uri, input.path);
    const st = await statOrNull(uri);
    if (!st) throw new ToolError(`Não encontrado: ${input.path}`);
    return {
      title: `Apagar ${rel(uri)}`,
      category: 'destructive',
      sessionKey: 'delete_path',
      preview: { path: uri, kind: 'delete', isDir: st.isDirectory },
      execute: async () => {
        let removed = 0;
        if (!st.isDirectory) {
          try { removed = lineStats(await readTextFile(uri), null).removed; } catch {}
        }
        await checkpoint?.recordRemoteTree?.(uri, provider);
        await provider.remove(uri);
        checkpoint?.noteRemote?.(uri, null);
        return {
          ok: true, result: `Apagado: ${rel(uri)}`, summary: 'apagado',
          meta: { path: uri, added: 0, removed, deleted: true }, changed: [uri],
        };
      },
    };
  }

  // ----------------------------------------------------------------- comando
  async function command(input) {
    if (typeof input.command !== 'string' || !input.command.trim()) throw new ToolError('Parâmetro "command" obrigatório');
    const cwd = resolvePath(input.cwd ?? '.', 'cwd');
    if (!(await statOrNull(cwd))?.isDirectory) throw new ToolError(`cwd não é uma pasta: ${input.cwd}`);
    const timeoutS = Math.min(LIMITS.commandTimeoutMax,
      Math.max(1, Number.parseInt(input.timeout_s, 10) || LIMITS.commandTimeoutDefault));
    const risk = assessCommand(input.command);
    const cmd = input.command.trim();
    return {
      title: `Executar ${cmd.length > 80 ? `${cmd.slice(0, 77)}…` : cmd}`,
      category: 'command',
      risky: risk.risky,
      riskReason: risk.reason,
      sessionKey: `run_command:${cmd}`,
      preview: { command: cmd, cwd, risky: risk.risky, reason: risk.reason },
      execute: async ({ onOutput = () => {}, signal } = {}) => {
        const all = await loadSecrets();
        const started = Date.now();
        let res;
        let cancelled = false;
        try {
          // O comando do agente vai inteiro como UM argumento de `sh -c` (entre aspas).
          res = await provider.exec('sh', ['-c', cmd], {
            cwd, timeoutMs: timeoutS * 1000, signal,
            onData: (chunk) => { const clean = redact(stripAnsi(chunk), all); if (clean) onOutput(clean); },
          });
        } catch (err) {
          if (err?.name !== 'AbortError') throw err;
          cancelled = true;
          res = { code: null, stdout: '', stderr: '' };
        }
        const output = redact(stripAnsi(`${res.stdout}${res.stderr}`), all);
        const exitCode = res.code;
        let header = `exit code: ${exitCode} (${((Date.now() - started) / 1000).toFixed(1)}s) — no host remoto`;
        if (res.timedOut) header += ` — tempo esgotado após ${timeoutS}s; processo encerrado`;
        if (cancelled) header += ' — cancelado pelo usuário';
        const body = output.trim() ? truncateMiddle(output, LIMITS.commandOutput) : '(sem saída)';
        return {
          ok: exitCode === 0 && !res.timedOut && !cancelled,
          result: `${header}\n${body}`,
          summary: res.timedOut ? 'tempo esgotado' : `exit ${exitCode}`,
          meta: { exitCode, durationMs: Date.now() - started, timedOut: res.timedOut || undefined },
        };
      },
    };
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

  // Ferramentas extras: só as que não mexem no disco local (ex.: terminal/problemas do renderer).
  const EXTRA = new Map();
  for (const tool of Array.isArray(extraTools) ? extraTools : []) {
    const name = tool?.definition?.name;
    if (typeof name !== 'string' || !name || typeof tool.prepare !== 'function') continue;
    if (Object.hasOwn(PREPARE, name) || EXTRA.has(name)) continue;
    EXTRA.set(name, tool);
  }
  const definitions = EXTRA.size ? [...DEFINITIONS, ...[...EXTRA.values()].map((t) => normalizeDefinition(t.definition))] : DEFINITIONS;
  const extraCtx = { resolvePath, rel, checkpoint, readTextFile, root: rootUri, remote: true };

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
      title: prepared.title || name, category, risky: Boolean(risk), riskReason: risk, sessionKey, preview,
      execute: async ({ onOutput = () => {}, signal } = {}) => {
        const all = await loadSecrets();
        const r = (await prepared.run({ signal, onOutput: (chunk) => onOutput(scrubWith(all, chunk)) })) || {};
        const summary = typeof r.summary === 'string' ? scrubWith(all, r.summary) : '';
        return {
          ok: r.ok !== false,
          result: typeof r.output === 'string' && r.output ? scrubWith(all, r.output) : (summary || 'ok'),
          summary, meta: r.meta || {}, changed: Array.isArray(r.changed) ? r.changed : [],
        };
      },
    };
  }

  async function prepare(name, input) {
    const fn = PREPARE[name];
    const extra = fn ? null : EXTRA.get(name);
    if (!fn && !extra) throw new ToolError(`Ferramenta desconhecida: ${name}`);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolError('Entrada inválida');
    if (Object.hasOwn(input, '__invalid')) throw new ToolError('Argumentos JSON inválidos; envie um objeto JSON válido');
    if (fn) return fn(input);
    return adaptExtra(extra, input, await extra.prepare(input, extraCtx));
  }

  return { definitions, prepare, root: rootUri, rel, remote: true };
}

module.exports = { createRemoteToolbox };
