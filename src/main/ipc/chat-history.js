/**
 * Histórico do Agzos IA.
 *
 * Um arquivo por pasta: userData/chats/<sha1(raiz)>.json com
 *   { root, conversations: [{ id, title, updatedAt, messages }], activeId }
 * (`root` existe a partir da 1.1.0; arquivos antigos sem ele são associados às pastas
 * recentes pelo hash). O caminho do workspace nunca vira caminho de arquivo: só o hash.
 *
 * Índice global: varredura dos arquivos (chat:history:all) — lista as conversas de
 * todas as pastas, com busca por título/conteúdo. As operações em conversas de outras
 * pastas usam a `key` (hash do arquivo) devolvida pelo índice.
 *
 * Mensagens: { role, content, attachments?, model?, skill? }. Resumo de compactação (1.2.0):
 * { role: 'assistant', kind: 'summary', content, compactedCount, createdAt } — só ele e as
 * mensagens posteriores vão ao modelo; as anteriores continuam salvas (UI e export). Anexos guardam só o
 * descritor (id/hash, nome, tipo, tamanho, miniatura pequena); os bytes ficam em
 * userData/chat-attachments (ver ai/attachments.js), limpos quando nenhuma conversa
 * os referencia mais.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { transcriptMarkdown, transcriptHtml, exportFileName } = require('../chat-export');

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;
const MAX_TITLE = 60;
const MAX_THUMB = 24 * 1024;
const DEFAULT_TITLE = 'Nova conversa';
const KEY_RE = /^[a-f0-9]{40}$/;

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

function cleanAttachment(a) {
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !/^[a-f0-9]{32}$/.test(a.id)) return null;
  const out = {
    id: a.id,
    kind: ['image', 'text', 'pdf'].includes(a.kind) ? a.kind : 'text',
    name: String(a.name || 'anexo').slice(0, 120),
    size: Number.isFinite(a.size) ? a.size : 0,
  };
  if (typeof a.mime === 'string') out.mime = a.mime.slice(0, 60);
  if (typeof a.thumb === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(a.thumb) && a.thumb.length <= MAX_THUMB) out.thumb = a.thumb;
  if (a.truncated === true) { out.truncated = true; if (typeof a.note === 'string') out.note = a.note.slice(0, 200); }
  return out;
}

function cleanMessages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map((m) => {
      const out = { role: m.role, content: m.content };
      const attachments = Array.isArray(m.attachments) ? m.attachments.map(cleanAttachment).filter(Boolean).slice(0, 20) : [];
      if (attachments.length) out.attachments = attachments;
      if (typeof m.model === 'string' && m.model) out.model = m.model.slice(0, 120);
      if (typeof m.skill === 'string' && /^(?:project:)?[a-z0-9-]{1,40}$/.test(m.skill)) out.skill = m.skill;
      if (m.kind === 'summary' && m.role === 'assistant') {
        out.kind = 'summary';
        out.compactedCount = Number.isInteger(m.compactedCount) && m.compactedCount > 0 ? m.compactedCount : 0;
        if (Number.isFinite(m.createdAt) && m.createdAt > 0) out.createdAt = m.createdAt;
      }
      return out;
    })
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

const keyFor = (root) => createHash('sha1').update(typeof root === 'string' && root ? root : 'global').digest('hex');

function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Texto visível da mensagem (sem o marcador JSON do agente). */
function visibleText(content) {
  return String(content || '').replace(/<!--agzos-agent [\s\S]*?-->/g, ' ');
}

function snippetAround(text, query) {
  const clean = visibleText(text).replace(/\s+/g, ' ').trim();
  const at = fold(clean).indexOf(fold(query));
  if (at < 0) return '';
  const start = Math.max(0, at - 40);
  return `${start > 0 ? '…' : ''}${clean.slice(start, at + query.length + 60)}${at + query.length + 60 < clean.length ? '…' : ''}`;
}

/**
 * Índice global: todas as conversas de todos os arquivos de histórico.
 * knownRoots: pastas conhecidas (recentes) para identificar arquivos antigos sem `root`.
 * @returns {Array<{ key, root, name, current, updatedAt, conversations: Array<{ id, title, updatedAt, count, snippet? }> }>}
 */
