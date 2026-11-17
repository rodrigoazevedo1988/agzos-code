/**
 * Agzos IA — interface do modo agente (cartões de passo, aprovação, resumo).
 *
 * Só DOM: o estado do turno vem de ai-chat-utils.js (applyAgentEvent) e as
 * ações (aprovar, abrir arquivo, desfazer…) são callbacks passados por
 * ai-chat.js. Uma TurnView mantém os nós estáveis entre eventos para não
 * perder foco, rolagem da saída de comando ou o estado expandido.
 */
import { renderMarkdown } from './markdown.js';
import { lucideIcon } from './lucide.js';
import {
  toolMeta, lineDiff, formatDuration, relativePath, relativizeText, agentChanges, isRiskyCommand, baseName, FILE_TOOLS,
} from './ai-chat-utils.js';

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child);
  return el;
}
const icon = (name, size = 14) => lucideIcon(name, { size, strokeWidth: 1.75 });

const STATUS_LABEL = {
  running: 'Em andamento', awaiting: 'Aguardando sua aprovação', ok: 'Concluído', error: 'Falhou', denied: 'Negado', cancelled: 'Interrompido',
};
const MAX_DIFF_LINES = 400;

/* ------------------------------------------------------------ pedaços */

function statusGlyph(status) {
  const map = { ok: 'check', error: 'x', denied: 'ban', cancelled: 'circle-slash', awaiting: 'hand' };
  if (status === 'running') return h('span', { class: 'ag-spin', 'aria-hidden': 'true' });
  return icon(map[status] || 'circle-dashed', 11);
}

function delta(added, removed, { created, deleted } = {}) {
  const parts = [];
  if (created) parts.push(h('span', { class: 'ag-tag ag-tag-new', text: 'novo' }));
  if (deleted) parts.push(h('span', { class: 'ag-tag ag-tag-del', text: 'apagado' }));
  if (Number(added) > 0) parts.push(h('span', { class: 'ag-add', text: `+${added}` }));
  if (Number(removed) > 0) parts.push(h('span', { class: 'ag-del', text: `−${removed}` }));
  return parts;
}

/** Título com o alvo (caminho/comando) em mono. */
function titleNodes(step, root) {
  const { verb } = toolMeta(step.tool);
  const raw = relativizeText(step.title || verb, root);
  if (step.tool === 'run_command') return [h('code', { class: 'ag-target', text: step.input?.command || raw })];
  // "Editar src/app.js" → verbo + alvo
  const target = raw.startsWith(`${verb} `) ? raw.slice(verb.length + 1) : null;
  if (target) return [h('span', { class: 'ag-verb', text: verb }), h('code', { class: 'ag-target', text: relativePath(target, root) })];
  const spaced = raw.match(/^(\S+(?:\s\S+)?)\s+(.+[./\\].*)$/);
  if (spaced) return [h('span', { class: 'ag-verb', text: spaced[1] }), h('code', { class: 'ag-target', text: spaced[2] })];
  return [h('span', { class: 'ag-verb', text: raw })];
}

function stepMeta(step) {
  const m = step.meta || {};
  if (step.tool === 'run_command') {
    const bits = [];
    if (Number.isFinite(m.exitCode)) bits.push(h('span', { class: m.exitCode === 0 ? 'ag-exit ok' : 'ag-exit bad', text: `exit ${m.exitCode}` }));
    const ms = m.durationMs ?? step.elapsedMs;
    if (Number.isFinite(ms) && step.status !== 'running') bits.push(h('span', { class: 'ag-dim', text: formatDuration(ms) }));
    return bits;
  }
  if (FILE_TOOLS.has(step.tool) && (m.added || m.removed || m.created || m.deleted)) return delta(m.added, m.removed, m);
  if (step.status === 'denied') return [h('span', { class: 'ag-dim', text: 'negado' })];
  return [];
}

