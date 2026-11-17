/**
 * Agzos IA — painel de chat.
 *
 * Toda a marcação é criada aqui dentro de `#ai-panel`. O dock (ai-dock.js)
 * move esse nó entre esquerda/direita/embaixo sem recriá-lo, então nenhum
 * estado (conversa, streaming, foco) depende da posição.
 */
import { renderMarkdown } from './markdown.js';
import { buildContextMessage } from './ai-context.js';
import { getActiveEditor, getMonaco, openFile, handleExternalChange, languageForPath } from './editor.js';
import { getRecentOutput } from './terminal.js';
import { lucideIcon } from './lucide.js';
import { toast } from './toast.js';
import {
  DEFAULT_TITLE, MAX_MESSAGES, makeTitle, composerKeyAction, sendHint, relativeTime, addConversation, baseName,
  AGENT_MODES, AGENT_MODE_INFO, normalizeAgentMode, createAgentTurn, applyAgentEvent, settleSteps,
  encodeAgentContent, decodeAgentContent, stripAgentMarker, joinRoot, relativePath,
  FALLBACK_SKILLS, resolveSkill, skillLabel, payloadMessage, formatBytes, truncate, isVisionError, agentTurnText,
  estimateTokens, modelMessages, compactableMessages, makeSummaryMessage, compactedBefore, isSummary,
} from './ai-chat-utils.js';
import { TurnView } from './agent-ui.js';
import { attachFile, attachFromMain } from './ai-attachments.js';
import { openGitDialog } from './git-dialog.js';

const State = window.AgzosState;
const IS_MAC = /Mac/i.test(navigator.platform || '');

let panel = null;
const $ = (sel) => panel.querySelector(sel);

let root = null;
let store = { conversations: [], activeId: null };
let request = null; // { id, message, el, conversationId, agent?: { turn, view } } | { id, compact: true, conversationId, message: null }
let renderTimer = null;
let loadVersion = 0;
let loadingHistory = false;
let profiles = [];
let selectedProfile = null;
let models = [];
let selectedModel = '';
let lastError = null; // { text, retry }
let menuState = null; // { el, anchor, onClose }
const contextOptions = { file: true, selection: true, terminal: false };
let skills = FALLBACK_SKILLS.slice(); // modos (skills) disponíveis — recarregados ao abrir o seletor
let queue = []; // mensagens esperando o fim da execução: { id, content, attachments }
let draftAttachments = []; // anexos do composer (descritores)
let attachBusy = 0;
const steerPending = new Map(); // id → item enviado com "Enviar agora" ainda não incorporado
let sendAfterStop = null; // modo Chat: "Enviar agora" interrompe e manda este item
let readOnlyView = null; // { key, root, conversation } — conversa de outra pasta aberta só para leitura
let openAfterLoad = null; // conversa a abrir quando o histórico da pasta recém-aberta carregar
const turnViews = new WeakMap(); // mensagem → TurnView
const decodedTurns = new WeakMap(); // mensagem do histórico → turno decodificado

const SUGGESTIONS = [
  { icon: 'book-open', label: 'Explicar arquivo', desc: 'O que ele faz e como se conecta ao resto',
    prompt: 'Explique de forma objetiva o que este arquivo faz e como ele se conecta ao resto do projeto.' },
  { icon: 'bug', label: 'Encontrar bugs', desc: 'Revisão com linha e correção sugerida',
    prompt: 'Revise este arquivo e aponte bugs ou riscos reais, com a linha e a correção sugerida.' },
  { icon: 'flask-conical', label: 'Gerar testes', desc: 'Casos principais e de borda',
    prompt: 'Escreva testes para este arquivo, cobrindo os casos principais e de borda.' },
  { icon: 'file-text', label: 'Documentar', desc: 'Comentários de documentação no código',
    prompt: 'Adicione comentários de documentação a este arquivo. Responda só com o código final em um bloco.' },
];

/* ------------------------------------------------------------------ */
/* Helpers de DOM                                                      */
/* ------------------------------------------------------------------ */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null) el.append(child);
  return el;
}
const icon = (name, size = 15) => lucideIcon(name, { size, strokeWidth: 1.75 });
function iconButton(id, name, label, extra = {}) {
  return h('button', { type: 'button', id, class: 'ai-icon-btn', 'aria-label': label, title: label, ...extra }, icon(name));
}
function mark(cls = 'ai-mark') {
  return h('img', { class: cls, src: 'assets/logo-icon.svg', alt: '', draggable: 'false' });
}

function aiSettings() {
  return State.settings.aiPanel || {};
}
function activeConversation() {
  return store.conversations.find((c) => c.id === store.activeId) || null;
}
function messages() {
  return activeConversation()?.messages || [];
}

function agentApi() {
  return window.agzos?.agent || null;
}
function agentMode() {
  return normalizeAgentMode(State.settings.aiAgent?.mode);
}
/** Modo (skill) ativo no composer. Padrão: Agente com pasta aberta, Chat sem pasta. */
function currentSkill() {
  const chosen = aiSettings().skill || null;
  const skill = resolveSkill(skills, chosen, !!State.workspaceRoot);
  if (!agentApi() && skill.kind === 'agent') return resolveSkill(skills, 'chat', false);
  return skill;
}
/** Agente ligado no composer? (modo com ferramentas) */
function isAgentOn() {
  return !!agentApi() && currentSkill().kind === 'agent';
}

/* ------------------------------------------------------------------ */
/* Estrutura                                                           */
/* ------------------------------------------------------------------ */

function ensurePanel() {
  let el = document.getElementById('ai-panel');
  if (!el) {
    // Compatibilidade: index.html antigo sem o host do dock.
    el = h('section', { id: 'ai-panel', class: 'ai-panel' });
    const legacy = document.getElementById('panel-ai');
    if (legacy) legacy.replaceChildren(el); else document.body.append(el);
  }
  if (!document.querySelector('link[href$="ai-panel.css"]')) {
    document.head.append(h('link', { rel: 'stylesheet', href: 'styles/ai-panel.css' }));
  }
  return el;
}

function buildPanel() {
  panel.classList.add('ai-panel');
  panel.setAttribute('aria-label', 'Agzos IA');
  panel.replaceChildren(
    h('header', { class: 'ai-head' },
      h('div', { class: 'ai-head-title' }, mark(), h('span', { class: 'ai-head-name', text: 'Agzos IA' })),
      h('button', {
        type: 'button', id: 'ai-model-pill', class: 'ai-pill', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        title: 'Perfil e modelo',
      },
      h('span', { class: 'ai-pill-profile' }), h('span', { class: 'ai-pill-model' }), icon('chevron-down', 12)),
      h('div', { class: 'ai-head-actions' },
        iconButton('ai-new-chat', 'square-pen', 'Nova conversa'),
        iconButton('ai-history-btn', 'clock-3', 'Conversas anteriores', { 'aria-expanded': 'false', 'aria-controls': 'ai-history' }),
        iconButton('ai-more-btn', 'ellipsis', 'Mais ações', { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }))),
    h('div', { class: 'ai-body' },
      h('div', { id: 'ai-setup', class: 'ai-setup', hidden: true },
        mark('ai-setup-mark'),
        h('h2', { class: 'ai-setup-title', text: 'Conecte um provedor de IA' }),
        h('p', { class: 'ai-setup-text', text: 'OpenAI, Anthropic, Groq, Ollama local e outros. A chave fica no cofre do sistema.' }),
        h('button', { type: 'button', id: 'ai-configure', class: 'ai-primary' }, icon('settings', 14), h('span', { text: 'Configurar IA' }))),
      h('div', { id: 'ai-chat', class: 'ai-chat', hidden: true },
        h('div', {
          id: 'ai-messages', class: 'ai-messages', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions',
          'aria-label': 'Conversa', tabindex: '0',
        }),
        buildComposer()),
      buildHistory()),
  );
}

function buildComposer() {
  const chip = (key, iconName, label) => h('button', {
    type: 'button', class: 'ai-context-chip', 'data-context': key, 'aria-pressed': 'false',
  }, icon(iconName, 12), h('span', { class: 'ai-chip-label', text: label }));
  return h('div', { class: 'ai-composer' },
    h('div', { id: 'ai-queue', class: 'ai-queue', role: 'list', 'aria-label': 'Mensagens na fila', hidden: true }),
    buildAgentBar(),
    h('div', { class: 'ai-composer-box' },
      h('div', { id: 'ai-attachments', class: 'ai-attachments', role: 'list', 'aria-label': 'Anexos', hidden: true }),
      h('textarea', {
        id: 'ai-input', rows: '1', spellcheck: 'true',
        placeholder: 'Pergunte sobre o código ou peça uma mudança…', 'aria-label': 'Mensagem para o Agzos IA',
        'aria-describedby': 'ai-hint',
      }),
      h('div', { class: 'ai-composer-foot' },
        h('button', {
          type: 'button', id: 'ai-attach', class: 'ai-icon-btn ai-attach-btn', 'aria-label': 'Anexar arquivos (imagens, texto, PDF)',
          title: 'Anexar arquivos — também dá para colar imagem (Ctrl+V) ou arrastar',
        }, icon('paperclip', 14)),
        h('div', { class: 'ai-chips', role: 'group', 'aria-label': 'Contexto enviado à IA' },
          chip('file', 'file-text', 'Arquivo'),
          chip('selection', 'text-cursor', 'Seleção'),
          chip('terminal', 'terminal', 'Terminal')),
        h('button', { type: 'button', id: 'ai-send', class: 'ai-send', 'data-state': 'send', 'aria-label': 'Enviar mensagem', title: 'Enviar mensagem' },
          icon('arrow-up', 15)))),
    h('div', { id: 'ai-hint', class: 'ai-hint' }));
}