function buildGlobalIndex(entries, { currentRoot = null, knownRoots = [], query = '' } = {}) {
  const rootsByKey = new Map(knownRoots.filter((r) => typeof r === 'string' && r).map((r) => [keyFor(r), r]));
  const currentKey = keyFor(currentRoot);
  const q = String(query || '').trim();
  const groups = [];
  for (const { key, data } of entries) {
    const root = typeof data?.root === 'string' && data.root ? data.root : (rootsByKey.get(key) || (key === keyFor(null) ? null : undefined));
    const history = normalizeHistory(data);
    const conversations = [];
    for (const c of history.conversations) {
      if (!c.messages.length) continue;
      let snippet = '';
      if (q) {
        const inTitle = fold(c.title).includes(fold(q));
        if (!inTitle) {
          const hit = c.messages.find((m) => fold(visibleText(m.content)).includes(fold(q)));
          if (!hit) continue;
          snippet = snippetAround(hit.content, q);
        }
      }
      conversations.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: c.messages.length, ...(snippet ? { snippet } : {}) });
    }
    if (!conversations.length) continue;
    const name = root === null ? 'Sem pasta' : root ? path.basename(root.replace(/[\\/]+$/, '')) || root : 'Pasta desconhecida';
    groups.push({ key, root: root ?? null, name, current: key === currentKey, updatedAt: conversations[0].updatedAt, conversations });
  }
  return groups.sort((a, b) => (b.current - a.current) || (b.updatedAt - a.updatedAt));
}

/** Ids de anexos referenciados em um histórico. */
function attachmentIds(data, into = new Set()) {
  for (const c of normalizeHistory(data).conversations) {
    for (const m of c.messages) for (const a of m.attachments || []) into.add(a.id);
  }
  return into;
}