export function diffElement(before, after, { maxLines = MAX_DIFF_LINES } = {}) {
  const { hunks, added, removed } = lineDiff(before, after);
  const body = h('div', { class: 'ag-diff-body' });
  let shown = 0;
  let truncated = false;
  hunks.forEach((hunk, index) => {
    if (truncated) return;
    if (index > 0) body.append(h('div', { class: 'ag-diff-gap', 'aria-hidden': 'true', text: '⋯' }));
    for (const line of hunk.lines) {
      if (shown >= maxLines) { truncated = true; break; }
      shown++;
      const kind = line.type === '+' ? 'add' : line.type === '-' ? 'del' : 'ctx';
      body.append(h('div', { class: `ag-diff-line is-${kind}` },
        h('span', { class: 'ag-diff-no', text: String(line.type === '+' ? line.newNo : line.oldNo ?? '') }),
        h('span', { class: 'ag-diff-sign', text: line.type === ' ' ? '' : line.type === '-' ? '−' : '+' }),
        h('span', { class: 'ag-diff-text', text: line.text || ' ' })));
    }
  });
  if (!hunks.length) body.append(h('div', { class: 'ag-diff-empty', text: 'Sem diferenças de conteúdo.' }));
  if (truncated) body.append(h('div', { class: 'ag-diff-more', text: 'Diff longo — abra em "Ver diff" para ver tudo.' }));
  const el = h('div', { class: 'ag-diff', role: 'region', 'aria-label': `Diferenças: ${added} linhas adicionadas, ${removed} removidas` }, body);
  return { el, added, removed };
}

function previewDiff(step) {
  return step.approval?.preview?.diff || step.preview?.diff || (step.meta?.before != null || step.meta?.after != null
    ? { path: step.meta.path, before: step.meta.before ?? '', after: step.meta.after ?? '' } : null);
}

/** Mensagem do usuário enviada durante a execução ("Enviar agora"). */
function steerElement(seg) {
  return h('div', { class: 'ag-steer', 'data-steer-id': seg.id || null },
    h('div', { class: 'ag-steer-bubble', text: seg.text || '' }),
    h('span', { class: 'ag-steer-badge' }, icon('corner-down-right', 11), h('span', { text: 'enviada durante a execução' })));
}

/* ------------------------------------------------------------ aprovação */

function approvalElement(step, ctx) {
  const preview = step.approval?.preview || {};
  const command = preview.command ?? step.input?.command;
  const risky = !!(step.approval?.risky || preview.risky || preview.risk
    || (step.tool === 'run_command' && isRiskyCommand(command)));
  const reason = step.approval?.reason || preview.reason || '';
  const diff = preview.diff;
  const root = ctx.root;
  let question = 'Permitir esta ação?';
  let body = null;
  let target = '';
  if (diff) {
    target = relativePath(diff.path || step.input?.path || '', root);
    const creating = diff.before == null || diff.before === '';
    question = creating ? 'Criar este arquivo?' : 'Aplicar esta edição?';
    body = diffElement(diff.before ?? '', diff.after ?? '', { maxLines: 120 }).el;
  } else if (step.tool === 'run_command' || command != null) {
    question = risky ? 'Comando de risco. Rodar mesmo assim?' : 'Rodar este comando?';
    const cwd = relativePath(preview.cwd ?? step.input?.cwd ?? '', root);
    body = h('div', { class: 'ag-cmd' },
      h('div', { class: 'ag-cmd-line' }, h('span', { class: 'ag-cmd-prompt', 'aria-hidden': 'true', text: '$' }), h('code', { text: command || '' })),
      cwd ? h('div', { class: 'ag-cmd-cwd' }, icon('folder', 11), h('span', { text: cwd })) : null,
      risky && reason ? h('div', { class: 'ag-risk-reason' }, icon('triangle-alert', 11), h('span', { text: `Bate na lista de risco: ${reason}` })) : null);
  } else if (preview.path || step.input?.path || step.input?.from) {
    const kind = preview.kind || (step.tool === 'move_path' ? 'move' : step.tool === 'delete_path' ? 'delete' : '');
    const from = relativePath(preview.path || step.input?.path || step.input?.from, root);
    if (kind === 'create_dir' || step.tool === 'create_dir') {
      question = 'Criar esta pasta?';
      body = h('div', { class: 'ag-cmd' }, h('div', { class: 'ag-move' }, icon('folder-plus', 12), h('code', { text: from })));
    } else if (kind === 'move' || step.tool === 'move_path') {
      question = 'Mover este caminho?';
      body = h('div', { class: 'ag-cmd' }, h('div', { class: 'ag-move' },
        h('code', { text: from }), icon('arrow-right', 12), h('code', { text: relativePath(preview.to || step.input?.to || '', root) })));
    } else {
      question = 'Apagar este caminho?';
      body = h('div', { class: 'ag-cmd' }, h('div', { class: 'ag-move is-delete' }, icon('trash', 12), h('code', { text: from })));
    }
  }
  const decide = (decision) => (event) => { event?.stopPropagation(); ctx.approve(step.callId, decision); };
  const card = h('div', {
    class: `ag-approval${risky ? ' is-risk' : ''}`, role: 'group', tabindex: '0',
    'aria-label': `${question} ${relativizeText(step.title || '', root)}. Enter permite, Esc nega.`, 'data-call-id': step.callId,
  },
  h('div', { class: 'ag-approval-head' },
    icon(risky ? 'triangle-alert' : 'shield', 13),
    h('span', { class: 'ag-approval-q', text: question }),
    target ? h('code', { class: 'ag-approval-target', title: target, text: target }) : null,
    diff ? h('button', {
      type: 'button', class: 'ag-link ag-approval-diff', title: 'Ver diff completo', 'aria-label': 'Ver diff completo',
      onclick: (e) => { e.stopPropagation(); ctx.showDiff(step, diff); },
    }, icon('git-compare', 12), h('span', { text: 'Diff' })) : null),
  body,
  h('div', { class: 'ag-approval-actions' },
    h('button', { type: 'button', class: 'ag-btn ag-btn-primary', 'data-decision': 'allow', onclick: decide('allow') },
      h('span', { text: 'Permitir' }), h('kbd', { 'aria-hidden': 'true', text: '↵' })),
    h('button', {
      type: 'button', class: 'ag-btn', 'data-decision': 'allow_session', onclick: decide('allow_session'),
      title: 'Permitir sempre nesta conversa: não pergunta de novo para esta ferramenta e comando',
      'aria-label': 'Permitir sempre nesta conversa',
    }, h('span', { class: 'ag-long', text: 'Permitir sempre nesta conversa' }), h('span', { class: 'ag-short', text: 'Permitir sempre' })),
    h('button', { type: 'button', class: 'ag-btn ag-btn-ghost', 'data-decision': 'deny', onclick: decide('deny') },
      h('span', { text: 'Negar' }), h('kbd', { 'aria-hidden': 'true', text: 'Esc' }))));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); ctx.approve(step.callId, 'deny'); return; }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.target.closest('button')) {
      event.preventDefault(); ctx.approve(step.callId, 'allow');
    }
  });
  return card;
}