function buildAgentBar() {
  return h('div', { id: 'ai-agent-bar', class: 'ai-agent-bar' },
    h('button', {
      type: 'button', id: 'ai-skill-btn', class: 'ai-skill-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    }, h('span', { class: 'ai-skill-icon' }), h('span', { class: 'ai-skill-label' }), icon('chevron-down', 11)),
    h('button', {
      type: 'button', id: 'ai-agent-mode', class: 'ai-mode-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    }, h('span', { class: 'ai-mode-icon' }), h('span', { class: 'ai-mode-label' }), icon('chevron-down', 11)));
}

function buildHistory() {
  return h('div', { id: 'ai-history', class: 'ai-history', role: 'dialog', 'aria-label': 'Conversas', hidden: true },
    h('div', { class: 'ai-history-head' },
      h('span', { class: 'ai-history-title', text: 'Conversas' }),
      iconButton('ai-history-close', 'x', 'Fechar conversas')),
    h('div', { class: 'ai-history-search' },
      icon('search', 13),
      h('input', {
        id: 'ai-history-query', type: 'search', placeholder: 'Buscar por título ou conteúdo…', 'aria-label': 'Buscar conversas',
        autocomplete: 'off', spellcheck: 'false',
      })),
    h('div', { id: 'ai-history-list', class: 'ai-history-list' }));
}

/* ------------------------------------------------------------------ */
/* Personalização / layout                                             */
/* ------------------------------------------------------------------ */

export function applyAiPanelSettings() {
  if (!panel) return;
  const s = aiSettings();
  const size = Math.min(18, Math.max(11, Number(s.fontSize) || 13));
  panel.style.setProperty('--ai-fs', `${size}px`);
  panel.dataset.density = s.density === 'compact' ? 'compact' : 'comfortable';
  panel.classList.toggle('no-avatars', s.showAvatars === false);
  const hint = $('#ai-hint');
  hint.replaceChildren(...sendHint(s.sendKey, IS_MAC).flatMap(({ keys, label }) => [
    h('span', { class: 'ai-hint-item' }, ...keys.map((k) => h('kbd', { text: k })), h('span', { text: label })),
  ]));
  autoGrow();
}

function currentPosition() {
  return window.AgzosAiDock?.getPosition?.() || aiSettings().position || 'left';
}

let stickToBottom = true;
function pinToBottom() {
  const list = $('#ai-messages');
  if (stickToBottom) list.scrollTop = list.scrollHeight;
}

function observeSize() {
  const update = () => {
    const { width, height } = panel.getBoundingClientRect();
    if (!width || !height) return;
    requestAnimationFrame(pinToBottom);
    panel.classList.toggle('is-narrow', width < 340);
    panel.classList.toggle('is-short', height < 340);
    panel.classList.toggle('is-wide', width >= 720);
  };
  new ResizeObserver(update).observe(panel);
  update();
}

/* ------------------------------------------------------------------ */
/* Contexto                                                            */
/* ------------------------------------------------------------------ */

function selectionInfo() {
  const editor = getActiveEditor();
  const sel = editor?.getSelection();
  if (!editor?.getModel() || !sel || sel.isEmpty()) return null;
  return { lines: sel.endLineNumber - sel.startLineNumber + 1 };
}

function updateContextChips() {
  if (!panel) return;
  const filePath = State.activePath && State.files?.has(State.activePath) ? State.activePath : null;
  const sel = selectionInfo();
  panel.querySelectorAll('.ai-context-chip').forEach((chip) => {
    const key = chip.dataset.context;
    const on = !!contextOptions[key];
    chip.setAttribute('aria-pressed', String(on));
    const label = chip.querySelector('.ai-chip-label');
    let text = 'Terminal';
    let present = true;
    let title = on ? 'Saída recente do terminal vai junto' : 'Terminal não vai junto';
    if (key === 'file') {
      text = filePath ? baseName(filePath) : 'Arquivo';
      present = !!filePath;
      title = filePath ? `${on ? 'Enviando' : 'Não enviando'} ${filePath}` : 'Nenhum arquivo aberto';
    } else if (key === 'selection') {
      text = sel ? `${sel.lines} ${sel.lines === 1 ? 'linha' : 'linhas'}` : 'Seleção';
      present = !!sel;
      title = sel ? `${on ? 'Enviando' : 'Não enviando'} a seleção` : 'Nada selecionado';
    }
    label.textContent = text;
    chip.classList.toggle('is-absent', !present);
    chip.title = title;
  });
}

let editorHooked = null;
function hookEditor() {
  const editor = getActiveEditor();
  if (!editor || editorHooked === editor) return;
  editorHooked = editor;
  editor.onDidChangeCursorSelection?.(() => updateContextChips());
  editor.onDidChangeModel?.(() => updateContextChips());
}

function makeContextMessage(includeSelection) {
  const context = {};
  const editor = getActiveEditor();
  if (contextOptions.file && State.activePath) {
    const file = State.files.get(State.activePath);
    const model = editor?.getModel();
    // Abas de visualização (imagem, PDF…) não têm texto para enviar.
    if (file && !file.viewer && !file.preview) context.file = {
      path: file.path,
      language: model?.getLanguageId() || 'plaintext',
      content: editor?.getValue() ?? file.content,
    };
  }
  if ((contextOptions.selection || includeSelection === true) && editor) {
    const model = editor.getModel();
    const selected = model && editor.getSelection() ? model.getValueInRange(editor.getSelection()) : '';
    if (selected) {
      const range = editor.getSelection();
      context.selection = { text: selected, startLine: range.startLineNumber, endLine: range.endLineNumber };
    }
  }
  if (contextOptions.terminal) context.terminal = getRecentOutput();
  return buildContextMessage(context);
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

function isNearBottom(list) {
  return list.scrollHeight - list.scrollTop - list.clientHeight < 48;
}

function renderAssistantBody(prose, message, streaming) {
  if (streaming && !message.content) {
    prose.replaceChildren(h('div', { class: 'ai-thinking' },
      h('span', { class: 'ai-thinking-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
      h('span', { text: 'Pensando' })));
    return;
  }
  // Markdown sanitizado (DOMPurify) — nunca o texto cru do modelo.
  prose.innerHTML = renderMarkdown(message.content);
}

const LANG_ALIASES = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', md: 'markdown', rb: 'ruby', rs: 'rust',
  'c++': 'cpp', cs: 'csharp', kt: 'kotlin', html: 'html', vue: 'html', json: 'json',
};
/**
 * Colore blocos de código já finalizados com o tokenizador do Monaco.
 * colorize() devolve HTML gerado pelo Monaco a partir do texto (escapado),
 * nunca HTML do modelo.
 */
const codeSource = new WeakMap(); // <code> colorido → texto original
function highlightCode(container) {
  const monaco = getMonaco?.();
  if (!monaco?.editor?.colorize) return;
  const known = new Set(monaco.languages.getLanguages().map((l) => l.id));
  container.querySelectorAll('.ai-code').forEach((block) => {
    const code = block.querySelector('pre code');
    const raw = block.querySelector('.ai-code-lang')?.textContent.toLowerCase() || '';
    const lang = LANG_ALIASES[raw] || raw;
    if (!code || !known.has(lang) || code.dataset.colorized) return;
    const text = code.textContent;
    monaco.editor.colorize(text, lang, { tabSize: 2 }).then((html) => {
      if (!code.isConnected || code.textContent !== text) return;
      codeSource.set(code, text);
      code.innerHTML = html;
      code.dataset.colorized = '1';
    }).catch(() => {});
  });
}

function agentTurnOf(message) {
  if (message.agent) return message.agent;
  if (decodedTurns.has(message)) return decodedTurns.get(message);
  const { turn } = decodeAgentContent(message.content);
  decodedTurns.set(message, turn);
  return turn;
}

/** Selo pequeno com o modo (skill) que gerou a resposta. */
function modeBadge(id) {
  if (!id) return null;
  const skill = skills.find((s) => s.id === id);
  return h('div', { class: 'ai-msg-head' },
    h('span', { class: 'ai-mode-badge', 'data-skill': id, title: `Modo ${skillLabel(skills, id)}` },
      icon(skill?.icon || (id === 'chat' ? 'message-circle' : 'bot'), 10), h('span', { text: skillLabel(skills, id) })));
}

function agentMessageElement(message, turn) {
  const live = request?.message === message;
  let view = turnViews.get(message);
  if (!view) {
    view = new TurnView(turn, agentContext(message, live));
    turnViews.set(message, view);
  }
  const el = h('div', { class: `ai-msg ai-assistant ai-agent-msg${live ? ' is-streaming' : ''}`, 'aria-busy': live ? 'true' : null },
    h('div', { class: 'ai-avatar', 'aria-hidden': 'true' }, mark('ai-avatar-mark')),
    h('div', { class: 'ai-msg-main' }, modeBadge(message.skill || turn.skill || 'agent'), view.el));
  if (live) request.el = el;
  return el;
}

function attachmentChip(att, { removable = false } = {}) {
  const kindIcon = att.kind === 'image' ? 'image' : att.kind === 'pdf' ? 'file-text' : 'file-code';
  const label = `${att.name} (${formatBytes(att.size)})${att.note ? ` — ${att.note}` : ''}`;
  return h('div', { class: `ai-att${att.kind === 'image' ? ' is-image' : ''}`, role: 'listitem', 'data-id': att.id, title: label },
    att.thumb ? h('img', { class: 'ai-att-thumb', src: att.thumb, alt: '' }) : h('span', { class: 'ai-att-icon' }, icon(kindIcon, 14)),
    h('span', { class: 'ai-att-text' },
      h('span', { class: 'ai-att-name', text: att.name }),
      h('span', { class: 'ai-att-size', text: att.truncated ? `${formatBytes(att.size)} · cortado` : formatBytes(att.size) })),
    removable ? h('button', {
      type: 'button', class: 'ai-att-remove', 'data-id': att.id, 'aria-label': `Remover anexo ${att.name}`, title: 'Remover',
    }, icon('x', 11)) : null);
}

/** Marcador "Conversa compactada — N mensagens resumidas", expansível para ver o resumo. */
function compactMarkerElement(message) {
  const n = Number(message.compactedCount) || 0;
  const body = h('div', { class: 'ai-prose ai-compact-body' });
  body.innerHTML = renderMarkdown(message.content);
  return h('div', { class: 'ai-compact-marker', role: 'note' },
    h('details', {},
      h('summary', { title: 'Mostrar o resumo enviado ao modelo no lugar das mensagens anteriores' },
        icon('fold-vertical', 13),
        h('span', { text: `Conversa compactada — ${n} ${n === 1 ? 'mensagem resumida' : 'mensagens resumidas'}` })),
      body));
}

function compactingElement() {
  return h('div', { class: 'ai-compacting', role: 'status' },
    h('span', { class: 'ai-thinking-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
    h('span', { text: 'Compactando conversa…' }));
}

/** Mensagens da conversa: as anteriores ao último resumo ficam esmaecidas. */
function threadChildren(items, { live = false } = {}) {
  const cut = compactedBefore(items);
  const children = items.map((message, index) => {
    const el = messageElement(message);
    if (index < cut && !isSummary(message)) {
      el.classList.add('is-compacted');
      el.title = 'Compactada: o modelo recebe só o resumo abaixo';
    }
    return el;
  });
  if (live) children.push(compactingElement());
  return children;
}

function messageElement(message) {
  if (isSummary(message)) return compactMarkerElement(message);
  if (message.role === 'user') {
    const atts = Array.isArray(message.attachments) && message.attachments.length
      ? h('div', { class: 'ai-msg-atts', role: 'list', 'aria-label': 'Anexos' }, message.attachments.map((a) => attachmentChip(a)))
      : null;
    return h('div', { class: `ai-msg ai-user${atts ? ' has-atts' : ''}` },
      atts, message.content ? h('div', { class: 'ai-bubble', text: message.content }) : null);
  }
  const turn = agentTurnOf(message);
  if (turn) return agentMessageElement(message, turn);
  const streaming = request?.message === message;
  const prose = h('div', { class: 'ai-prose' });
  const el = h('div', { class: `ai-msg ai-assistant${streaming ? ' is-streaming' : ''}`, 'aria-busy': streaming ? 'true' : null },
    h('div', { class: 'ai-avatar', 'aria-hidden': 'true' }, mark('ai-avatar-mark')),
    h('div', { class: 'ai-msg-main' }, modeBadge(message.skill), prose));
  renderAssistantBody(prose, message, streaming);
  if (streaming) request.el = el; else highlightCode(prose);
  return el;
}

function welcomeElement() {
  return h('div', { class: 'ai-welcome' },
    h('div', { class: 'ai-welcome-intro' },
      mark('ai-welcome-mark'),
      h('div', {},
        h('h2', { class: 'ai-welcome-title', text: 'O que vamos fazer?' }),
        h('p', { class: 'ai-welcome-text', text: 'O arquivo aberto e a seleção vão junto como contexto. Ajuste nos chips abaixo.' }))),
    h('ul', { class: 'ai-suggestions', 'aria-label': 'Sugestões' },
      SUGGESTIONS.map((s) => h('li', {},
        h('button', { type: 'button', class: 'ai-suggestion', 'data-prompt': s.prompt },
          h('span', { class: 'ai-suggestion-icon' }, icon(s.icon, 14)),
          h('span', { class: 'ai-suggestion-text' },
            h('span', { class: 'ai-suggestion-label', text: s.label }),
            h('span', { class: 'ai-suggestion-desc', text: s.desc })))))));
}

function errorElement() {
  return h('div', { id: 'ai-error', class: 'ai-error', role: 'alert' },
    icon('circle-alert', 14),
    h('span', { class: 'ai-error-text', text: lastError.text }),
    lastError.retry ? h('button', { type: 'button', class: 'ai-retry' }, icon('rotate-ccw', 12), h('span', { text: 'Tentar de novo' })) : null);
}

function readOnlyBanner() {
  const { root: folder, conversation } = readOnlyView;
  return h('div', { class: 'ai-readonly', role: 'note' },
    icon('clock-3', 14),
    h('span', { class: 'ai-readonly-text' },
      h('strong', { text: conversation.title || DEFAULT_TITLE }),
      h('span', { text: folder ? ` — conversa de ${baseName(folder)} (pasta não aberta), somente leitura.` : ' — somente leitura.' })),
    folder ? h('button', { type: 'button', class: 'ai-readonly-open', 'data-root': folder }, icon('folder-open', 12), h('span', { text: 'Abrir pasta' })) : null,
    h('button', { type: 'button', class: 'ai-readonly-close' }, icon('x', 12), h('span', { text: 'Voltar' })));
}

function renderMessages() {
  if (!panel) return;
  const list = $('#ai-messages');
  if (readOnlyView) {
    list.replaceChildren(readOnlyBanner(), h('div', { class: 'ai-thread is-readonly' }, threadChildren(readOnlyView.conversation.messages)));
    list.classList.remove('is-empty');
    list.scrollTop = 0;
    return;
  }
  const items = messages();
  const compacting = !!request?.compact && request.conversationId === store.activeId;
  const children = [items.length ? h('div', { class: 'ai-thread' }, threadChildren(items, { live: compacting })) : welcomeElement()];
  if (lastError) children.push(errorElement());
  list.replaceChildren(...children);
  list.classList.toggle('is-empty', !items.length);
  list.scrollTop = list.scrollHeight;
  stickToBottom = true;
}

function renderStreaming() {
  if (request?.agent) {
    request.agent.view.sync();
    const list = $('#ai-messages');
    if (stickToBottom) list.scrollTop = list.scrollHeight;
    return;
  }
  if (!request?.el) { renderMessages(); return; }
  const list = $('#ai-messages');
  renderAssistantBody(request.el.querySelector('.ai-prose'), request.message, true);
  if (stickToBottom) list.scrollTop = list.scrollHeight;
}
function queueRender() {
  if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; renderStreaming(); }, 50);
}

/* ------------------------------------------------------------------ */
/* Persistência / conversas                                            */
/* ------------------------------------------------------------------ */

function persist() {
  const conversations = store.conversations.map((c) => ({
    ...c,
    messages: c.messages.map(({ role, content, attachments, model, skill, kind, compactedCount, createdAt }) => ({
      role, content,
      ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
      ...(model ? { model } : {}),
      ...(skill ? { skill } : {}),
      ...(kind === 'summary' ? { kind, compactedCount, createdAt } : {}),
    })),
  }));
  const snapshot = { conversations, activeId: store.activeId };
  return window.agzos.chat.saveHistory(root, snapshot).catch(() => {
    toast('Não foi possível salvar o histórico do chat.', 'error');
  });
}

async function loadHistory() {
  const nextRoot = State.workspaceRoot || null;
  const version = ++loadVersion;
  loadingHistory = true;
  $('#ai-input').disabled = true;
  if (request) await cancelRequest();
  root = nextRoot;
  store = { conversations: [], activeId: null };
  lastError = null;
  readOnlyView = null;
  queue = [];
  renderQueue();
  closeHistory();
  syncAgentBar();
  renderMessages();
  try {
    const loaded = await window.agzos.chat.loadHistory(root);
    if (version !== loadVersion) return;
    store = {
      conversations: Array.isArray(loaded?.conversations) ? loaded.conversations : [],
      activeId: loaded?.activeId ?? null,
    };
    if (openAfterLoad && store.conversations.some((c) => c.id === openAfterLoad)) store.activeId = openAfterLoad;
    openAfterLoad = null;
    renderMessages();
  } catch {
    if (version === loadVersion) { lastError = { text: 'Não foi possível carregar o histórico.' }; renderMessages(); }
  } finally {
    if (version === loadVersion) { loadingHistory = false; $('#ai-input').disabled = false; }
  }
}

/**
 * Nova conversa. Funciona também durante uma execução: o pedido em andamento segue
 * na conversa dele (request.conversationId) e termina lá.
 */
function newConversation({ focus = true } = {}) {
  const current = activeConversation();
  lastError = null;
  readOnlyView = null;
  if (current && !current.messages.length) {
    renderMessages();
  } else {
    const conversation = { id: crypto.randomUUID(), title: DEFAULT_TITLE, updatedAt: Date.now(), messages: [] };
    store = addConversation(store, conversation);
    renderMessages();
    persist();
  }
  Object.assign(contextOptions, defaultContext());
  updateContextChips();
  closeHistory();
  if (focus) $('#ai-input').focus();
}

function switchConversation(id) {
  if (!store.conversations.some((c) => c.id === id)) return;
  store = { ...store, activeId: id };
  lastError = null;
  readOnlyView = null;
  closeHistory();
  renderMessages();
  persist();
  $('#ai-input').focus();
}

function deleteConversation(id) {
  if (request?.conversationId === id) { toast('Espere a resposta terminar para apagar esta conversa.', 'info'); return; }
  const conversations = store.conversations.filter((c) => c.id !== id);
  const activeId = store.activeId === id ? (conversations[0]?.id ?? null) : store.activeId;
  store = { conversations, activeId };
  renderHistoryList();
  renderMessages();
  persist();
}

let historyQueryTimer = null;
let historyVersion = 0;

/** Lista de todas as conversas (todas as pastas), pasta atual em destaque. */
async function renderHistoryList() {
  const list = $('#ai-history-list');
  const query = $('#ai-history-query').value.trim();
  const version = ++historyVersion;
  let groups = [];
  try {
    groups = await window.agzos.chat.allHistory({ currentRoot: root, query });
  } catch {
    groups = [];
  }
  if (version !== historyVersion) return;
  // A pasta atual vem do estado em memória (mais novo que o disco durante a escrita).
  const local = store.conversations
    .filter((c) => c.messages.length || c.id === store.activeId)
    .filter((c) => !query || matchesQuery(c, query));
  const others = groups.filter((g) => !g.current);
  const now = Date.now();
  const item = (c, { key = null, current = false, folder = null } = {}) => h('div', {
    class: `ai-history-item${current && c.id === store.activeId && !readOnlyView ? ' is-active' : ''}`, role: 'listitem',
    'data-id': c.id, 'data-key': key || '',
  },
  h('button', {
    type: 'button', class: 'ai-history-open', 'data-id': c.id, 'data-key': key || '', 'data-root': folder || '',
    'aria-current': current && c.id === store.activeId ? 'true' : null,
  },
  h('span', { class: 'ai-history-name', text: c.title || DEFAULT_TITLE }),
  c.snippet ? h('span', { class: 'ai-history-snippet', text: c.snippet }) : null,
  h('span', { class: 'ai-history-time', text: relativeTime(c.updatedAt, now) })),
  h('span', { class: 'ai-history-actions' },
    h('button', { type: 'button', class: 'ai-history-rename ai-icon-btn', 'data-id': c.id, 'data-key': key || '', 'aria-label': `Renomear conversa "${c.title}"`, title: 'Renomear' }, icon('pencil', 12)),
    h('button', { type: 'button', class: 'ai-history-export ai-icon-btn', 'data-id': c.id, 'data-key': key || '', 'aria-label': `Exportar conversa "${c.title}"`, title: 'Exportar' }, icon('download', 12)),
    h('button', { type: 'button', class: 'ai-history-delete ai-icon-btn', 'data-id': c.id, 'data-key': key || '', 'aria-label': `Apagar conversa "${c.title}"`, title: 'Apagar conversa' }, icon('trash', 12))));
  const sections = [];
  sections.push(h('section', { class: 'ai-history-group is-current', 'aria-label': 'Esta pasta' },
    h('div', { class: 'ai-history-group-title' }, icon('folder-open', 12), h('span', { text: root ? `Esta pasta · ${baseName(root)}` : 'Sem pasta aberta' })),
    local.length
      ? h('div', { class: 'ai-history-items', role: 'list' }, local.map((c) => item(c, { current: true })))
      : h('div', { class: 'ai-history-empty', text: query ? 'Nada encontrado nesta pasta.' : 'Nenhuma conversa neste workspace ainda.' })));
  for (const group of others) {
    sections.push(h('section', { class: 'ai-history-group', 'aria-label': group.name, title: group.root || '' },
      h('div', { class: 'ai-history-group-title' }, icon('folder', 12), h('span', { text: group.name })),
      h('div', { class: 'ai-history-items', role: 'list' }, group.conversations.map((c) => item(c, { key: group.key, folder: group.root })))));
  }
  list.replaceChildren(...sections);
}

function matchesQuery(conversation, query) {
  const fold = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = fold(query);
  return fold(conversation.title).includes(q) || conversation.messages.some((m) => fold(stripAgentMarker(m.content)).includes(q));
}

async function openHistory() {
  closeMenu();
  $('#ai-history').hidden = false;
  $('#ai-history-btn').setAttribute('aria-expanded', 'true');
  await renderHistoryList();
  ($('.ai-history-item.is-active .ai-history-open') || $('#ai-history-query')).focus();
}

/** Abre uma conversa de outra pasta: somente leitura, com opção de abrir a pasta. */
async function openOtherConversation(key, id) {
  let data = null;
  try { data = await window.agzos.chat.getConversation(key, id); } catch { data = null; }
  if (!data?.conversation) { toast('Não foi possível abrir a conversa.', 'error'); return; }
  readOnlyView = { key, root: data.root, conversation: data.conversation };
  closeHistory();
  renderMessages();
}

async function renameFromHistory(key, id) {
  const current = !key;
  const conversation = current ? store.conversations.find((c) => c.id === id) : null;
  const row = panel.querySelector(`.ai-history-item[data-id="${CSS.escape(id)}"][data-key="${CSS.escape(key || '')}"]`);
  const nameEl = row?.querySelector('.ai-history-name');
  if (!row || !nameEl) return;
  const input = h('input', { class: 'ai-history-rename-input', type: 'text', value: nameEl.textContent, 'aria-label': 'Novo nome da conversa', maxlength: '60' });
  row.querySelector('.ai-history-open').replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return;
    done = true;
    const title = input.value.replace(/\s+/g, ' ').trim();
    if (save && title) {
      if (current && conversation) { conversation.title = title.slice(0, 60); persist(); }
      else if (!current) await window.agzos.chat.renameConversation(key, id, title).catch(() => toast('Não foi possível renomear.', 'error'));
    }
    renderHistoryList();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(true); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); commit(false); }
  });
  input.addEventListener('blur', () => commit(true));
}

function confirmDelete(key, id) {
  const row = panel.querySelector(`.ai-history-item[data-id="${CSS.escape(id)}"][data-key="${CSS.escape(key || '')}"]`);
  if (!row || row.querySelector('.ai-history-confirm')) return;
  const box = h('div', { class: 'ai-history-confirm', role: 'alertdialog', 'aria-label': 'Confirmar exclusão' },
    h('span', { text: 'Apagar esta conversa?' }),
    h('button', { type: 'button', class: 'ai-history-confirm-yes' }, h('span', { text: 'Apagar' })),
    h('button', { type: 'button', class: 'ai-history-confirm-no' }, h('span', { text: 'Cancelar' })));
  row.append(box);
  box.querySelector('.ai-history-confirm-no').addEventListener('click', () => box.remove());
  box.querySelector('.ai-history-confirm-yes').addEventListener('click', async () => {
    if (!key) deleteConversation(id);
    else {
      await window.agzos.chat.deleteConversation(key, id).catch(() => toast('Não foi possível apagar.', 'error'));
      if (readOnlyView?.key === key && readOnlyView.conversation.id === id) { readOnlyView = null; renderMessages(); }
    }
    renderHistoryList();
  });
  box.querySelector('.ai-history-confirm-yes').focus();
}

/** Exportar (Markdown/PDF). Conversa da pasta atual é gravada antes. */
async function exportConversation(key, id, format) {
  try {
    let fileKey = key;
    if (!fileKey) {
      await persist();
      const groups = await window.agzos.chat.allHistory({ currentRoot: root });
      fileKey = groups.find((g) => g.current)?.key;
    }
    if (!fileKey) { toast('Nada para exportar ainda.', 'info'); return; }
    const saved = await window.agzos.chat.exportConversation(fileKey, id, format);
    if (saved) toast(`Conversa exportada: ${baseName(saved)}`, 'success');
  } catch (error) {
    toast(`Não foi possível exportar: ${error?.message || error}`, 'error');
  }
}

function exportMenu(anchor, key, id) {
  openMenu(anchor, [
    { heading: 'Exportar conversa' },
    { label: 'Exportar como Markdown', icon: 'file-text', action: () => exportConversation(key, id, 'md') },
    { label: 'Exportar como PDF', icon: 'file-down', action: () => exportConversation(key, id, 'pdf') },
  ], { align: 'end' });
}

function closeHistory({ restoreFocus = false } = {}) {
  if (!panel || $('#ai-history').hidden) return;
  $('#ai-history').hidden = true;
  $('#ai-history-btn').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('#ai-history-btn').focus();
}

/* ------------------------------------------------------------------ */
/* Menus flutuantes (perfil·modelo e ⋯)                                */
/* ------------------------------------------------------------------ */

function closeMenu({ restoreFocus = false } = {}) {
  if (!menuState) return;
  const { el, anchor } = menuState;
  menuState = null;
  el.remove();
  anchor.setAttribute('aria-expanded', 'false');
  if (restoreFocus) anchor.focus();
}

function openMenu(anchor, items, { align = 'start', placement = 'below' } = {}) {
  if (menuState?.anchor === anchor) { closeMenu({ restoreFocus: true }); return; }
  closeMenu();
  const menu = h('div', { class: 'ai-menu', role: 'menu' });
  for (const item of items) {
    if (item.separator) { menu.append(h('div', { class: 'ai-menu-sep', role: 'separator' })); continue; }
    if (item.heading) { menu.append(h('div', { class: 'ai-menu-heading', role: 'presentation', text: item.heading })); continue; }
    const role = item.checked === undefined ? 'menuitem' : 'menuitemradio';
    const btn = h('button', {
      type: 'button', class: 'ai-menu-item', role, tabindex: '-1',
      'aria-checked': item.checked === undefined ? null : String(!!item.checked), disabled: item.disabled || null,
      'data-value': item.value || null,
    },
    h('span', { class: 'ai-menu-icon' }, item.checked ? icon('check', 13) : (item.icon ? icon(item.icon, 13) : null)),
    item.detail
      ? h('span', { class: 'ai-menu-text' }, h('span', { class: 'ai-menu-label', text: item.label }), h('span', { class: 'ai-menu-detail', text: item.detail }))
      : h('span', { class: 'ai-menu-label', text: item.label }),
    item.badge ? h('span', { class: 'ai-menu-badge', title: item.badgeTitle || null, text: item.badge }) : null);
    if (item.detail) btn.classList.add('has-detail');
    btn.addEventListener('click', () => { closeMenu({ restoreFocus: true }); item.action?.(); });
    menu.append(btn);
  }
  panel.append(menu);
  const p = panel.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const width = menu.offsetWidth;
  let left = align === 'end' ? a.right - p.left - width : a.left - p.left;
  left = Math.max(6, Math.min(left, p.width - width - 6));
  menu.style.left = `${left}px`;
  if (placement === 'above') {
    menu.style.maxHeight = `${Math.max(120, a.top - p.top - 12)}px`;
    menu.style.top = `${Math.max(6, a.top - p.top - menu.offsetHeight - 4)}px`;
  } else {
    menu.style.top = `${a.bottom - p.top + 4}px`;
    menu.style.maxHeight = `${Math.max(120, p.height - (a.bottom - p.top) - 12)}px`;
  }
  anchor.setAttribute('aria-expanded', 'true');
  menuState = { el: menu, anchor };
  const enabled = () => [...menu.querySelectorAll('.ai-menu-item:not([disabled])')];
  (menu.querySelector('.ai-menu-item[aria-checked="true"]:not([disabled])') || enabled()[0])?.focus();
  menu.addEventListener('keydown', (event) => {
    const list = enabled();
    const index = list.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); list[(index + 1) % list.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); list[(index - 1 + list.length) % list.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); list[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); list.at(-1)?.focus(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu({ restoreFocus: true }); }
    else if (event.key === 'Tab') closeMenu();
  });
}

function openModelMenu() {
  const items = [{ heading: 'Perfil' }];
  for (const p of profiles) {
    items.push({ label: p.label, checked: p.id === selectedProfile?.id, action: () => selectProfile(p.id) });
  }
  items.push({ separator: true }, { heading: 'Modelo' });
  const choices = models.length ? models : [selectedModel].filter(Boolean);
  for (const m of choices) items.push({ label: m, checked: m === selectedModel, action: () => { selectedModel = m; updatePill(); } });
  if (!choices.length) items.push({ label: 'Nenhum modelo listado', disabled: true });
  items.push({ separator: true }, { label: 'Gerenciar provedores…', icon: 'settings', action: openWizard });
  openMenu($('#ai-model-pill'), items);
}

function openMoreMenu() {
  const dock = window.AgzosAiDock;
  const pos = currentPosition();
  const items = [];
  if (dock?.setPosition) {
    items.push(
      { label: 'Mover para a esquerda', icon: 'panel-left', checked: pos === 'left', action: () => dock.setPosition('left') },
      { label: 'Mover para a direita', icon: 'panel-right', checked: pos === 'right', action: () => dock.setPosition('right') },
      { label: 'Mover para baixo', icon: 'panel-bottom', checked: pos === 'bottom', action: () => dock.setPosition('bottom') },
      { separator: true },
    );
  }
  const conversation = activeConversation();
  if (conversation?.messages.length && !readOnlyView) {
    items.push(
      { label: 'Compactar conversa', icon: 'fold-vertical', disabled: !!request, action: () => compactConversation() },
      { separator: true },
    );
    items.push(
      { label: 'Exportar como Markdown', icon: 'file-text', action: () => exportConversation(null, conversation.id, 'md') },
      { label: 'Exportar como PDF', icon: 'file-down', action: () => exportConversation(null, conversation.id, 'pdf') },
      { separator: true },
    );
  } else if (readOnlyView) {
    items.push(
      { label: 'Exportar como Markdown', icon: 'file-text', action: () => exportConversation(readOnlyView.key, readOnlyView.conversation.id, 'md') },
      { label: 'Exportar como PDF', icon: 'file-down', action: () => exportConversation(readOnlyView.key, readOnlyView.conversation.id, 'pdf') },
      { separator: true },
    );
  }
  items.push({ label: 'Configurações da IA', icon: 'settings', action: openAiSettings });
  if (dock?.hide) items.push({ label: 'Fechar painel', icon: 'x', action: () => dock.hide() });
  openMenu($('#ai-more-btn'), items, { align: 'end' });
}

async function openAiSettings() {
  const { openSettingsModal } = await import('./settings-modal.js');
  openSettingsModal('ai');
}
async function openWizard() {
  const { openAIWizard } = await import('./ai-wizard.js');
  await openAIWizard();
}

/* ------------------------------------------------------------------ */
/* Perfis / modelos                                                    */
/* ------------------------------------------------------------------ */

function updatePill() {
  const pill = $('#ai-model-pill');
  $('.ai-pill-profile').textContent = selectedProfile?.label || '';
  $('.ai-pill-model').textContent = selectedModel || selectedProfile?.model || 'modelo';
  pill.title = selectedProfile ? `Perfil ${selectedProfile.label}, modelo ${selectedModel || '—'}` : 'Perfil e modelo';
  pill.setAttribute('aria-label', `Perfil e modelo: ${pill.title}`);
}

async function selectProfile(id) {
  const profile = profiles.find((p) => p.id === id);
  if (!profile || profile === selectedProfile) return;
  selectedProfile = profile;
  selectedModel = profile.model || '';
  models = [];
  updatePill();
  try { await window.agzos.ai.activateProfile(profile.id); } catch { /* segue com o perfil local */ }
  await refreshModels();
}

async function refreshProfiles() {
  try {
    const data = await window.agzos.ai.profiles();
    profiles = data.profiles;
    // Mantém a cópia do renderer em dia (o modal de configurações lê daqui).
    State.settings.ai = { ...(State.settings.ai || {}), profiles, activeProfileId: data.activeProfileId || null };
    const next = profiles.find((p) => p.id === data.activeProfileId) || profiles[0] || null;
    if (next?.id !== selectedProfile?.id) { selectedModel = next?.model || ''; models = []; }
    selectedProfile = next;
    panel.classList.toggle('is-setup', !selectedProfile);
    $('#ai-setup').hidden = !!selectedProfile;
    $('#ai-chat').hidden = !selectedProfile;
    updatePill();
    await refreshModels();
  } catch {
    lastError = { text: 'Não foi possível carregar os perfis de IA.' };
    renderMessages();
  }
}

async function refreshModels() {
  const profile = selectedProfile;
  if (!profile) return;
  try {
    const listed = await window.agzos.ai.models(profile.id);
    if (selectedProfile !== profile) return;
    models = [...new Set([profile.model, ...listed].filter(Boolean))];
    if (!selectedModel || !models.includes(selectedModel)) selectedModel = profile.model || models[0] || '';
    updatePill();
  } catch { /* O modelo salvo ainda pode ser usado se a listagem falhar. */ }
}

/* ------------------------------------------------------------------ */
/* Envio / streaming                                                   */
/* ------------------------------------------------------------------ */

/**
 * Botão do composer: durante a execução, com o composer vazio é "Parar"; com texto
 * (ou anexos) é "Pôr na fila". Fora da execução, "Enviar".
 */
function updateSendButton() {
  if (!panel) return;
  const send = $('#ai-send');
  const hasDraft = !!$('#ai-input').value.trim() || draftAttachments.length > 0;
  const state = request ? (hasDraft ? 'queue' : 'stop') : 'send';
  if (send.dataset.state === state) return;
  send.dataset.state = state;
  const label = state === 'stop' ? 'Parar resposta' : state === 'queue' ? 'Pôr na fila (envia quando a execução terminar)' : 'Enviar mensagem';
  send.setAttribute('aria-label', label);
  send.title = label;
  send.replaceChildren(icon(state === 'stop' ? 'square' : state === 'queue' ? 'list-plus' : 'arrow-up', state === 'stop' ? 12 : 15));
}

function setStreaming(active) {
  // Nova conversa e histórico continuam ativos durante a execução (o pedido segue
  // na conversa dele); só o perfil/modelo fica travado.
  $('#ai-model-pill').disabled = active;
  panel.classList.toggle('is-streaming', active);
  updateSendButton();
}

function finish(id, error) {
  if (!request || request.id !== id) return;
  const { message, conversationId } = request;
  const conversation = store.conversations.find((c) => c.id === conversationId);
  if (error === 'Interrompido') {
    message.content += ' _(interrompida)_';
  } else if (error) {
    if (!message.content && conversation) conversation.messages = conversation.messages.filter((m) => m !== message);
    lastError = { text: isVisionError(error) ? `${error}` : error, retry: !isVisionError(error) };
  }
  if (conversation) conversation.updatedAt = Date.now();
  request = null;
  setStreaming(false);
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  renderMessages();
  persist();
  afterRun({ ok: !error, interrupted: error === 'Interrompido' });
}

/**
 * Fim de uma execução: "Enviar agora" pendente no modo Chat vai primeiro; senão, se
 * terminou bem, a fila anda (uma mensagem por vez, na ordem). Erro/parada pausa a fila.
 */
function afterRun({ ok }) {
  if (sendAfterStop) {
    const item = sendAfterStop;
    sendAfterStop = null;
    setTimeout(() => sendItem(item), 0);
    return;
  }
  if (ok && queue.length) {
    const [next, ...rest] = queue;
    queue = rest;
    renderQueue();
    setTimeout(() => sendItem(next), 0);
  }
}

function sendItem(item) {
  if (request) { queue.unshift(item); renderQueue(); return; }
  sendToChat(item.content, { attachments: item.attachments });
}

function retryLast() {
  if (request) return;
  const conversation = activeConversation();
  if (!conversation) return;
  const index = conversation.messages.map((m) => m.role).lastIndexOf('user');
  if (index < 0) return;
  const { content, attachments } = conversation.messages[index];
  conversation.messages = conversation.messages.slice(0, index);
  lastError = null;
  sendToChat(content, { attachments });
}

/** Perfil marcado sem visão + imagem anexada → avisa e não envia. */
function visionBlocked(attachments) {
  if (selectedProfile?.vision !== false) return false;
  if (!attachments?.some((a) => a.kind === 'image')) return false;
  lastError = { text: `O perfil "${selectedProfile.label}" está marcado como sem visão: o modelo não aceita imagens. Troque de modelo/perfil ou remova a imagem.` };
  renderMessages();
  return true;
}

export function sendToChat(text, opts = {}) {
  const content = String(text || '').trim();
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  if ((!content && !attachments.length) || request || loadingHistory || !selectedProfile || !panel) return;
  if (visionBlocked(attachments)) return;
  if (readOnlyView) { readOnlyView = null; }
  // Histórico grande: compacta antes (resumo com o modelo atual) e então envia.
  if (!opts.skipCompact && shouldAutoCompact({ content, attachments })) {
    compactConversation({ auto: true }).then((result) => {
      if (result === 'cancelled') {
        // Parou durante a compactação: a mensagem volta para a fila (pausada), nada se perde.
        queue.unshift({ id: crypto.randomUUID(), content, attachments });
        renderQueue();
        return;
      }
      sendToChat(content, { ...opts, attachments, skipCompact: true });
    });
    return;
  }
  // Ações do editor (Explicar/Refatorar…) e o fallback seguem pelo chat.
  if (!opts.forceChat && !opts.includeSelection && isAgentOn()) { runAgent(content, opts); return; }
  const skill = opts.forceChat ? resolveSkill(skills, 'chat', false) : currentSkill();
  lastError = null;
  closeHistory();
  let conversation = activeConversation();
  if (!conversation) {
    conversation = { id: crypto.randomUUID(), title: DEFAULT_TITLE, updatedAt: Date.now(), messages: [] };
    store = addConversation(store, conversation);
  }
  if (!conversation.messages.some((m) => m.role === 'user')) conversation.title = makeTitle(content || attachments[0]?.name);
  conversation.messages.push({ role: 'user', content, ...(attachments.length ? { attachments } : {}) });
  conversation.messages = conversation.messages.slice(-(MAX_MESSAGES - 1));
  conversation.updatedAt = Date.now();
  const payload = modelMessages(conversation.messages).map((m) => payloadMessage(m, stripAgentMarker));
  const contextMessage = makeContextMessage(opts.includeSelection);
  if (contextMessage) payload.unshift({ role: 'system', content: contextMessage });
  const model = selectedModel || selectedProfile.model;
  const answer = { role: 'assistant', content: '', model, skill: skill.id };
  conversation.messages.push(answer);
  const id = crypto.randomUUID();
  request = { id, message: answer, el: null, conversationId: conversation.id };
  setStreaming(true);
  renderMessages();
  persist();
  window.agzos.ai.chat(id, {
    profileId: selectedProfile.id, model, messages: payload, skill: skill.id, root: State.workspaceRoot || null,
  }).catch(() => finish(id, 'Não foi possível iniciar a conversa.'));
}

export function focusChat() {
  const dock = window.AgzosAiDock;
  if (dock?.show) {
    dock.show({ focus: true });
  } else {
    if (document.body.classList.contains('sidebar-hidden')) document.getElementById('btn-toggle-sidebar')?.click();
    document.querySelector('.activity-btn[data-view="ai"]')?.click();
  }
  requestAnimationFrame(() => document.getElementById('ai-input')?.focus());
}

/* ------------------------------------------------------------------ */
/* Agente                                                              */
/* ------------------------------------------------------------------ */

function cancelRequest() {
  if (!request) return Promise.resolve();
  const { id, agent } = request;
  if (request.compact) return Promise.resolve(window.agzos.ai.cancel(id)).catch(() => {});
  if (!agent) {
    // Se o main não confirmar (pedido já sumiu lá), fecha aqui para não travar o painel.
    setTimeout(() => { if (request?.id === id) finish(id, 'Interrompido'); }, 2500);
    return Promise.resolve(window.agzos.ai.cancel(id)).catch(() => {});
  }
  agent.turn.cancelled = true;
  // Se o motor não confirmar o fim, fecha o turno aqui mesmo.
  setTimeout(() => { if (request?.id === id) finishAgent(id); }, 2500);
  return Promise.resolve(agentApi()?.cancel(id)).catch(() => {});
}

function absPath(p) {
  return joinRoot(State.workspaceRoot || root, p);
}

function agentContext(message, live) {
  return {
    live,
    root: State.workspaceRoot || root,
    approve: (callId, decision) => approveStep(message, callId, decision),
    openFile: (p) => openFile(absPath(p)),
    showDiff: (step, diff) => showStepDiff(step, diff),
    undo: (turn) => undoTurn(message, turn),
    chatFallback: () => chatFallback(message),
    openFolder: () => openFolderForAgent(),
    onApprovalShown: (card) => {
      // Foco vai para o cartão só se o usuário já está no painel (não rouba do editor).
      const active = document.activeElement;
      if (!active || active === document.body || panel.contains(active)) card.focus({ preventScroll: true });
      requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest' }));
      // Barra de status/aria: anuncia o pedido de aprovação.
      card.setAttribute('aria-live', 'assertive');
    },
    onText: (el, isLive) => { if (!isLive) highlightCode(el); },
    runPlan: (turn) => runPlan(turn),
    continueRun: () => continueRun(),
  };
}

/** "Continuar" depois do limite de passos: novo pedido que retoma a tarefa. */
const CONTINUE_PROMPT = 'Continue a tarefa de onde parou. Não refaça o que já foi feito; confira o estado atual dos arquivos antes de seguir.';
function continueRun() {
  if (request) return;
  // Tarefa longa: compacta antes de continuar se o histórico passou do limite.
  if (shouldAutoCompact({ content: CONTINUE_PROMPT })) {
    compactConversation({ auto: true }).then((result) => { if (result !== 'cancelled' && !request) runAgent(CONTINUE_PROMPT); });
    return;
  }
  runAgent(CONTINUE_PROMPT);
}

/** "Executar plano": muda para o modo Agente e põe o plano no composer para revisar e enviar. */
function runPlan(turn) {
  const plan = agentTurnText(turn).trim();
  if (!plan) return;
  setSkill('agent');
  const input = $('#ai-input');
  input.value = `Execute este plano, passo a passo, marcando o que concluir:\n\n${plan}`;
  autoGrow();
  updateSendButton();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function runAgent(content, opts = {}) {
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const skill = currentSkill();
  lastError = null;
  closeHistory();
  let conversation = activeConversation();
  if (!conversation) {
    conversation = { id: crypto.randomUUID(), title: DEFAULT_TITLE, updatedAt: Date.now(), messages: [] };
    store = addConversation(store, conversation);
  }
  if (!opts.resend) {
    if (!conversation.messages.some((m) => m.role === 'user')) conversation.title = makeTitle(content || attachments[0]?.name);
    conversation.messages.push({ role: 'user', content, ...(attachments.length ? { attachments } : {}) });
  }
  conversation.messages = conversation.messages.slice(-(MAX_MESSAGES - 1));
  conversation.updatedAt = Date.now();
  const payload = modelMessages(conversation.messages).map((m) => payloadMessage(m, stripAgentMarker));
  const contextMessage = makeContextMessage(false);
  if (contextMessage) payload.unshift({ role: 'system', content: contextMessage });
  const mode = agentMode();
  const turn = createAgentTurn(mode, skill.id);
  const model = selectedModel || selectedProfile.model;
  const answer = { role: 'assistant', content: '', agent: turn, model, skill: skill.id };
  conversation.messages.push(answer);
  const id = crypto.randomUUID();
  request = { id, message: answer, el: null, conversationId: conversation.id, agent: { turn, view: null } };
  setStreaming(true);
  renderMessages();
  request.agent.view = turnViews.get(answer);
  persist();
  if (!State.workspaceRoot) {
    onAgentEvent(id, { type: 'error', code: 'no_workspace', message: 'Abra uma pasta para usar o agente.' });
    return;
  }
  Promise.resolve()
    .then(() => agentApi().run(id, {
      profileId: selectedProfile.id, model, messages: payload, mode, skill: skill.id,
      root: State.workspaceRoot, conversationId: conversation.id,
    }))
    .catch((error) => onAgentEvent(id, { type: 'error', message: error?.message || 'Não foi possível iniciar o agente.' }));
}

let treeTimer = null;
function refreshWorkspaceViews() {
  clearTimeout(treeTimer);
  treeTimer = setTimeout(() => {
    import('./command-palette.js').then((m) => m.invalidateQuickOpenCache?.()).catch(() => {});
    import('./file-tree.js').then((m) => m.refreshTree?.()).catch(() => {});
  }, 150);
}

function onFileChanged(filePath) {
  if (!filePath) return;
  handleExternalChange(absPath(filePath)).catch(() => {});
  refreshWorkspaceViews();
}

function onAgentEvent(id, evt) {
  if (evt?.type === 'file_changed') onFileChanged(evt.path);
  if (!request?.agent || request.id !== id) return;
  if (evt?.type === 'user_steer') steerPending.delete(evt.id);
  const { kind } = applyAgentEvent(request.agent.turn, evt);
  if (kind === 'done' || kind === 'error') { finishAgent(id); return; }
  if (kind) queueRender();
}

function finishAgent(id) {
  if (!request || request.id !== id || !request.agent) return;
  const { message, conversationId, agent } = request;
  const { turn, view } = agent;
  if (!turn.done && !turn.error) settleSteps(turn);
  const conversation = store.conversations.find((c) => c.id === conversationId);
  message.content = encodeAgentContent(turn, State.workspaceRoot || root);
  if (conversation) conversation.updatedAt = Date.now();
  request = null;
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  view?.sync();
  view?.setLive(false);
  setStreaming(false);
  renderMessages();
  persist();
  if (turn.done?.changes?.length) refreshWorkspaceViews();
  // "Enviar agora" aceito mas não incorporado (ex.: limite de passos) volta para a fila.
  if (steerPending.size) {
    queue = [...steerPending.values(), ...queue];
    steerPending.clear();
    renderQueue();
  }
  afterRun({ ok: !turn.error && !turn.cancelled });
}

function approveStep(message, callId, decision) {
  if (!request?.agent || request.message !== message) return;
  const step = request.agent.turn.steps[callId];
  if (!step || step.status !== 'awaiting') return;
  step.approval = null;
  step.status = decision === 'deny' ? 'denied' : 'running';
  request.agent.view.sync();
  // Devolve o foco ao composer depois de decidir (o cartão some).
  if (panel.contains(document.activeElement) || document.activeElement === document.body) $('#ai-input').focus({ preventScroll: true });
  Promise.resolve(agentApi()?.approve(request.id, callId, decision)).catch(() => toast('Não foi possível enviar a decisão ao agente.', 'error'));
}

async function showStepDiff(step, diff) {
  const { showDiff } = await import('./diff-view.js');
  const rel = relativePath(diff.path || step.input?.path || '', State.workspaceRoot || root);
  showDiff({
    title: rel ? `Agente: ${rel}` : 'Agente: diff',
    original: diff.before ?? '', modified: diff.after ?? '',
    language: languageForPath(diff.path || ''), readOnly: true,
  });
}

async function undoTurn(message, turn) {
  const api = agentApi();
  if (!api || !turn.done?.checkpointId) return;
  let result;
  try {
    result = await api.undo(turn.done.checkpointId);
  } catch (error) {
    toast(`Não foi possível desfazer: ${error?.message || error}`, 'error');
    turnViews.get(message)?.setLive(false);
    return;
  }
  const errors = Array.isArray(result?.errors) ? result.errors : [];
  const restored = Array.isArray(result?.restored) ? result.restored : [];
  turn.undone = errors.length === 0 || restored.length > 0;
  message.content = encodeAgentContent(turn, State.workspaceRoot || root);
  decodedTurns.set(message, turn);
  for (const p of restored) handleExternalChange(absPath(p)).catch(() => {});
  for (const change of turn.done.changes || []) if (!restored.includes(change.path)) handleExternalChange(absPath(change.path)).catch(() => {});
  refreshWorkspaceViews();
  turnViews.get(message)?.setLive(false);
  persist();
  if (errors.length) toast(`Desfeito em parte: ${errors.length} ${errors.length === 1 ? 'arquivo falhou' : 'arquivos falharam'}.`, 'error');
  else toast(`${restored.length || (turn.done.changes || []).length} ${restored.length === 1 ? 'arquivo restaurado' : 'arquivos restaurados'}.`, 'success');
}

function chatFallback(message) {
  if (request) return;
  const conversation = activeConversation();
  if (!conversation) return;
  const index = conversation.messages.indexOf(message);
  const userIndex = conversation.messages.slice(0, index < 0 ? undefined : index).map((m) => m.role).lastIndexOf('user');
  if (userIndex < 0) return;
  const { content } = conversation.messages[userIndex];
  const { attachments } = conversation.messages[userIndex];
  conversation.messages = conversation.messages.slice(0, userIndex);
  setSkill('chat');
  sendToChat(content, { forceChat: true, attachments });
}

/** Abrir a pasta de uma conversa de outra pasta (o diálogo nativo libera no guard). */
async function openReadOnlyFolder(folder) {
  openAfterLoad = readOnlyView?.conversation?.id || null;
  const { openWorkspace } = await import('./file-tree.js');
  try { await openWorkspace(folder); } catch { /* cai no diálogo abaixo */ }
  if (State.workspaceRoot !== folder) await openFolderForAgent();
}

async function openFolderForAgent() {
  const folder = await window.agzos.dialog?.openFolder?.();
  if (!folder) return;
  const { openWorkspace } = await import('./file-tree.js');
  await openWorkspace(folder);
}

function syncAgentBar() {
  if (!panel) return;
  const bar = $('#ai-agent-bar');
  bar.hidden = false;
  const skill = currentSkill();
  const on = isAgentOn();
  panel.classList.toggle('is-agent', on);
  panel.dataset.skill = skill.id;
  const skillBtn = $('#ai-skill-btn');
  skillBtn.dataset.skill = skill.id;
  skillBtn.querySelector('.ai-skill-icon').replaceChildren(icon(skill.icon || 'sparkles', 12));
  skillBtn.querySelector('.ai-skill-label').textContent = skill.label;
  skillBtn.title = `Modo: ${skill.label}${skill.description ? ` — ${skill.description}` : ''}`;
  skillBtn.setAttribute('aria-label', `Modo de resposta: ${skill.label}. Trocar modo`);
  const mode = agentMode();
  const info = AGENT_MODE_INFO[mode];
  const btn = $('#ai-agent-mode');
  // Autonomia vale para os modos que editam (Plan só lê: não mostra).
  btn.hidden = !on || (Array.isArray(skill.tools) && !skill.tools.some((t) => !['list_dir', 'read_file', 'search', 'read_terminal', 'get_problems'].includes(t)));
  btn.dataset.mode = mode;
  btn.querySelector('.ai-mode-icon').replaceChildren(icon(info.icon, 12));
  btn.querySelector('.ai-mode-label').textContent = info.label;
  btn.title = `${info.title}: ${info.desc}${skill.readOnly ? ' (neste modo, toda escrita pede OK)' : ''}`;
  btn.setAttribute('aria-label', `Autonomia do agente: ${info.title}. ${info.desc}`);
  const input = $('#ai-input');
  const placeholders = {
    plan: 'Descreva o que quer planejar…',
    debugger: 'Cole o erro ou descreva o que está falhando…',
    'site-builder': 'Que site ou página vamos criar?',
    security: 'O que auditar? (ex.: "audite o projeto todo")',
  };
  input.placeholder = on
    ? (State.workspaceRoot ? (placeholders[skill.id] || 'Peça uma mudança, um bug para corrigir ou algo para criar…') : 'Abra uma pasta para o agente trabalhar…')
    : 'Pergunte sobre o código ou peça uma mudança…';
}

/** Recarrega as skills (embutidas, do usuário e do projeto). Falha → mantém as atuais. */
async function refreshSkills() {
  const api = agentApi();
  if (!api?.skills) { skills = FALLBACK_SKILLS.slice(); syncAgentBar(); return skills; }
  try {
    const data = await api.skills({ root: State.workspaceRoot || null });
    if (Array.isArray(data?.skills) && data.skills.length) skills = data.skills;
  } catch { /* segue com as já carregadas */ }
  syncAgentBar();
  return skills;
}

/**
 * Skill do projeto (.agzos/skills) só roda depois que o usuário confia nela: diálogo com
 * caminho, hash e primeiras linhas do prompt. Recarrega a lista antes (o arquivo pode ter
 * mudado). → true se confiável (já era ou o usuário confiou agora).
 */
async function ensureSkillTrusted(skill) {
  if (!skill || skill.source !== 'project') return true;
  await refreshSkills();
  const fresh = skills.find((s) => s.id === skill.id);
  if (!fresh) { toast('A skill do projeto não existe mais.', 'error'); return false; }
  if (fresh.trusted) return true;
  const api = agentApi();
  if (!api?.trustSkill) return false;
  const ok = await openGitDialog({
    id: 'ai-skill-trust',
    title: `Confiar na skill "${fresh.label}"?`,
    icon: 'shield-alert',
    description: 'Esta skill vem do repositório aberto, não do Agzos nem de você. Ela muda as instruções da IA; '
      + 'só confie se você conhece o conteúdo. As regras de segurança e as aprovações continuam valendo.',
    fields: [
      { name: 'path', label: 'Arquivo', value: fresh.relPath || fresh.file || '' },
      { name: 'hash', label: 'sha256', value: fresh.sha256Short || '' },
      { name: 'prompt', label: 'Primeiras linhas do prompt', type: 'textarea', rows: 8, value: fresh.preview || '' },
    ],
    submitLabel: 'Confiar nesta skill',
    cancelLabel: 'Cancelar',
    onOpen: (ctl) => {
      for (const name of ['path', 'hash', 'prompt']) {
        const field = ctl.field(name);
        if (field) { field.readOnly = true; field.classList?.add('ai-skill-trust-readonly'); }
      }
    },
    onSubmit: async () => {
      const res = await api.trustSkill({ root: State.workspaceRoot || null, id: fresh.id, sha256: fresh.sha256 });
      if (!res?.ok) throw new Error(res?.error || 'Não foi possível confiar nesta skill.');
      return true;
    },
  });
  if (!ok) return false;
  await refreshSkills();
  return !!skills.find((s) => s.id === fresh.id)?.trusted;
}

/** Troca o modo (skill) do composer e lembra a escolha. Skill do projeto pede confiança antes. */
async function setSkill(id) {
  const skill = skills.find((s) => s.id === id) || FALLBACK_SKILLS.find((s) => s.id === id);
  if (!skill) return;
  if (skill.source === 'project' && !(await ensureSkillTrusted(skill))) return;
  State.settings.aiPanel = { ...(State.settings.aiPanel || {}), skill: skill.id };
  Promise.resolve(window.agzos.settings?.save?.(State.settings)).catch(() => {});
  syncAgentBar();
}

async function openSkillMenu() {
  const anchor = $('#ai-skill-btn');
  if (menuState?.anchor === anchor) { closeMenu({ restoreFocus: true }); return; }
  await refreshSkills();
  const current = currentSkill();
  const available = skills.filter((skill) => !(skill.kind === 'agent' && !agentApi()));
  const itemFor = (skill) => ({
    label: `${skill.label}${skill.source === 'user' ? ' · seu' : ''}`, detail: skill.description || '', icon: skill.icon || 'sparkles',
    value: skill.id, checked: skill.id === current.id, action: () => { setSkill(skill.id); },
    ...(skill.source === 'project' ? {
      badge: skill.trusted ? 'projeto' : 'projeto · não confiável',
      badgeTitle: `Vem de ${skill.relPath || '.agzos/skills'}${skill.trusted ? '' : ' — pede confirmação antes de usar'}`,
    } : {}),
  });
  const items = [{ heading: 'Modo' }, ...available.filter((s) => s.source !== 'project').map(itemFor)];
  const fromProject = available.filter((s) => s.source === 'project');
  if (fromProject.length) items.push({ separator: true }, { heading: 'Do projeto' }, ...fromProject.map(itemFor));
  items.push({ separator: true }, { label: 'Gerenciar skills…', icon: 'settings', action: openAiSettings });
  openMenu(anchor, items, { placement: 'above' });
}

export function setAgentMode(mode) {
  const next = normalizeAgentMode(mode);
  State.settings.aiAgent = { ...(State.settings.aiAgent || {}), mode: next };
  const api = agentApi();
  const saved = api?.setMode ? api.setMode(next) : window.agzos.settings?.save?.(State.settings);
  Promise.resolve(saved).catch(() => toast('Não foi possível salvar o modo do agente.', 'error'));
  syncAgentBar();
  window.dispatchEvent(new CustomEvent('agzos:agent-mode', { detail: { mode: next } }));
}

function openAgentModeMenu() {
  const current = agentMode();
  openMenu($('#ai-agent-mode'), [
    { heading: 'Autonomia do agente' },
    ...AGENT_MODES.map((mode) => ({
      label: AGENT_MODE_INFO[mode].title, detail: AGENT_MODE_INFO[mode].desc, icon: AGENT_MODE_INFO[mode].icon,
      checked: mode === current, action: () => setAgentMode(mode),
    })),
  ], { placement: 'above' });
}

/** Comando da paleta: escolhe a autonomia do agente. */
export async function pickAgentMode() {
  const { showPicker } = await import('./command-palette.js');
  const current = agentMode();
  showPicker({
    placeholder: 'Autonomia do agente',
    items: AGENT_MODES.map((mode) => ({
      label: AGENT_MODE_INFO[mode].title,
      hint: mode === current ? 'atual' : AGENT_MODE_INFO[mode].label,
      run: () => setAgentMode(mode),
    })),
  });
}

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

function autoGrow() {
  const input = panel && $('#ai-input');
  if (!input) return;
  const style = getComputedStyle(input);
  const line = parseFloat(style.lineHeight) || 18;
  const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const maxLines = panel.classList.contains('is-short') ? 4 : 10;
  input.style.height = 'auto';
  const height = Math.min(input.scrollHeight, line * maxLines + pad);
  input.style.height = `${Math.max(height, line + pad)}px`;
  input.style.overflowY = input.scrollHeight > line * maxLines + pad ? 'auto' : 'hidden';
}

/** Enter/botão: envia; durante a execução põe na fila; com o composer vazio, o botão para. */
function submitComposer({ fromButton = false } = {}) {
  if (loadingHistory) return;
  const input = $('#ai-input');
  const content = input.value.trim();
  const attachments = draftAttachments.slice();
  if (attachBusy) { toast('Espere os anexos terminarem de carregar.', 'info'); return; }
  if (COMPACT_COMMAND.test(content) && !attachments.length) {
    if (request) { toast('Espere a execução terminar para compactar a conversa.', 'info'); return; }
    input.value = '';
    autoGrow();
    updateSendButton();
    compactConversation();
    return;
  }
  if (request) {
    if (!content && !attachments.length) { if (fromButton) cancelRequest(); return; }
    enqueue({ content, attachments });
  } else {
    if (!content && !attachments.length) return;
    if (!selectedProfile) return;
    if (visionBlocked(attachments)) return;
    const skill = currentSkill();
    if (skill.source === 'project' && !skill.trusted) {
      // Pede confiança e reenvia; o texto continua no composer até lá.
      ensureSkillTrusted(skill).then((ok) => { if (ok) submitComposer({ fromButton }); });
      return;
    }
    sendToChat(content, { attachments });
  }
  input.value = '';
  draftAttachments = [];
  renderDraftAttachments();
  autoGrow();
  updateSendButton();
}

/* ----------------------------------------------------------- compactar */

const COMPACT_COMMAND = /^\/(compactar|compact)$/i;
const DEFAULT_COMPACT_THRESHOLD = 60000;

/** Compactação automática: histórico (+ a nova mensagem) passa do limite das Configurações? */
function shouldAutoCompact(next) {
  const settings = aiSettings();
  if (settings.autoCompact === false) return false;
  const conversation = activeConversation();
  if (!conversation) return false;
  const pending = compactableMessages(conversation.messages);
  if (pending.filter((m) => !isSummary(m)).length < 2) return false;
  const threshold = Number(settings.compactThresholdTokens) || DEFAULT_COMPACT_THRESHOLD;
  return estimateTokens([...modelMessages(pending), { role: 'user', ...next }]) > threshold;
}

/**
 * Compactar conversa: o modelo atual resume o que iria ao modelo (último resumo + posteriores)
 * e o resumo entra como mensagem marcada. Daí em diante só ele + as mensagens novas vão ao
 * modelo; as antigas continuam visíveis (esmaecidas) e no export.
 * Falha → erro claro e a conversa fica como estava.
 * @returns {Promise<'ok'|'error'|'cancelled'|'skipped'>}
 */
export async function compactConversation({ auto = false } = {}) {
  if (!panel || loadingHistory || !selectedProfile) return 'skipped';
  if (request) {
    if (!auto) toast('Espere a execução terminar para compactar a conversa.', 'info');
    return 'skipped';
  }
  if (readOnlyView) {
    toast('Esta conversa é somente leitura.', 'info');
    return 'skipped';
  }
  const conversation = activeConversation();
  const pending = compactableMessages(conversation?.messages);
  const count = pending.filter((m) => !isSummary(m)).length;
  if (count < 2) {
    if (!auto) toast('Ainda não há o que compactar nesta conversa.', 'info');
    return 'skipped';
  }
  const payload = modelMessages(pending).map((m) => payloadMessage(m, stripAgentMarker));
  const model = selectedModel || selectedProfile.model;
  const id = crypto.randomUUID();
  request = { id, compact: true, conversationId: conversation.id, message: null, el: null };
  lastError = null;
  closeHistory();
  setStreaming(true);
  renderMessages();
  let result;
  try {
    result = await window.agzos.ai.summarize(id, { profileId: selectedProfile.id, model, messages: payload });
  } catch (error) {
    result = { ok: false, error: `Não foi possível resumir a conversa: ${error?.message || 'erro desconhecido'}` };
  }
  if (request?.id !== id) return 'cancelled';
  request = null;
  setStreaming(false);
  let outcome;
  if (result?.ok) {
    conversation.messages.push({ ...makeSummaryMessage(result.summary, count), model });
    conversation.updatedAt = Date.now();
    persist();
    outcome = 'ok';
  } else if (result?.cancelled) {
    outcome = 'cancelled';
  } else {
    const text = result?.error || 'Não foi possível resumir a conversa.';
    // Automática: avisa e envia mesmo assim (sem compactar).
    if (auto) toast(`${text} A mensagem vai sem compactar.`, 'error');
    else lastError = { text };
    outcome = 'error';
  }
  renderMessages();
  if (!auto) afterRun({ ok: outcome === 'ok' });
  return outcome;
}

/* ----------------------------------------------------------- fila */

function enqueue(item) {
  queue.push({ id: crypto.randomUUID(), content: item.content, attachments: item.attachments || [] });
  renderQueue();
}

function renderQueue() {
  if (!panel) return;
  const box = $('#ai-queue');
  box.hidden = !queue.length;
  box.replaceChildren(...queue.map((item, index) => h('div', { class: 'ai-queue-item', role: 'listitem', 'data-id': item.id },
    h('span', { class: 'ai-queue-pos', 'aria-hidden': 'true', text: String(index + 1) }),
    h('button', {
      type: 'button', class: 'ai-queue-text', 'data-id': item.id, title: `Editar: ${item.content}`,
      'aria-label': `Mensagem na fila: ${item.content || 'anexos'}. Clique para editar`,
    },
    h('span', { text: truncate(item.content, 90) || '(só anexos)' }),
    item.attachments.length ? h('span', { class: 'ai-queue-atts' }, icon('paperclip', 10), h('span', { text: String(item.attachments.length) })) : null),
    h('button', {
      type: 'button', class: 'ai-queue-now ai-icon-btn', 'data-id': item.id,
      'aria-label': 'Enviar agora', title: request ? 'Enviar agora (entra na execução atual sem cancelar)' : 'Enviar agora',
    }, icon('send-horizontal', 13)),
    h('button', { type: 'button', class: 'ai-queue-remove ai-icon-btn', 'data-id': item.id, 'aria-label': 'Remover da fila', title: 'Remover da fila' },
      icon('x', 12)))));
}

function takeQueued(id) {
  const item = queue.find((q) => q.id === id);
  if (item) { queue = queue.filter((q) => q !== item); renderQueue(); }
  return item;
}

/**
 * "Enviar agora": sem execução, envia já. Com o agente rodando, entra na execução
 * (steer) sem cancelar. No modo Chat, interrompe o streaming (mantém o texto parcial)
 * e envia em seguida.
 */
async function sendNow(id) {
  const item = takeQueued(id);
  if (!item) return;
  if (!request) { sendItem(item); return; }
  if (request.compact) {
    // Compactando: a mensagem sai logo depois (não interrompe o resumo).
    queue.unshift(item);
    renderQueue();
    toast('A mensagem sai assim que a compactação terminar.', 'info');
    return;
  }
  if (request.agent) {
    const api = agentApi();
    let accepted = false;
    try { accepted = !!(await api?.steer?.(request.id, { id: item.id, content: item.content, attachments: item.attachments })); } catch { accepted = false; }
    if (accepted) { steerPending.set(item.id, item); return; }
    // Execução já acabando: vira o próximo pedido.
    queue.unshift(item);
    renderQueue();
    return;
  }
  sendAfterStop = item;
  cancelRequest();
}

function editQueued(id) {
  const item = takeQueued(id);
  if (!item) return;
  const input = $('#ai-input');
  input.value = input.value.trim() ? `${input.value}\n${item.content}` : item.content;
  draftAttachments = [...draftAttachments, ...item.attachments];
  renderDraftAttachments();
  autoGrow();
  updateSendButton();
  input.focus();
}

/* ----------------------------------------------------------- anexos */

function renderDraftAttachments() {
  if (!panel) return;
  const box = $('#ai-attachments');
  const busy = attachBusy ? [h('div', { class: 'ai-att is-loading', role: 'listitem' }, h('span', { class: 'ag-spin', 'aria-hidden': 'true' }), h('span', { class: 'ai-att-name', text: 'Anexando…' }))] : [];
  box.hidden = !draftAttachments.length && !attachBusy;
  box.replaceChildren(...draftAttachments.map((a) => attachmentChip(a, { removable: true })), ...busy);
}

async function addAttachments(jobs) {
  if (!jobs.length) return;
  attachBusy++;
  renderDraftAttachments();
  try {
    const results = (await Promise.all(jobs.map((job) => job().catch((error) => [{ ok: false, error: error?.message || String(error) }])))).flat();
    for (const r of results) {
      if (r.ok) { if (!draftAttachments.some((a) => a.id === r.attachment.id)) draftAttachments.push(r.attachment); }
      else toast(r.name ? `${r.name}: ${r.error}` : r.error, 'error');
    }
  } finally {
    attachBusy--;
    renderDraftAttachments();
    updateSendButton();
  }
}

function pickAttachments() {
  addAttachments([() => attachFromMain()]);
}

function onPaste(event) {
  const files = [...(event.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (!files.length) return;
  event.preventDefault();
  addAttachments(files.map((file) => () => attachFile(file).then((r) => [r])));
}

function onDrop(event) {
  const dt = event.dataTransfer;
  if (!dt) return;
  const explorerPath = dt.getData('application/x-agzos-path');
  const files = [...(dt.files || [])];
  if (!explorerPath && !files.length) return;
  event.preventDefault();
  panel.classList.remove('is-dropping');
  if (explorerPath) addAttachments([() => attachFromMain([explorerPath])]);
  else addAttachments(files.map((file) => () => attachFile(file).then((r) => [r])));
  $('#ai-input').focus();
}

/* ----------------------------------------------------------- ferramentas que leem o editor */

function answerAgentQuery(what, args = {}) {
  if (what === 'terminal') {
    const lines = Math.min(1000, Math.max(10, Number(args.lines) || 200));
    return getRecentOutput(lines * 200).split('\n').slice(-lines).join('\n');
  }
  if (what === 'problems') {
    const monaco = getMonaco?.();
    if (!monaco?.editor?.getModelMarkers) return [];
    const sev = { 8: 'erro', 4: 'aviso', 2: 'info', 1: 'dica' };
    return monaco.editor.getModelMarkers({})
      .filter((m) => m.resource?.scheme === 'file')
      .map((m) => ({
        path: m.resource.fsPath || decodeURIComponent(m.resource.path), line: m.startLineNumber, column: m.startColumn,
        severity: sev[m.severity] || 'info', message: m.message, source: m.source || '',
      }))
      .filter((m) => !args.path || m.path === args.path)
      .sort((a, b) => (a.severity === 'erro' ? 0 : 1) - (b.severity === 'erro' ? 0 : 1))
      .slice(0, 300);
  }
  return null;
}

function defaultContext() {
  return { file: true, selection: true, terminal: false, ...(aiSettings().defaultContext || State.settings.ai?.context || {}) };
}

/* ------------------------------------------------------------------ */
/* Ações em blocos de código                                           */
/* ------------------------------------------------------------------ */

function codeAction(button) {
  const code = button.closest('.ai-msg')?.querySelectorAll('pre code')[Number(button.dataset.codeIndex)];
  if (!code) return;
  const text = (codeSource.get(code) ?? code.textContent).replace(/\n$/, '');
  const action = button.dataset.codeAction;
  if (action === 'copy') {
    navigator.clipboard.writeText(text).then(() => {
      const label = button.querySelector('span');
      button.classList.add('is-done');
      button.replaceChildren(icon('check', 13), h('span', { text: 'Copiado' }));
      setTimeout(() => { button.classList.remove('is-done'); button.replaceChildren(icon('copy', 13), label); }, 1400);
    }).catch(() => toast('Não foi possível copiar.', 'error'));
  } else if (action === 'insert') {
    const editor = getActiveEditor();
    const selection = editor?.getSelection();
    if (!State.activePath || !editor?.getModel() || !selection) { toast('Abra um arquivo para inserir o código.', 'error'); return; }
    editor.pushUndoStop();
    editor.executeEdits('agzos-ai', [{ range: selection, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
    editor.focus();
  } else if (action === 'apply') {
    import('./ai-apply.js').then(({ getAITarget, showApplyDiff }) => {
      const target = getAITarget();
      if (target) showApplyDiff({ ...target, newText: text });
      else toast('Abra um arquivo para aplicar o código.', 'error');
    });
  }
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function bindEvents() {
  const input = $('#ai-input');
  input.addEventListener('input', autoGrow);
  input.addEventListener('focus', () => { hookEditor(); updateContextChips(); });
  input.addEventListener('input', updateSendButton);
  input.addEventListener('paste', onPaste);
  input.addEventListener('keydown', (event) => {
    const empty = !input.value.trim() && !draftAttachments.length;
    // Ctrl+Enter com o composer vazio e fila: envia agora a primeira.
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && empty && queue.length) {
      event.preventDefault();
      sendNow(queue[0].id);
      return;
    }
    // Esc com o composer vazio cancela a execução.
    if (event.key === 'Escape' && empty && request) {
      event.preventDefault();
      event.stopPropagation();
      cancelRequest();
      return;
    }
    const action = composerKeyAction(event, aiSettings().sendKey);
    // 'newline' (Shift+Enter) e null seguem o comportamento padrão do textarea.
    if (action === 'send') { event.preventDefault(); submitComposer(); }
  });
  $('#ai-send').addEventListener('click', () => submitComposer({ fromButton: true }));
  $('#ai-attach').addEventListener('click', pickAttachments);
  $('#ai-attachments').addEventListener('click', (event) => {
    const remove = event.target.closest('.ai-att-remove');
    if (!remove) return;
    draftAttachments = draftAttachments.filter((a) => a.id !== remove.dataset.id);
    renderDraftAttachments();
    updateSendButton();
    input.focus();
  });
  $('#ai-queue').addEventListener('click', (event) => {
    const now = event.target.closest('.ai-queue-now');
    if (now) { sendNow(now.dataset.id); return; }
    const remove = event.target.closest('.ai-queue-remove');
    if (remove) { takeQueued(remove.dataset.id); return; }
    const text = event.target.closest('.ai-queue-text');
    if (text) editQueued(text.dataset.id);
  });
  const composer = panel.querySelector('.ai-composer');
  composer.addEventListener('dragover', (event) => {
    const types = [...(event.dataTransfer?.types || [])];
    if (!types.includes('Files') && !types.includes('application/x-agzos-path')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    panel.classList.add('is-dropping');
  });
  composer.addEventListener('dragleave', (event) => { if (!composer.contains(event.relatedTarget)) panel.classList.remove('is-dropping'); });
  composer.addEventListener('drop', onDrop);
  $('#ai-configure').addEventListener('click', openWizard);
  $('#ai-new-chat').addEventListener('click', () => newConversation());
  $('#ai-history-btn').addEventListener('click', () => ($('#ai-history').hidden ? openHistory() : closeHistory({ restoreFocus: true })));
  $('#ai-history-close').addEventListener('click', () => closeHistory({ restoreFocus: true }));
  $('#ai-model-pill').addEventListener('click', openModelMenu);
  $('#ai-more-btn').addEventListener('click', openMoreMenu);
  $('#ai-agent-mode').addEventListener('click', openAgentModeMenu);
  $('#ai-skill-btn').addEventListener('click', openSkillMenu);

  $('#ai-history').addEventListener('click', (event) => {
    if (event.target.closest('.ai-history-confirm')) return;
    const del = event.target.closest('.ai-history-delete');
    if (del) { confirmDelete(del.dataset.key || null, del.dataset.id); return; }
    const rename = event.target.closest('.ai-history-rename');
    if (rename) { renameFromHistory(rename.dataset.key || null, rename.dataset.id); return; }
    const exp = event.target.closest('.ai-history-export');
    if (exp) { exportMenu(exp, exp.dataset.key || null, exp.dataset.id); return; }
    const open = event.target.closest('.ai-history-open');
    if (!open) return;
    if (open.dataset.key) openOtherConversation(open.dataset.key, open.dataset.id);
    else switchConversation(open.dataset.id);
  });
  $('#ai-history-query').addEventListener('input', () => {
    clearTimeout(historyQueryTimer);
    historyQueryTimer = setTimeout(renderHistoryList, 150);
  });
  $('#ai-history').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeHistory({ restoreFocus: true }); }
  });

  panel.querySelectorAll('.ai-context-chip').forEach((chip) => chip.addEventListener('click', () => {
    const key = chip.dataset.context;
    contextOptions[key] = !contextOptions[key];
    updateContextChips();
  }));

  $('#ai-messages').addEventListener('scroll', (event) => {
    // Só acompanha o fim da conversa se o usuário não rolou para cima.
    if (event.target.clientHeight) stickToBottom = isNearBottom(event.target);
  }, { passive: true });
  $('#ai-messages').addEventListener('click', (event) => {
    const codeBtn = event.target.closest('button[data-code-action]');
    if (codeBtn) { codeAction(codeBtn); return; }
    const suggestion = event.target.closest('.ai-suggestion');
    if (suggestion) { sendToChat(suggestion.dataset.prompt); return; }
    if (event.target.closest('.ai-retry')) { retryLast(); return; }
    if (event.target.closest('.ai-readonly-close')) { readOnlyView = null; renderMessages(); return; }
    const openFolderBtn = event.target.closest('.ai-readonly-open');
    if (openFolderBtn) { openReadOnlyFolder(openFolderBtn.dataset.root); return; }
    const link = event.target.closest('a[href]');
    if (link) {
      event.preventDefault();
      if (/^https?:\/\//i.test(link.href)) window.agzos.app?.openExternal?.(link.href);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (menuState && !menuState.el.contains(event.target) && !menuState.anchor.contains(event.target)) closeMenu();
  }, true);

  window.agzos.ai.onChunk((id, text) => { if (request?.id === id) { request.message.content += text; queueRender(); } });
  window.agzos.ai.onDone((id) => finish(id));
  window.agzos.ai.onError((id, error) => finish(id, error));
  agentApi()?.onEvent?.((id, evt) => onAgentEvent(id, evt));
  agentApi()?.onQuery?.((what, args) => answerAgentQuery(what, args));
  window.addEventListener('agzos:workspace-changed', () => { loadHistory(); refreshSkills(); });
  window.addEventListener('agzos:agent-mode', syncAgentBar);
  window.addEventListener('agzos:ai-profiles-changed', refreshProfiles);
  window.addEventListener('agzos:ai-panel-settings', applyAiPanelSettings);
  window.addEventListener('agzos:ai-dock', (event) => {
    closeMenu();
    panel.dataset.position = event.detail?.position || currentPosition();
    if (event.detail?.visible) { updateContextChips(); requestAnimationFrame(pinToBottom); }
  });
}

export function setupAI() {
  panel = ensurePanel();
  buildPanel();
  panel.dataset.position = currentPosition();
  Object.assign(contextOptions, defaultContext());
  bindEvents();
  hookEditor();
  applyAiPanelSettings();
  updateContextChips();
  syncAgentBar();
  observeSize();
  refreshProfiles();
  refreshSkills();
  loadHistory();
}
