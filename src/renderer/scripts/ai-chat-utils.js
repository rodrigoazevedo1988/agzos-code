/**
 * Funções puras do painel Agzos IA (sem DOM), testadas em test/unit/ai-chat-utils.test.js.
 */

export const MAX_CONVERSATIONS = 50;
export const MAX_MESSAGES = 200;
export const DEFAULT_TITLE = 'Nova conversa';
const MAX_TITLE = 60;

/** Título curto a partir da primeira mensagem (mesma regra do main/ipc/chat-history.js). */
export function makeTitle(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return DEFAULT_TITLE;
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1).trimEnd()}…` : clean;
}

/**
 * Decide o que uma tecla faz na caixa de mensagem.
 * @returns {'send'|'newline'|null} null = comportamento padrão do textarea.
 */
export function composerKeyAction(event, sendKey = 'enter') {
  if (!event || event.key !== 'Enter' || event.isComposing) return null;
  const mod = !!(event.ctrlKey || event.metaKey);
  if (sendKey === 'ctrlEnter') return mod ? 'send' : null;
  if (event.shiftKey) return 'newline';
  return 'send';
}

/** Dica de atalhos do composer: [{ keys, label }]. */
export function sendHint(sendKey, isMac = false) {
  const mod = isMac ? '⌘' : 'Ctrl';
  return sendKey === 'ctrlEnter'
    ? [{ keys: [mod, 'Enter'], label: 'envia' }, { keys: ['Enter'], label: 'nova linha' }]
    : [{ keys: ['Enter'], label: 'envia' }, { keys: ['Shift', 'Enter'], label: 'nova linha' }];
}

/** Data relativa curta para a lista de conversas. */
export function relativeTime(timestamp, now = Date.now()) {
  const diff = Math.max(0, now - Number(timestamp || 0));
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 7) return `${days} dias`;
  const d = new Date(Number(timestamp));
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Adiciona uma conversa no topo respeitando o limite (descarta as mais antigas). */
export function addConversation(store, conversation) {
  const conversations = [conversation, ...store.conversations.filter((c) => c.id !== conversation.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  return { conversations, activeId: conversation.id };
}

/** Nome do arquivo (último segmento do caminho). */
export function baseName(filePath) {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || '';
}

/* ======================================================================== */
/* Agente — funções puras (estado do turno, diff, persistência)             */
/* ======================================================================== */

export const AGENT_MODES = ['ask', 'edit', 'auto'];
export const DEFAULT_AGENT_MODE = 'edit';
export const AGENT_MODE_INFO = {
  ask: { label: 'Perguntar', icon: 'hand', title: 'Perguntar tudo', desc: 'Pede OK antes de criar, editar, apagar ou rodar comandos.' },
  edit: { label: 'Editar', icon: 'file-pen', title: 'Edição livre', desc: 'Cria e edita arquivos sozinho. Pede OK para apagar, mover e rodar comandos.' },
  auto: { label: 'Auto', icon: 'zap', title: 'Automático', desc: 'Faz tudo sem perguntar. Comandos de risco ainda pedem OK.' },
};

export function normalizeAgentMode(mode) {
  return AGENT_MODES.includes(mode) ? mode : DEFAULT_AGENT_MODE;
}

/** Ferramenta → { icon, verb } para os cartões de passo. */
const TOOL_META = {
  list_dir: { icon: 'folder-tree', verb: 'Listar' },
  read_file: { icon: 'file-text', verb: 'Ler' },
  search: { icon: 'search', verb: 'Buscar' },
  write_file: { icon: 'file-plus', verb: 'Escrever' },
  edit_file: { icon: 'file-pen', verb: 'Editar' },
  create_dir: { icon: 'folder-plus', verb: 'Criar pasta' },
  move_path: { icon: 'folder-input', verb: 'Mover' },
  delete_path: { icon: 'trash', verb: 'Apagar' },
  run_command: { icon: 'square-terminal', verb: 'Rodar' },
};
export function toolMeta(tool) {
  return TOOL_META[tool] || { icon: 'sparkles', verb: String(tool || 'Ferramenta') };
}
export const FILE_TOOLS = new Set(['write_file', 'edit_file', 'create_dir', 'move_path', 'delete_path']);

/** Título legível quando o evento não traz `title`. */
export function stepTitle(tool, input = {}) {
  const { verb } = toolMeta(tool);
  if (tool === 'run_command') return String(input.command || verb);
  if (tool === 'search') return `${verb} "${input.query ?? ''}"`;
  if (tool === 'move_path') return `${verb} ${input.from ?? ''} → ${input.to ?? ''}`;
  const target = input.path ?? input.from ?? '';
  return target ? `${verb} ${target}` : verb;
}

/** Fallback de destaque (o motor decide de verdade; isto só pinta o cartão). */
const RISK_PATTERNS = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  /\bdel\s+\/s\b/i, /\bformat\s+[a-z]:/i, /\bmkfs\b/i, /\bdd\s+[^|]*of=\/dev/i,
  /\bgit\s+push\b[^|]*(--force\b|\s-f\b)/i, /\bgit\s+reset\s+--hard\b/i, /\bgit\s+clean\s+-[a-z]*f/i,
  /\bshutdown\b/i, /\bRemove-Item\b[^|]*-Recurse/i,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, /\b(iwr|Invoke-WebRequest)\b[^|]*\|\s*iex\b/i,
];
export function isRiskyCommand(command) {
  const text = String(command || '');
  return RISK_PATTERNS.some((re) => re.test(text));
}

export function formatDuration(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1000) return `${Math.round(value)} ms`;
  if (value < 60000) return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} s`;
  const min = Math.floor(value / 60000);
  return `${min} min ${Math.round((value % 60000) / 1000)} s`;
}