/* ------------------------------------------------------------ passo */

function inputDetail(step) {
  const input = { ...(step.input || {}) };
  delete input.content; delete input.old_string; delete input.new_string;
  const entries = Object.entries(input).filter(([, v]) => v !== undefined && v !== '');
  if (!entries.length || step.tool === 'run_command') return null;
  return h('dl', { class: 'ag-kv' }, entries.flatMap(([k, v]) => [
    h('dt', { text: k }), h('dd', { text: typeof v === 'string' ? v : JSON.stringify(v) }),
  ]));
}

class StepView {
  constructor(step, ctx) {
    this.step = step;
    this.ctx = ctx;
    this.sig = '';
    this.row = h('button', { type: 'button', class: 'ag-step-row' });
    this.detail = h('div', { class: 'ag-step-detail' });
    this.output = null;
    this.approvalSlot = h('div', { class: 'ag-approval-slot' });
    this.el = h('div', { class: 'ag-step', 'data-call-id': step.callId, 'data-tool': step.tool }, this.row, this.detail, this.approvalSlot);
    this.row.addEventListener('click', () => {
      this.step.expanded = !this.isExpanded();
      this.sync(true);
    });
  }

  isExpanded() {
    const s = this.step;
    if (s.expanded != null) return s.expanded;
    // Comandos mostram a saída ao vivo; erros abrem sozinhos.
    return (s.tool === 'run_command' && (s.status === 'running' || !!s.output && this.ctx.live)) || (s.status === 'error' && !!(s.summary || s.output));
  }

  hasDetail() {
    const s = this.step;
    return !!(s.output || s.summary || inputDetail(s) || previewDiff(s) || (FILE_TOOLS.has(s.tool) && s.meta?.path && !s.meta?.deleted));
  }

  sync(force = false) {
    const s = this.step;
    const expanded = this.isExpanded();
    const sig = [s.status, s.title, s.summary, JSON.stringify(s.meta), !!s.approval, expanded, s.tool].join('|');
    if (sig !== this.sig || force) {
      this.sig = sig;
      this.renderRow(expanded);
      this.renderDetail(expanded);
      this.renderApproval();
    }
    this.syncOutput();
  }

