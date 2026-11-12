import { renderMarkdown } from './markdown.js';
import { buildContextMessage } from './ai-context.js';
import { getActiveEditor } from './editor.js';
import { getRecentOutput } from './terminal.js';

const State = window.AgzosState;
let messages = [];
let root = null;
let request = null;
let renderTimer = null;
let loadVersion = 0;
let loadingHistory = false;
let profiles = [];
let selectedProfile = null;
const contextOptions = { file: true, selection: true, terminal: false };

function updateContextChips() {
  document.querySelectorAll('.ai-context-chip').forEach((chip) => {
    chip.setAttribute('aria-pressed', String(!!contextOptions[chip.dataset.context]));
  });
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

function renderMessages() {
  const list = document.getElementById('ai-messages');
  list.replaceChildren();
  messages.forEach((message) => {
    const el = document.createElement('div');
    el.className = `ai-msg ai-${message.role}`;
    if (message.role === 'assistant') el.innerHTML = renderMarkdown(message.content);
    else el.textContent = message.content;
    list.appendChild(el);
  });
  list.scrollTop = list.scrollHeight;
}
function queueRender() {
  if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = null; renderMessages(); }, 50);
}
function persist() {
  return window.agzos.chat.saveHistory(root, messages).catch(() => {
    document.getElementById('ai-error').textContent = 'Não foi possível salvar o histórico.';
  });
}
async function loadHistory() {
  const nextRoot = State.workspaceRoot || null;
  const version = ++loadVersion;
  loadingHistory = true;
  document.getElementById('ai-input').disabled = true;
  if (request) await window.agzos.ai.cancel(request.id);
  root = nextRoot;
  messages = [];
  renderMessages();
  try {
    const loaded = await window.agzos.chat.loadHistory(root);
    if (version !== loadVersion) return;
    messages = loaded.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-200);
    renderMessages();
  } catch {
    if (version === loadVersion) document.getElementById('ai-error').textContent = 'Não foi possível carregar o histórico.';
  } finally {
    if (version === loadVersion) { loadingHistory = false; document.getElementById('ai-input').disabled = false; }
  }
}
function setStreaming(active) {
  document.getElementById('ai-send').textContent = active ? 'Parar' : 'Enviar';
  document.getElementById('ai-new-chat').disabled = active;
  document.getElementById('ai-profile').disabled = active;
  document.getElementById('ai-chat-model').disabled = active;
}
async function refreshProfiles() {
  try {
    const data = await window.agzos.ai.profiles();
    profiles = data.profiles;
    selectedProfile = profiles.find((p) => p.id === data.activeProfileId) || profiles[0] || null;
    document.getElementById('ai-empty').hidden = !!selectedProfile;
    document.getElementById('ai-chat').hidden = !selectedProfile;
    const select = document.getElementById('ai-profile');
    select.replaceChildren(...profiles.map((p) => new Option(p.label, p.id)));
    if (selectedProfile) select.value = selectedProfile.id;
    await refreshModels();
  } catch { document.getElementById('ai-error').textContent = 'Não foi possível carregar os perfis de IA.'; }
}
async function refreshModels() {
  const select = document.getElementById('ai-chat-model');
  const profile = selectedProfile;
  select.replaceChildren();
  if (!profile) return;
  if (profile.model) select.add(new Option(profile.model, profile.model));
  try {
    const models = await window.agzos.ai.models(profile.id);
    if (selectedProfile !== profile) return;
    const choices = [...new Set([profile.model, ...models].filter(Boolean))];
    select.replaceChildren(...choices.map((model) => new Option(model, model)));
    select.value = profile.model || choices[0] || '';
  } catch { /* O modelo salvo ainda pode ser usado se a listagem falhar. */ }
}
function finish(id, error) {
  if (!request || request.id !== id) return;
  if (error === 'Interrompido') request.message.content += ' _(interrompida)_';
  else if (error) document.getElementById('ai-error').textContent = error;
  request = null;
  setStreaming(false);
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  renderMessages();
  persist();
}
export function sendToChat(text, opts = {}) {
  const content = String(text || '').trim();
  if (!content || request || loadingHistory || !selectedProfile) return;
  document.getElementById('ai-error').textContent = '';
  messages.push({ role: 'user', content });
  messages = messages.slice(-199);
  const payload = messages.map(({ role, content: body }) => ({ role, content: body }));
  const contextMessage = makeContextMessage(opts.includeSelection);
  if (contextMessage) payload.unshift({ role: 'system', content: contextMessage });
  const answer = { role: 'assistant', content: '' };
  messages.push(answer);
  const id = crypto.randomUUID();
  request = { id, message: answer };
  setStreaming(true);
  renderMessages();
  persist();
  window.agzos.ai.chat(id, { profileId: selectedProfile.id, model: document.getElementById('ai-chat-model').value || selectedProfile.model, messages: payload })
    .catch(() => finish(id, 'Não foi possível iniciar a conversa.'));
}
export function focusChat() {
  const button = document.querySelector('.activity-btn[data-view="ai"]');
  if (document.body.classList.contains('sidebar-hidden')) document.getElementById('btn-toggle-sidebar').click();
  button?.click();
  document.getElementById('ai-input').focus();
}
export function setupAI() {
  Object.assign(contextOptions, { file: true, selection: true, terminal: false }, State.settings.ai?.context || {});
  updateContextChips();
  document.querySelectorAll('.ai-context-chip').forEach((chip) => chip.addEventListener('click', async () => {
    const key = chip.dataset.context;
    contextOptions[key] = !contextOptions[key];
    updateContextChips();
    State.settings.ai ||= {};
    State.settings.ai.context = { ...contextOptions };
    try { await window.agzos.settings.save(State.settings); } catch {}
  }));
  const input = document.getElementById('ai-input');
  const send = () => {
    if (loadingHistory) return;
    if (request) { window.agzos.ai.cancel(request.id); return; }
    const value = input.value;
    if (value.trim()) { sendToChat(value); input.value = ''; }
  };
  document.getElementById('ai-send').addEventListener('click', send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!request && !loadingHistory) send(); }
  });
  document.getElementById('ai-configure').addEventListener('click', async () => {
    const { openAIWizard } = await import('./ai-wizard.js');
    await openAIWizard();
  });
  document.getElementById('ai-new-chat').addEventListener('click', () => { messages = []; renderMessages(); persist(); });
  document.getElementById('ai-profile').addEventListener('change', async (event) => {
    selectedProfile = profiles.find((p) => p.id === event.target.value);
    if (selectedProfile) { await window.agzos.ai.activateProfile(selectedProfile.id); await refreshModels(); }
  });
  document.getElementById('ai-messages').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-code-action]');
    if (!button) return;
    const code = button.closest('.ai-msg').querySelectorAll('pre code')[Number(button.dataset.codeIndex)];
    if (button.dataset.codeAction === 'copy' && code) navigator.clipboard.writeText(code.textContent);
    if (button.dataset.codeAction === 'apply' && code) {
      import('./ai-apply.js').then(({ getAITarget, showApplyDiff }) => {
        const target = getAITarget();
        if (target) showApplyDiff({ ...target, newText: code.textContent.replace(/\n$/, '') });
        else document.getElementById('ai-error').textContent = 'Abra um arquivo para aplicar o código.';
      });
    }
  });
  window.agzos.ai.onChunk((id, text) => { if (request?.id === id) { request.message.content += text; queueRender(); } });
  window.agzos.ai.onDone((id) => finish(id));
  window.agzos.ai.onError((id, error) => finish(id, error));
  window.addEventListener('agzos:workspace-changed', loadHistory);
  window.addEventListener('agzos:ai-profiles-changed', refreshProfiles);
  refreshProfiles();
  loadHistory();
}