/** Caminho relativo à raiz do workspace (para exibir); mantém o original se estiver fora. */
export function relativePath(filePath, root) {
  const p = String(filePath || '');
  if (!root) return p;
  const norm = (s) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = norm(root);
  const n = norm(p);
  if (n === r || (/^[a-z]:/i.test(r) && n.toLowerCase() === r.toLowerCase())) return '';
  const sameCase = /^[a-z]:/i.test(r) ? n.toLowerCase().startsWith(`${r.toLowerCase()}/`) : n.startsWith(`${r}/`);
  return sameCase ? n.slice(r.length + 1) : p;
}

/** Tira o prefixo da raiz de caminhos dentro de um texto (ex.: título "Editar /w/src/a.js"). */
export function relativizeText(text, root) {
  const t = String(text ?? '');
  if (!root) return t;
  const r = String(root).replace(/[\\/]+$/, '');
  const escaped = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return t.replace(new RegExp(`${escaped}[\\\\/]`, /^[a-z]:/i.test(r) ? 'gi' : 'g'), '');
}

/** Junta raiz + relativo respeitando o separador da raiz. */
export function joinRoot(root, rel) {
  const p = String(rel || '');
  if (!root || /^([a-z]:[\\/]|[\\/])/i.test(p)) return p;
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}${p.replace(/^[.][\\/]/, '').replace(/[\\/]/g, sep)}`;
}

/* ----------------------------------------------------------------- diff */

function splitLines(text) {
  const s = String(text ?? '');
  if (!s) return [];
  const lines = s.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Diff de linhas (LCS sobre o miolo após cortar prefixo/sufixo comuns).
 * @returns {{ hunks: Array<{ lines: Array<{ type: ' '|'+'|'-', text: string, oldNo?: number, newNo?: number }> }>, added: number, removed: number }}
 */
export function lineDiff(before, after, { context = 2, maxCells = 4_000_000 } = {}) {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const ops = [];
  for (let i = 0; i < start; i++) ops.push({ type: ' ', text: a[i], oldNo: i + 1, newNo: i + 1 });
  const n = midA.length;
  const m = midB.length;
  if (n && m && n * m <= maxCells) {
    // Tabela LCS de baixo para cima (cabe em Uint32: n,m ≤ 4M células).
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = midA[i] === midB[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push({ type: ' ', text: midA[i], oldNo: start + i + 1, newNo: start + j + 1 }); i++; j++; }
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { ops.push({ type: '-', text: midA[i], oldNo: start + i + 1 }); i++; }
      else { ops.push({ type: '+', text: midB[j], newNo: start + j + 1 }); j++; }
    }
    for (; i < n; i++) ops.push({ type: '-', text: midA[i], oldNo: start + i + 1 });
    for (; j < m; j++) ops.push({ type: '+', text: midB[j], newNo: start + j + 1 });
  } else {
    midA.forEach((text, i) => ops.push({ type: '-', text, oldNo: start + i + 1 }));
    midB.forEach((text, j) => ops.push({ type: '+', text, newNo: start + j + 1 }));
  }
  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ type: ' ', text: a[endA + k], oldNo: endA + k + 1, newNo: endB + k + 1 });
  }
  const added = ops.filter((o) => o.type === '+').length;
  const removed = ops.filter((o) => o.type === '-').length;
  // Agrupa em blocos com `context` linhas de contexto ao redor das mudanças.
  const keep = new Uint8Array(ops.length);
  ops.forEach((o, index) => {
    if (o.type === ' ') return;
    for (let k = Math.max(0, index - context); k <= Math.min(ops.length - 1, index + context); k++) keep[k] = 1;
  });
  const hunks = [];
  let current = null;
  ops.forEach((o, index) => {
    if (!keep[index]) { current = null; return; }
    if (!current) { current = { lines: [] }; hunks.push(current); }
    current.lines.push(o);
  });
  return { hunks, added, removed };
}

/* ------------------------------------------------- estado do turno do agente */

export function createAgentTurn(mode = DEFAULT_AGENT_MODE) {
  return { v: 1, mode: normalizeAgentMode(mode), segments: [], steps: {}, done: null, error: null, undone: false, cancelled: false };
}

const MAX_OUTPUT = 64 * 1024;

/**
 * Aplica um evento do motor ao turno (mutação in-place).
 * @returns {{ kind: 'text'|'step'|'done'|'error'|'file'|null, callId?: string }}
 */
export function applyAgentEvent(turn, evt) {
  if (!turn || !evt || typeof evt !== 'object') return { kind: null };
  const ensureStep = (callId, tool, input) => {
    let step = turn.steps[callId];
    if (!step) {
      step = { callId, tool: tool || '', input: input || {}, title: '', status: 'running', summary: '', meta: null, output: '' };
      turn.steps[callId] = step;
      turn.segments.push({ t: 'step', id: callId });
    }
    return step;
  };
  switch (evt.type) {
    case 'text': {
      const delta = String(evt.delta ?? '');
      if (!delta) return { kind: null };
      const last = turn.segments.at(-1);
      if (last?.t === 'text') last.text += delta;
      else turn.segments.push({ t: 'text', text: delta });
      return { kind: 'text' };
    }
    case 'tool_start': {
      const step = ensureStep(evt.callId, evt.tool, evt.input);
      step.tool = evt.tool || step.tool;
      step.input = evt.input || step.input;
      step.title = evt.title || step.title || stepTitle(step.tool, step.input);
      if (step.status !== 'awaiting') step.status = 'running';
      step.startedAt = step.startedAt || Date.now();
      return { kind: 'step', callId: evt.callId };
    }
    case 'approval': {
      const step = ensureStep(evt.callId, evt.tool, evt.input);
      if (!step.title) step.title = stepTitle(step.tool, step.input);
      step.status = 'awaiting';
      const preview = evt.preview || {};
      step.approval = { preview, risky: !!(evt.risky || preview.risky), reason: evt.reason || preview.reason || '' };
      return { kind: 'step', callId: evt.callId };
    }
    case 'tool_output': {
      const step = turn.steps[evt.callId];
      if (!step) return { kind: null };
      step.output = (step.output + String(evt.chunk ?? '')).slice(-MAX_OUTPUT);
      if (step.status === 'awaiting') { step.status = 'running'; step.approval = null; }
      return { kind: 'output', callId: evt.callId };
    }
    case 'tool_end': {
      const step = ensureStep(evt.callId, evt.tool, evt.input);
      const denied = evt.denied === true || evt.meta?.denied === true || evt.decision === 'deny';
      const cancelled = evt.ok === false && /^(cancelado|interrompido)$/i.test(String(evt.summary || '').trim());
      step.status = denied ? 'denied' : cancelled ? 'cancelled' : (evt.ok === false ? 'error' : 'ok');
      step.summary = String(evt.summary ?? '');
      step.meta = evt.meta || null;
      step.approval = null;
      if (step.startedAt && step.status !== 'denied' && step.meta && Number.isFinite(step.meta.exitCode) && !Number.isFinite(step.meta.durationMs)) {
        step.elapsedMs = Date.now() - step.startedAt;
      }
      return { kind: 'step', callId: evt.callId };
    }
    case 'file_changed':
      return { kind: 'file' };
    case 'done': {
      turn.done = {
        checkpointId: evt.checkpointId || null,
        changes: Array.isArray(evt.changes) ? evt.changes : [],
        steps: Number(evt.steps) || Object.keys(turn.steps).length,
      };
      settleSteps(turn);
      return { kind: 'done' };
    }
    case 'error': {
      turn.error = { message: String(evt.message || 'Erro no agente.'), code: evt.code || null };
      // Erro/cancelamento no meio: o que já mudou continua desfazível.
      if (evt.checkpointId) {
        turn.done = { checkpointId: evt.checkpointId, changes: Array.isArray(evt.changes) ? evt.changes : [], steps: Number(evt.steps) || 0, partial: true };
      }
      settleSteps(turn, evt.code === 'cancelled' ? 'cancelled' : 'error');
      return { kind: 'error' };
    }
    default:
      return { kind: null };
  }
}

/** Passos ainda abertos quando o turno termina. */
export function settleSteps(turn, status = 'cancelled') {
  for (const step of Object.values(turn.steps)) {
    if (step.status === 'running' || step.status === 'awaiting') { step.status = status; step.approval = null; }
  }
}

/** Texto do turno (todos os trechos de prosa, na ordem). */
export function agentTurnText(turn) {
  return turn.segments.filter((s) => s.t === 'text').map((s) => s.text.trim()).filter(Boolean).join('\n\n');
}

/** Alterações para o resumo: as do `done`, ou derivadas dos passos se o turno não terminou. */
export function agentChanges(turn) {
  if (turn.done?.changes?.length) return turn.done.changes;
  const byPath = new Map();
  for (const step of Object.values(turn.steps)) {
    if (step.status !== 'ok' || !FILE_TOOLS.has(step.tool) || !step.meta?.path) continue;
    const prev = byPath.get(step.meta.path) || { path: step.meta.path, added: 0, removed: 0 };
    prev.added += Number(step.meta.added) || 0;
    prev.removed += Number(step.meta.removed) || 0;
    if (step.meta.created) prev.created = true;
    if (step.meta.deleted) prev.deleted = true;
    byPath.set(step.meta.path, prev);
  }
  return [...byPath.values()];
}

const STATUS_MARK = { ok: '✓', error: '✗', denied: '⊘', cancelled: '–', running: '…', awaiting: '?' };

/** Resumo legível (markdown) das ações — vai no histórico e para o modelo nos próximos turnos. */
export function agentSummaryText(turn, root = null) {
  const steps = Object.values(turn.steps);
  if (!steps.length && !turn.error) return '';
  const lines = [];
  if (steps.length) {
    lines.push(`**Ações do agente** (${steps.length} ${steps.length === 1 ? 'passo' : 'passos'}${turn.undone ? ', desfeitas' : ''})`);
    for (const step of steps) {
      let detail = '';
      if (step.meta && (step.meta.added || step.meta.removed)) detail = ` (+${step.meta.added || 0} −${step.meta.removed || 0})`;
      else if (step.meta && Number.isFinite(step.meta.exitCode)) detail = ` (exit ${step.meta.exitCode})`;
      if (step.status === 'denied') detail += ' — negado';
      const title = relativizeText(step.title || stepTitle(step.tool, step.input), root).replace(/`/g, "'");
      lines.push(`- ${STATUS_MARK[step.status] || '·'} \`${title}\`${detail}`);
    }
  }
  if (turn.error && turn.error.code !== 'cancelled') lines.push(`\n_Erro: ${turn.error.message}_`);
  if (turn.cancelled || turn.error?.code === 'cancelled') lines.push('\n_(interrompido)_');
  return lines.join('\n');
}