  renderRow(expanded) {
    const s = this.step;
    const { icon: toolIcon } = toolMeta(s.tool);
    const detail = this.hasDetail();
    this.el.dataset.status = s.status;
    this.row.disabled = !detail;
    this.row.setAttribute('aria-expanded', detail ? String(expanded) : 'false');
    this.row.setAttribute('aria-label', `${s.title || toolMeta(s.tool).verb}: ${STATUS_LABEL[s.status] || s.status}`);
    this.row.replaceChildren(...[
      h('span', { class: 'ag-step-status', title: STATUS_LABEL[s.status] || '' }, statusGlyph(s.status)),
      h('span', { class: 'ag-step-icon', 'aria-hidden': 'true' }, icon(toolIcon, 13)),
      h('span', { class: 'ag-step-title' }, titleNodes(s, this.ctx.root)),
      h('span', { class: 'ag-step-meta' }, stepMeta(s)),
      detail ? h('span', { class: 'ag-step-chev', 'aria-hidden': 'true' }, icon('chevron-right', 12)) : null,
    ].filter(Boolean));
  }

  renderDetail(expanded) {
    const s = this.step;
    this.detail.hidden = !expanded;
    if (!expanded) { this.detail.replaceChildren(); this.output = null; return; }
    const parts = [];
    const kv = inputDetail(s);
    if (kv) parts.push(kv);
    if (s.tool === 'run_command' || s.output) {
      if (!this.output) this.output = h('pre', { class: 'ag-output', tabindex: '0', 'aria-label': 'Saída do comando' });
      this.output.textContent = '';
      this.outputLen = 0;
      parts.push(this.output);
    }
    if (s.summary && s.status !== 'ok' && !s.output) parts.push(h('p', { class: 'ag-step-summary', text: s.summary }));
    else if (s.summary && s.tool !== 'run_command' && !FILE_TOOLS.has(s.tool)) parts.push(h('p', { class: 'ag-step-summary is-dim', text: s.summary }));
    const actions = [];
    const diff = previewDiff(s);
    if (diff) actions.push(h('button', { type: 'button', class: 'ag-link', onclick: () => this.ctx.showDiff(s, diff) }, icon('git-compare', 12), h('span', { text: 'Ver diff' })));
    const path = s.meta?.path || (FILE_TOOLS.has(s.tool) ? s.input?.path : null);
    if (path && s.status === 'ok' && !s.meta?.deleted && s.tool !== 'create_dir' && s.tool !== 'delete_path') {
      actions.push(h('button', { type: 'button', class: 'ag-link', onclick: () => this.ctx.openFile(path) }, icon('external-link', 12), h('span', { text: 'Abrir' })));
    }
    if (actions.length) parts.push(h('div', { class: 'ag-step-actions' }, actions));
    this.detail.replaceChildren(...parts);
  }

  syncOutput() {
    if (!this.output) return;
    const text = this.step.output || '';
    if (text.length === this.outputLen) return;
    const pre = this.output;
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
    if (text.length > this.outputLen && this.outputLen > 0 && text.startsWith(pre.textContent)) pre.append(text.slice(this.outputLen));
    else pre.textContent = text || (this.step.status === 'running' ? '' : '(sem saída)');
    this.outputLen = text.length;
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }

  renderApproval() {
    const s = this.step;
    const wanted = s.status === 'awaiting' && s.approval;
    if (!wanted) { if (this.approvalSlot.firstChild) this.approvalSlot.replaceChildren(); this.approvalKey = null; return; }
    const key = JSON.stringify(s.approval.preview || {}).length + s.callId;
    if (this.approvalKey === key) return;
    this.approvalKey = key;
    const card = approvalElement(s, this.ctx);
    this.approvalSlot.replaceChildren(card);
    this.ctx.onApprovalShown?.(card);
  }
}

/* ------------------------------------------------------------ resumo */

