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
} from './ai-chat-utils.js';
import { TurnView } from './agent-ui.js';

const State = window.AgzosState;
const IS_MAC = /Mac/i.test(navigator.platform || '');

let panel = null;
const $ = (sel) => panel.querySelector(sel);

let root = null;
let store = { conversations: [], activeId: null };
let request = null; // { id, message, el, conversationId, agent?: { turn, view } }
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
let agentEnabled = null; // null = automático (Agente quando há pasta aberta)
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
/** Agente ligado no composer? Padrão: sim quando há pasta aberta. */
function isAgentOn() {
  if (!agentApi()) return false;
  return agentEnabled == null ? !!State.workspaceRoot : agentEnabled;
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
    buildAgentBar(),
    h('div', { class: 'ai-composer-box' },
      h('textarea', {
        id: 'ai-input', rows: '1', spellcheck: 'true',
        placeholder: 'Pergunte sobre o código ou peça uma mudança…', 'aria-label': 'Mensagem para o Agzos IA',
        'aria-describedby': 'ai-hint',
      }),
      h('div', { class: 'ai-composer-foot' },
        h('div', { class: 'ai-chips', role: 'group', 'aria-label': 'Contexto enviado à IA' },
          chip('file', 'file-text', 'Arquivo'),
          chip('selection', 'text-cursor', 'Seleção'),
          chip('terminal', 'terminal', 'Terminal')),
        h('button', { type: 'button', id: 'ai-send', class: 'ai-send', 'data-state': 'send', 'aria-label': 'Enviar mensagem', title: 'Enviar mensagem' },
          icon('arrow-up', 15)))),
    h('div', { id: 'ai-hint', class: 'ai-hint' }));
}

