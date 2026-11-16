const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;
const MAX_TITLE = 60;
const DEFAULT_TITLE = 'Nova conversa';

/** Título curto a partir do texto da primeira mensagem do usuário. */
function makeTitle(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/[`*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return DEFAULT_TITLE;
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1).trimEnd()}…` : clean;
}

function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map(({ role, content }) => ({ role, content }))
    .slice(-MAX_MESSAGES);
}

function cleanConversation(raw, now) {
  if (!raw || typeof raw !== 'object') return null;
  const messages = cleanMessages(raw.messages);
  const id = typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : randomUUID();
  const firstUser = messages.find((m) => m.role === 'user');
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim().slice(0, MAX_TITLE)
    : makeTitle(firstUser?.content);
  const updatedAt = Number.isFinite(raw.updatedAt) && raw.updatedAt > 0 ? raw.updatedAt : now;
  return { id, title, updatedAt, messages };
}

/**
 * Normaliza o histórico salvo: aceita o formato antigo (array de mensagens)
 * e o atual `{ conversations, activeId }`. Aplica os limites e descarta lixo.
 */
function normalizeHistory(raw, now = Date.now()) {
  if (Array.isArray(raw)) {
    const messages = cleanMessages(raw);
    if (!messages.length) return { conversations: [], activeId: null };
    const conversation = cleanConversation({ messages }, now);
    return { conversations: [conversation], activeId: conversation.id };
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.conversations)) {
    return { conversations: [], activeId: null };
  }
  const seen = new Set();
  const conversations = raw.conversations
    .map((c) => cleanConversation(c, now))
    .filter((c) => c && !seen.has(c.id) && seen.add(c.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_CONVERSATIONS);
  const activeId = conversations.some((c) => c.id === raw.activeId) ? raw.activeId : (conversations[0]?.id ?? null);
  return { conversations, activeId };
}

function register(ipcMain, { app }) {
  const directory = path.join(app.getPath('userData'), 'chats');
  const pending = new Map();
  // O caminho do workspace nunca vira caminho de arquivo: só o hash dele.
  const filename = (root) => path.join(directory, `${createHash('sha1').update(typeof root === 'string' && root ? root : 'global').digest('hex')}.json`);
  ipcMain.handle('chat:history:load', async (_event, root) => {
    const file = filename(root);
    await (pending.get(file) || Promise.resolve());
    try {
      return normalizeHistory(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return normalizeHistory(null);
      throw error;
    }
  });
  ipcMain.handle('chat:history:save', async (_event, root, history) => {
    if (!history || typeof history !== 'object') throw new TypeError('Histórico inválido');
    const file = filename(root);
    const data = JSON.stringify(normalizeHistory(history));
    const operation = (pending.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, data, 'utf8');
      await fs.rename(temporary, file);
    });
    pending.set(file, operation);
    try { await operation; } finally { if (pending.get(file) === operation) pending.delete(file); }
  });
}
module.exports = { register, normalizeHistory, makeTitle, MAX_CONVERSATIONS, MAX_MESSAGES };