function summaryElement(turn, ctx) {
  const changes = agentChanges(turn);
  const stepCount = Object.keys(turn.steps).length;
  if (!changes.length) {
    if (!turn.done || !stepCount) return null;
    return h('div', { class: 'ag-summary is-empty' },
      icon('circle-check', 13), h('span', { text: `Nenhum arquivo alterado · ${stepCount} ${stepCount === 1 ? 'passo' : 'passos'}` }));
  }
  const added = changes.reduce((n, c) => n + (Number(c.added) || 0), 0);
  const removed = changes.reduce((n, c) => n + (Number(c.removed) || 0), 0);
  const label = `${changes.length} ${changes.length === 1 ? 'arquivo alterado' : 'arquivos alterados'}`;
  const canUndo = !!turn.done?.checkpointId && !turn.undone && ctx.canUndo !== false;
  const head = h('div', { class: 'ag-summary-head' },
    h('span', { class: 'ag-summary-title', text: turn.undone ? `${label} · desfeito` : label }),
    h('span', { class: 'ag-summary-delta' }, delta(added, removed)));
  if (canUndo) {
    const undoBtn = h('button', { type: 'button', class: 'ag-btn ag-btn-ghost ag-undo' }, icon('undo-2', 12), h('span', { text: 'Desfazer tudo' }));
    undoBtn.addEventListener('click', () => {
      const confirmBox = h('div', { class: 'ag-confirm', role: 'alertdialog', 'aria-label': 'Confirmar desfazer' },
        h('span', { class: 'ag-confirm-text', text: `Restaurar ${changes.length === 1 ? 'o arquivo' : `os ${changes.length} arquivos`} como estavam antes?` }),
        h('button', { type: 'button', class: 'ag-btn ag-btn-danger ag-undo-confirm' }, h('span', { text: 'Desfazer' })),
        h('button', { type: 'button', class: 'ag-btn ag-btn-ghost ag-undo-cancel' }, h('span', { text: 'Cancelar' })));
      head.replaceWith(confirmBox);
      const cancel = () => { confirmBox.replaceWith(head); undoBtn.focus(); };
      confirmBox.querySelector('.ag-undo-cancel').addEventListener('click', cancel);
      confirmBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } });
      const confirmBtn = confirmBox.querySelector('.ag-undo-confirm');
      confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.replaceChildren(h('span', { class: 'ag-spin', 'aria-hidden': 'true' }), h('span', { text: 'Desfazendo' }));
        await ctx.undo(turn);
      });
      confirmBtn.focus();
    });
    head.append(undoBtn);
  } else if (turn.undone) {
    head.append(h('span', { class: 'ag-undone' }, icon('undo-2', 12), h('span', { text: 'Desfeito' })));
  }
  const list = h('ul', { class: 'ag-files', 'aria-label': 'Arquivos alterados' }, changes.map((c) => {
    const rel = relativePath(c.path, ctx.root);
    const name = baseName(rel);
    const dir = rel.slice(0, rel.length - name.length).replace(/[\\/]$/, '');
    const openable = !c.deleted && !turn.undone;
    return h('li', {},
      h('button', {
        type: 'button', class: `ag-file${c.deleted ? ' is-deleted' : ''}`, 'data-path': c.path, disabled: !openable || null,
        title: openable ? `Abrir ${rel}` : rel,
        onclick: () => ctx.openFile(c.path),
      },
      icon(c.deleted ? 'file-minus' : c.created ? 'file-plus' : 'file-pen', 13),
      h('span', { class: 'ag-file-name', text: name }),
      dir ? h('span', { class: 'ag-file-dir', text: dir }) : null,
      h('span', { class: 'ag-file-delta' }, delta(c.added, c.removed, c))));
  }));
  return h('div', { class: `ag-summary${turn.undone ? ' is-undone' : ''}`, role: 'group', 'aria-label': 'Resumo das alterações' }, head, list);
}

function errorElement(turn, ctx) {
  const { error } = turn;
  if (!error || error.code === 'cancelled') return null;
  let action = null;
  if (error.code === 'tools_unsupported') {
    action = h('button', { type: 'button', class: 'ag-btn ag-chat-fallback', onclick: () => ctx.chatFallback() }, icon('message-circle', 12), h('span', { text: 'Responder como chat' }));
  } else if (error.code === 'no_workspace') {
    action = h('button', { type: 'button', class: 'ag-btn ag-open-folder', onclick: () => ctx.openFolder() }, icon('folder-open', 12), h('span', { text: 'Abrir pasta' }));
  }
  const text = error.code === 'tools_unsupported'
    ? 'Este modelo não aceita ferramentas, então o agente não pode agir com ele.'
    : error.code === 'no_workspace' ? 'O agente precisa de uma pasta aberta para trabalhar.' : error.message;
  return h('div', { class: 'ag-error', role: 'alert', 'data-code': error.code || '' },
    icon('circle-alert', 13), h('span', { class: 'ag-error-text', text }), action);
}

/* ------------------------------------------------------------ TurnView */

