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