function buildAgentBar() {
  const seg = (value, iconName, label, title) => h('button', {
    type: 'button', class: 'ai-seg-btn', role: 'radio', 'data-agent': value, 'aria-checked': 'false', title,
  }, icon(iconName, 12), h('span', { text: label }));
  return h('div', { id: 'ai-agent-bar', class: 'ai-agent-bar' },
    h('div', { class: 'ai-seg', role: 'radiogroup', 'aria-label': 'Modo de resposta' },
      seg('agent', 'bot', 'Agente', 'Agente: lê, edita e roda comandos no projeto aberto'),
      seg('chat', 'message-circle', 'Chat', 'Chat: só responde, não mexe nos arquivos')),
    h('button', {
      type: 'button', id: 'ai-agent-mode', class: 'ai-mode-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    }, h('span', { class: 'ai-mode-icon' }), h('span', { class: 'ai-mode-label' }), icon('chevron-down', 11)));
}

function buildHistory() {
  return h('div', { id: 'ai-history', class: 'ai-history', role: 'dialog', 'aria-label': 'Conversas', hidden: true },
    h('div', { class: 'ai-history-head' },
      h('span', { class: 'ai-history-title', text: 'Conversas' }),
      iconButton('ai-history-close', 'x', 'Fechar conversas')),
    h('ul', { id: 'ai-history-list', class: 'ai-history-list' }));
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
    if (file) context.file = {
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

function agentMessageElement(message, turn) {
  const live = request?.message === message;
  let view = turnViews.get(message);
  if (!view) {
    view = new TurnView(turn, agentContext(message, live));
    turnViews.set(message, view);
  }
  const el = h('div', { class: `ai-msg ai-assistant ai-agent-msg${live ? ' is-streaming' : ''}`, 'aria-busy': live ? 'true' : null },
    h('div', { class: 'ai-avatar', 'aria-hidden': 'true' }, mark('ai-avatar-mark')), view.el);
  if (live) request.el = el;
  return el;
}

function messageElement(message) {
  if (message.role === 'user') {
    return h('div', { class: 'ai-msg ai-user' }, h('div', { class: 'ai-bubble', text: message.content }));
  }
  const turn = agentTurnOf(message);
  if (turn) return agentMessageElement(message, turn);
  const streaming = request?.message === message;
  const prose = h('div', { class: 'ai-prose' });
  const el = h('div', { class: `ai-msg ai-assistant${streaming ? ' is-streaming' : ''}`, 'aria-busy': streaming ? 'true' : null },
    h('div', { class: 'ai-avatar', 'aria-hidden': 'true' }, mark('ai-avatar-mark')), prose);
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

function renderMessages() {
  if (!panel) return;
  const list = $('#ai-messages');
  const items = messages();
  const children = [items.length ? h('div', { class: 'ai-thread' }, items.map(messageElement)) : welcomeElement()];
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
    ...c, messages: c.messages.map(({ role, content }) => ({ role, content })),
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
    renderMessages();
  } catch {
    if (version === loadVersion) { lastError = { text: 'Não foi possível carregar o histórico.' }; renderMessages(); }
  } finally {
    if (version === loadVersion) { loadingHistory = false; $('#ai-input').disabled = false; }
  }
}

function newConversation({ focus = true } = {}) {
  if (request) return;
  const current = activeConversation();
  lastError = null;
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
  if (request || !store.conversations.some((c) => c.id === id)) return;
  store = { ...store, activeId: id };
  lastError = null;
  closeHistory();
  renderMessages();
  persist();
  $('#ai-input').focus();
}

function deleteConversation(id) {
  if (request) return;
  const conversations = store.conversations.filter((c) => c.id !== id);
  const activeId = store.activeId === id ? (conversations[0]?.id ?? null) : store.activeId;
  store = { conversations, activeId };
  renderHistoryList();
  renderMessages();
  persist();
}

function renderHistoryList() {
  const list = $('#ai-history-list');
  const items = store.conversations.filter((c) => c.messages.length || c.id === store.activeId);
  if (!items.length) {
    list.replaceChildren(h('li', { class: 'ai-history-empty', text: 'Nenhuma conversa neste workspace ainda.' }));
    return;
  }
  const now = Date.now();
  list.replaceChildren(...items.map((c) => h('li', { class: `ai-history-item${c.id === store.activeId ? ' is-active' : ''}` },
    h('button', { type: 'button', class: 'ai-history-open', 'data-id': c.id, 'aria-current': c.id === store.activeId ? 'true' : null },
      h('span', { class: 'ai-history-name', text: c.title || DEFAULT_TITLE }),
      h('span', { class: 'ai-history-time', text: relativeTime(c.updatedAt, now) })),
    h('button', { type: 'button', class: 'ai-history-delete ai-icon-btn', 'data-id': c.id, 'aria-label': `Apagar conversa "${c.title}"`, title: 'Apagar conversa' },
      icon('trash', 13)))));
}

function openHistory() {
  if (request) return;
  closeMenu();
  renderHistoryList();
  $('#ai-history').hidden = false;
  $('#ai-history-btn').setAttribute('aria-expanded', 'true');
  ($('.ai-history-item.is-active .ai-history-open') || $('.ai-history-open') || $('#ai-history-close')).focus();
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
    },
    h('span', { class: 'ai-menu-icon' }, item.checked ? icon('check', 13) : (item.icon ? icon(item.icon, 13) : null)),
    item.detail
      ? h('span', { class: 'ai-menu-text' }, h('span', { class: 'ai-menu-label', text: item.label }), h('span', { class: 'ai-menu-detail', text: item.detail }))
      : h('span', { class: 'ai-menu-label', text: item.label }));
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

function setStreaming(active) {
  const send = $('#ai-send');
  send.dataset.state = active ? 'stop' : 'send';
  send.setAttribute('aria-label', active ? 'Parar resposta' : 'Enviar mensagem');
  send.title = send.getAttribute('aria-label');
  send.replaceChildren(icon(active ? 'square' : 'arrow-up', active ? 12 : 15));
  for (const id of ['#ai-new-chat', '#ai-history-btn', '#ai-model-pill']) $(id).disabled = active;
  panel.querySelectorAll('.ai-seg-btn').forEach((b) => { b.disabled = active; });
  panel.classList.toggle('is-streaming', active);
}

function finish(id, error) {
  if (!request || request.id !== id) return;
  const { message, conversationId } = request;
  const conversation = store.conversations.find((c) => c.id === conversationId);
  if (error === 'Interrompido') {
    message.content += ' _(interrompida)_';
  } else if (error) {
    if (!message.content && conversation) conversation.messages = conversation.messages.filter((m) => m !== message);
    lastError = { text: error, retry: true };
  }
  if (conversation) conversation.updatedAt = Date.now();
  request = null;
  setStreaming(false);
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  renderMessages();
  persist();
}

function retryLast() {
  if (request) return;
  const conversation = activeConversation();
  if (!conversation) return;
  const index = conversation.messages.map((m) => m.role).lastIndexOf('user');
  if (index < 0) return;
  const { content } = conversation.messages[index];
  conversation.messages = conversation.messages.slice(0, index);
  lastError = null;
  sendToChat(content);
}

export function sendToChat(text, opts = {}) {
  const content = String(text || '').trim();
  if (!content || request || loadingHistory || !selectedProfile || !panel) return;
  // Ações do editor (Explicar/Refatorar…) e o fallback seguem pelo chat.
  if (!opts.forceChat && !opts.includeSelection && isAgentOn()) { runAgent(content, opts); return; }
  lastError = null;
  closeHistory();
  let conversation = activeConversation();
  if (!conversation) {
    conversation = { id: crypto.randomUUID(), title: DEFAULT_TITLE, updatedAt: Date.now(), messages: [] };
    store = addConversation(store, conversation);
  }
  if (!conversation.messages.some((m) => m.role === 'user')) conversation.title = makeTitle(content);
  conversation.messages.push({ role: 'user', content });
  conversation.messages = conversation.messages.slice(-(MAX_MESSAGES - 1));
  conversation.updatedAt = Date.now();
  const payload = conversation.messages.map(({ role, content: body }) => ({ role, content: stripAgentMarker(body) }));
  const contextMessage = makeContextMessage(opts.includeSelection);
  if (contextMessage) payload.unshift({ role: 'system', content: contextMessage });
  const answer = { role: 'assistant', content: '' };
  conversation.messages.push(answer);
  const id = crypto.randomUUID();
  request = { id, message: answer, el: null, conversationId: conversation.id };
  setStreaming(true);
  renderMessages();
  persist();
  window.agzos.ai.chat(id, { profileId: selectedProfile.id, model: selectedModel || selectedProfile.model, messages: payload })
    .catch(() => finish(id, 'Não foi possível iniciar a conversa.'));
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
  if (!agent) return window.agzos.ai.cancel(id);
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
  };
}

function runAgent(content, opts = {}) {
  lastError = null;
  closeHistory();
  let conversation = activeConversation();
  if (!conversation) {
    conversation = { id: crypto.randomUUID(), title: DEFAULT_TITLE, updatedAt: Date.now(), messages: [] };
    store = addConversation(store, conversation);
  }
  if (!opts.resend) {
    if (!conversation.messages.some((m) => m.role === 'user')) conversation.title = makeTitle(content);
    conversation.messages.push({ role: 'user', content });
  }
  conversation.messages = conversation.messages.slice(-(MAX_MESSAGES - 1));
  conversation.updatedAt = Date.now();
  const payload = conversation.messages.map(({ role, content: body }) => ({ role, content: stripAgentMarker(body) }));
  const contextMessage = makeContextMessage(false);
  if (contextMessage) payload.unshift({ role: 'system', content: contextMessage });
  const mode = agentMode();
  const turn = createAgentTurn(mode);
  const answer = { role: 'assistant', content: '', agent: turn };
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
      profileId: selectedProfile.id, model: selectedModel || selectedProfile.model, messages: payload, mode,
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
  conversation.messages = conversation.messages.slice(0, userIndex);
  agentEnabled = false;
  syncAgentBar();
  sendToChat(content, { forceChat: true });
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
  const available = !!agentApi();
  bar.hidden = !available;
  const on = isAgentOn();
  panel.classList.toggle('is-agent', on);
  panel.querySelectorAll('.ai-seg-btn').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.agent === 'agent') === on)));
  const mode = agentMode();
  const info = AGENT_MODE_INFO[mode];
  const btn = $('#ai-agent-mode');
  btn.hidden = !on;
  btn.dataset.mode = mode;
  btn.querySelector('.ai-mode-icon').replaceChildren(icon(info.icon, 12));
  btn.querySelector('.ai-mode-label').textContent = info.label;
  btn.title = `${info.title}: ${info.desc}`;
  btn.setAttribute('aria-label', `Autonomia do agente: ${info.title}. ${info.desc}`);
  const input = $('#ai-input');
  input.placeholder = on
    ? (State.workspaceRoot ? 'Peça uma mudança, um bug para corrigir ou algo para criar…' : 'Abra uma pasta para o agente trabalhar…')
    : 'Pergunte sobre o código ou peça uma mudança…';
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