function register(ipcMain, {
  app, dialog, getMainWindow, getWindowFor, BrowserWindow, attachments = null, getRecentFolders = () => [],
  printToPdf = null,
}) {
  const directory = path.join(app.getPath('userData'), 'chats');
  const pending = new Map();
  const fileForKey = (key) => path.join(directory, `${key}.json`);
  const filename = (root) => fileForKey(keyFor(root));

  async function readFile(file) {
    await (pending.get(file) || Promise.resolve());
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  function writeFile(file, data) {
    const json = JSON.stringify(data);
    const operation = (pending.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      await fs.mkdir(directory, { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(temporary, json, 'utf8');
      await fs.rename(temporary, file);
    });
    pending.set(file, operation);
    return operation.finally(() => { if (pending.get(file) === operation) pending.delete(file); });
  }

  async function readAll() {
    let names = [];
    try { names = await fs.readdir(directory); } catch { return []; }
    const out = [];
    for (const name of names) {
      const match = name.match(/^([a-f0-9]{40})\.json$/);
      if (!match) continue;
      try { out.push({ key: match[1], data: await readFile(path.join(directory, name)) }); } catch { /* ignora arquivo ilegível */ }
    }
    return out;
  }

  let gcTimer = null;
  function scheduleGc() {
    if (!attachments) return;
    clearTimeout(gcTimer);
    gcTimer = setTimeout(async () => {
      try {
        const referenced = new Set();
        for (const { data } of await readAll()) attachmentIds(data, referenced);
        attachments.gc(referenced);
      } catch (err) { console.error('[chat] limpeza de anexos falhou:', err.message); }
    }, 1500);
    gcTimer.unref?.();
  }

  async function saveHistory(root, history, key = keyFor(root)) {
    const normalized = normalizeHistory(history);
    const data = typeof root === 'string' && root ? { root, ...normalized } : normalized;
    await writeFile(fileForKey(key), data);
    scheduleGc();
  }

  async function loadByKey(key) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) throw new TypeError('Chave de histórico inválida');
    const data = await readFile(fileForKey(key));
    return { data, history: normalizeHistory(data), root: typeof data?.root === 'string' ? data.root : null };
  }

  ipcMain.handle('chat:history:load', async (_event, root) => normalizeHistory(await readFile(filename(root))));
  ipcMain.handle('chat:history:save', async (_event, root, history) => {
    if (!history || typeof history !== 'object') throw new TypeError('Histórico inválido');
    await saveHistory(root, history);
  });
  ipcMain.handle('chat:history:all', async (_event, options = {}) => buildGlobalIndex(await readAll(), {
    currentRoot: typeof options?.currentRoot === 'string' ? options.currentRoot : null,
    knownRoots: safeRecent(getRecentFolders),
    query: typeof options?.query === 'string' ? options.query.slice(0, 200) : '',
  }));
  ipcMain.handle('chat:history:get', async (_event, key, id) => {
    const { history, root } = await loadByKey(key);
    const conversation = history.conversations.find((c) => c.id === id);
    return conversation ? { root, conversation } : null;
  });
  ipcMain.handle('chat:history:rename', async (_event, key, id, title) => {
    const { history, root } = await loadByKey(key);
    const conversation = history.conversations.find((c) => c.id === id);
    const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    if (!conversation || !clean) return false;
    conversation.title = clean;
    await saveHistory(root, history, key);
    return true;
  });
  ipcMain.handle('chat:history:delete', async (_event, key, id) => {
    const { history, root } = await loadByKey(key);
    const conversations = history.conversations.filter((c) => c.id !== id);
    if (conversations.length === history.conversations.length) return false;
    const activeId = history.activeId === id ? (conversations[0]?.id ?? null) : history.activeId;
    await saveHistory(root, { conversations, activeId }, key);
    return true;
  });

  /** Exporta uma conversa: format 'md' | 'pdf'. Salva via diálogo nativo. → caminho ou null. */
  ipcMain.handle('chat:export', async (event, key, id, format) => {
    const { history, root } = await loadByKey(key);
    const conversation = history.conversations.find((c) => c.id === id);
    if (!conversation) throw new Error('Conversa não encontrada');
    const kind = format === 'pdf' ? 'pdf' : 'md';
    const target = await chooseTarget(exportFileName(conversation, kind), kind, event);
    if (!target) return null;
    const markdown = transcriptMarkdown(conversation, { root });
    if (kind === 'md') {
      await fs.writeFile(target, markdown, 'utf8');
    } else {
      const pdf = await (printToPdf || ((html) => renderPdf(html, BrowserWindow)))(transcriptHtml(markdown, conversation.title));
      await fs.writeFile(target, pdf);
    }
    return target;
  });

  async function chooseTarget(defaultName, kind, event) {
    // Só em testes E2E: caminho pré-definido no lugar do diálogo nativo.
    if (process.env.AGZOS_TEST === '1' && typeof global.__agzosNextSavePath === 'string') {
      const forced = global.__agzosNextSavePath;
      global.__agzosNextSavePath = undefined;
      return forced;
    }
    if (!dialog?.showSaveDialog) return null;
    // Diálogo modal na janela que pediu (várias janelas).
    const win = typeof getWindowFor === 'function' ? getWindowFor(event) : getMainWindow?.();
    const options = {
      title: kind === 'pdf' ? 'Exportar conversa como PDF' : 'Exportar conversa como Markdown',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: kind === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'Markdown', extensions: ['md'] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  return { buildIndex: async (options) => buildGlobalIndex(await readAll(), options), saveHistory };
}

function safeRecent(getRecentFolders) {
  try {
    const list = getRecentFolders();
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

/** HTML → PDF numa janela oculta, sem JavaScript, sem rede (CSP no próprio HTML). */
async function renderPdf(html, BrowserWindow) {
  if (!BrowserWindow) throw new Error('Exportar PDF indisponível');
  const win = new BrowserWindow({
    show: false, width: 900, height: 1200,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: false },
  });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await win.webContents.printToPDF({
      printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = {
  register, normalizeHistory, makeTitle, buildGlobalIndex, attachmentIds, keyFor, MAX_CONVERSATIONS, MAX_MESSAGES
};