/**
 * Renderiza (e atualiza) um turno do agente.
 * ctx: { root, live, approve, openFile, showDiff, undo, chatFallback, openFolder, onApprovalShown }
 */
export class TurnView {
  constructor(turn, ctx) {
    this.turn = turn;
    this.ctx = ctx;
    this.el = h('div', { class: 'ag-turn' });
    this.blocks = []; // { kind, el, seg?, steps? }
    this.stepViews = new Map();
    this.thinking = h('div', { class: 'ai-thinking ag-thinking' },
      h('span', { class: 'ai-thinking-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { text: 'Trabalhando' }));
    this.tail = h('div', { class: 'ag-tail' });
    this.el.append(this.tail);
    this.tailSig = '';
    this.sync();
  }

  sync() {
    const { segments } = this.turn;
    let blockIndex = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.t === 'text') {
        let block = this.blocks[blockIndex];
        if (!block) {
          block = { kind: 'text', seg, el: h('div', { class: 'ai-prose ag-text' }), rendered: null };
          this.blocks.push(block);
          this.el.insertBefore(block.el, this.tail);
        }
        if (block.rendered !== seg.text) {
          block.el.innerHTML = renderMarkdown(seg.text);
          block.rendered = seg.text;
          this.ctx.onText?.(block.el, this.ctx.live);
        }
        blockIndex++;
      } else if (seg.t === 'steer') {
        // Mensagem "Enviar agora" incorporada neste ponto da execução.
        if (!this.blocks[blockIndex]) {
          const block = { kind: 'steer', el: steerElement(seg) };
          this.blocks.push(block);
          this.el.insertBefore(block.el, this.tail);
        }
        blockIndex++;
      } else {
        let block = this.blocks[blockIndex];
        if (!block) {
          block = { kind: 'steps', el: h('div', { class: 'ag-steps', role: 'list' }) };
          this.blocks.push(block);
          this.el.insertBefore(block.el, this.tail);
        }
        // passos consecutivos ficam no mesmo trilho
        while (i < segments.length && segments[i].t === 'step') {
          const step = this.turn.steps[segments[i].id];
          if (step) {
            let view = this.stepViews.get(step.callId);
            if (!view) {
              view = new StepView(step, this.ctx);
              view.el.setAttribute('role', 'listitem');
              this.stepViews.set(step.callId, view);
              block.el.append(view.el);
            }
            view.step = step;
            view.sync();
          }
          i++;
        }
        i--;
        blockIndex++;
      }
    }
    this.syncTail();
  }

  syncTail() {
    const t = this.turn;
    const lastSeg = t.segments.at(-1);
    const busy = this.ctx.live && !t.done && !t.error && !(lastSeg?.t === 'text')
      && !Object.values(t.steps).some((s) => s.status === 'running' || s.status === 'awaiting');
    const sig = [busy, !!t.done, t.undone, t.error?.code, t.error?.message, this.ctx.live, JSON.stringify(t.done?.changes || [])].join('|');
    if (sig === this.tailSig) return;
    this.tailSig = sig;
    const parts = [];
    if (busy) parts.push(this.thinking);
    if (!this.ctx.live || t.done || t.error) {
      const summary = summaryElement(t, this.ctx);
      if (summary) parts.push(summary);
    }
    const err = errorElement(t, this.ctx);
    if (err) parts.push(err);
    // Modo Plan: ao terminar, oferece mandar o plano para o modo Agente.
    if (t.skill === 'plan' && t.done && !t.error && !this.ctx.live && this.ctx.runPlan) {
      parts.push(h('div', { class: 'ag-plan-actions' },
        h('button', { type: 'button', class: 'ag-btn ag-btn-primary ag-run-plan', onclick: () => this.ctx.runPlan(t) },
          icon('play', 12), h('span', { text: 'Executar plano' })),
        h('span', { class: 'ag-dim', text: 'Abre o plano no composer, no modo Agente, para você revisar e enviar.' })));
    }
    this.tail.replaceChildren(...parts);
  }

  setLive(live) {
    // Ao terminar, o que estava aberto (ex.: saída de comando) continua aberto.
    if (!live) for (const view of this.stepViews.values()) if (view.step.expanded == null && view.isExpanded()) view.step.expanded = true;
    this.ctx.live = live;
    this.tailSig = '';
    for (const view of this.stepViews.values()) view.sync(true);
    if (!live) for (const block of this.blocks) if (block.kind === 'text') this.ctx.onText?.(block.el, false);
    this.syncTail();
  }
}