function setAgentEnabled(on) {
  if (request) return;
  agentEnabled = !!on;
  syncAgentBar();
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

function submitComposer() {
  if (loadingHistory) return;
  if (request) { cancelRequest(); return; }
  const input = $('#ai-input');
  if (!input.value.trim()) return;
  sendToChat(input.value);
  input.value = '';
  autoGrow();
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
  input.addEventListener('keydown', (event) => {
    const action = composerKeyAction(event, aiSettings().sendKey);
    // 'newline' (Shift+Enter) e null seguem o comportamento padrão do textarea.
    if (action === 'send') { event.preventDefault(); if (!request) submitComposer(); }
  });
  $('#ai-send').addEventListener('click', submitComposer);
  $('#ai-configure').addEventListener('click', openWizard);
  $('#ai-new-chat').addEventListener('click', () => newConversation());
  $('#ai-history-btn').addEventListener('click', () => ($('#ai-history').hidden ? openHistory() : closeHistory({ restoreFocus: true })));
  $('#ai-history-close').addEventListener('click', () => closeHistory({ restoreFocus: true }));
  $('#ai-model-pill').addEventListener('click', openModelMenu);
  $('#ai-more-btn').addEventListener('click', openMoreMenu);
  $('#ai-agent-mode').addEventListener('click', openAgentModeMenu);
  panel.querySelectorAll('.ai-seg-btn').forEach((b) => b.addEventListener('click', () => setAgentEnabled(b.dataset.agent === 'agent')));
  $('.ai-seg').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setAgentEnabled(!isAgentOn());
    $(`.ai-seg-btn[aria-checked="true"]`)?.focus();
  });

  $('#ai-history').addEventListener('click', (event) => {
    const del = event.target.closest('.ai-history-delete');
    if (del) { deleteConversation(del.dataset.id); return; }
    const open = event.target.closest('.ai-history-open');
    if (open) switchConversation(open.dataset.id);
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
  window.addEventListener('agzos:workspace-changed', loadHistory);
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
  loadHistory();
}