/* ------------------------------------------------------- persistência */

const MARKER_RE = /\n*<!--agzos-agent (\{[\s\S]*?\})-->\n*/;

function clip(value, max) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Versão enxuta do turno para salvar (sem previews, saídas e inputs cortados). */
export function compactAgentTurn(turn) {
  const steps = {};
  for (const [id, step] of Object.entries(turn.steps)) {
    const input = {};
    for (const [key, value] of Object.entries(step.input || {})) {
      input[key] = typeof value === 'string' ? clip(value, key === 'content' || key.endsWith('_string') ? 200 : 400) : value;
    }
    steps[id] = {
      callId: id, tool: step.tool, title: step.title, input, status: step.status,
      summary: clip(step.summary, 400), meta: step.meta || null, output: step.output ? clip(step.output.slice(-4000), 4000) : '',
      elapsedMs: step.elapsedMs,
    };
  }
  return {
    v: 1, mode: turn.mode, segments: turn.segments.map((s) => (s.t === 'text' ? { t: 'text', text: s.text } : { t: 'step', id: s.id })),
    steps, done: turn.done, error: turn.error, undone: !!turn.undone, cancelled: !!turn.cancelled,
  };
}

/**
 * Conteúdo salvo de uma resposta do agente: prosa + marcador com o turno + resumo legível.
 * O marcador é um comentário HTML (o JSON nunca contém "--" fora de strings, e dentro
 * delas o escapamos), então o resumo continua legível em qualquer leitor do histórico.
 */
export function encodeAgentContent(turn, root = null) {
  const text = agentTurnText(turn);
  const json = JSON.stringify(compactAgentTurn(turn)).replace(/--/g, '-\\u002d');
  const summary = agentSummaryText(turn, root);
  return [text, `<!--agzos-agent ${json}-->`, summary].filter(Boolean).join('\n\n');
}

/** Separa o conteúdo salvo: { text, turn|null, summary }. */
export function decodeAgentContent(content) {
  const s = String(content ?? '');
  const match = s.match(MARKER_RE);
  if (!match) return { text: s, turn: null, summary: '' };
  let turn = null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && parsed.v === 1 && Array.isArray(parsed.segments) && parsed.steps && typeof parsed.steps === 'object') turn = parsed;
  } catch { /* marcador corrompido: mostra o texto */ }
  return { text: s.slice(0, match.index), turn, summary: s.slice(match.index + match[0].length) };
}

/** Conteúdo enviado ao modelo: sem o marcador (prosa + resumo legível). */
export function stripAgentMarker(content) {
  return String(content ?? '').replace(MARKER_RE, '\n\n').trim();
}
