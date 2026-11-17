const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PRESETS } = require('../ai/presets');
const { upsertProfile, removeProfile, setActiveProfile, getActiveProfile, createProviderForProfile } = require('../ai/profiles');
const { createChatSessions } = require('../ai/sessions');
const { loadSkills } = require('../agent/skills');

const MAX_ATTACH_READ = 30 * 1024 * 1024;

function register(ipcMain, {
  settingsStore, store, fetchImpl = fetch, attachments = null, guard = null, dialog = null, getMainWindow = () => null,
  userDataDir = null,
}) {
  const sessions = new Map();

  /** Mensagens do chat: anexos (refs) viram conteúdo; skill de chat vira system prompt. */
  function prepareMessages(payload) {
    const list = Array.isArray(payload?.messages) ? payload.messages : [];
    const messages = list.map((m) => {
      if (!m || m.role !== 'user' || !Array.isArray(m.attachments) || !m.attachments.length || !attachments) {
        return { role: m?.role, content: m?.content };
      }
      return { role: 'user', content: attachments.buildContent(typeof m.content === 'string' ? m.content : '', m.attachments) };
    });
    const skillId = typeof payload?.skill === 'string' ? payload.skill : null;
    if (skillId) {
      const root = typeof payload.root === 'string' && guard?.isAllowed?.(payload.root) ? payload.root : null;
      try {
        const skill = loadSkills({ userDir: userDataDir ? path.join(userDataDir, 'skills') : null, projectRoot: root })
          .skills.find((item) => item.id === skillId);
        if (skill?.prompt) messages.unshift({ role: 'system', content: `Você é o Agzos IA, assistente do editor Agzos Code.\n\n## Modo ativo: ${skill.label}\n${skill.prompt}` });
      } catch (err) { console.error('[ai] skill do chat indisponível:', err.message); }
    }
    return messages;
  }
  function findProfile(id) {
    const settings = settingsStore.load();
    return id ? settings.ai?.profiles?.find((profile) => profile.id === id) : getActiveProfile(settings);
  }
  function provider(profile, key) {
    if (!profile) throw new Error('Perfil de IA não encontrado');
    const keyStore = key === undefined ? store : { get: () => key };
    return createProviderForProfile(profile, keyStore, { fetchImpl });
  }
  function forSender(sender) {
    if (!sessions.has(sender)) {
      const chat = createChatSessions({
        getProvider: (id) => provider(findProfile(id)),
        send: (channel, ...args) => { if (!sender.isDestroyed()) sender.send(channel, ...args); },
      });
      sessions.set(sender, chat);
      sender.once('destroyed', () => { chat.cancelAll(); sessions.delete(sender); });
    }
    return sessions.get(sender);
  }
  ipcMain.handle('ai:presets', () => PRESETS);
  ipcMain.handle('ai:profiles', () => {
    const ai = settingsStore.load().ai || {};
    return { activeProfileId: ai.activeProfileId || null, profiles: ai.profiles || [] };
  });
  ipcMain.handle('ai:profile:save', (_event, draft, apiKey) => {
    if (!draft || !Object.hasOwn(PRESETS, draft.preset)) throw new Error('Preset de IA inválido');
    const profile = {
      id: draft.id || randomUUID(), preset: draft.preset,
      label: draft.label || PRESETS[draft.preset].label,
      baseUrl: draft.baseUrl || PRESETS[draft.preset].baseUrl, model: draft.model || null,
    };
    // Visão (imagens): true | false | 'auto' (padrão). Edição sem o campo mantém o valor salvo.
    const previous = draft.id ? findProfile(draft.id) : null;
    const vision = [true, false, 'auto'].includes(draft.vision) ? draft.vision : previous?.vision;
    if (vision === true || vision === false) profile.vision = vision;
    if (apiKey !== undefined) store.set(`ai.${profile.id}`, apiKey);
    settingsStore.save(upsertProfile(settingsStore.load(), profile));
    return profile;
  });
  ipcMain.handle('ai:profile:remove', (_event, id) => {
    store.delete(`ai.${id}`);
    settingsStore.save(removeProfile(settingsStore.load(), id));
  });
  ipcMain.handle('ai:profile:activate', (_event, id) => {
    settingsStore.save(setActiveProfile(settingsStore.load(), id));
  });
  ipcMain.handle('ai:models', (_event, idOrDraft, apiKey) => provider(
    typeof idOrDraft === 'object' ? idOrDraft : findProfile(idOrDraft), apiKey,
  ).listModels());
  ipcMain.handle('ai:test', (_event, draft, apiKey) => provider(draft, apiKey).testConnection());
  ipcMain.handle('ai:detectOllama', async () => {
    try {
      const response = await fetchImpl('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
      return response.ok;
    } catch { return false; }
  });
  ipcMain.handle('ai:chat', (event, requestId, payload) => {
    const profile = findProfile(payload.profileId);
    forSender(event.sender).start(requestId, { ...payload, model: payload.model || profile?.model, messages: prepareMessages(payload) });
  });

  // Anexos: o renderer manda bytes (imagens já reduzidas); aqui classifica, extrai e guarda.
  ipcMain.handle('ai:attach:save', async (_event, file) => {
    if (!attachments) throw new Error('Anexos indisponíveis');
    try {
      return { ok: true, attachment: await attachments.save({ name: file?.name, bytes: file?.bytes }) };
    } catch (err) {
      return { ok: false, error: err.userMessage || err.message };
    }
  });
  // Lê arquivos para anexar: sem caminhos → diálogo nativo; com caminhos (Explorer) → só os liberados no guard.
  ipcMain.handle('ai:attach:read', async (_event, paths) => {
    let list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && path.isAbsolute(p)) : null;
    if (!list) {
      if (!dialog?.showOpenDialog) return [];
      const win = getMainWindow();
      const options = {
        title: 'Anexar arquivos', properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Suportados', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'json', 'js', 'ts', 'py', 'csv', 'log', 'html', 'css', '*'] },
        ],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (result.canceled) return [];
      list = result.filePaths;
    } else if (!guard || list.some((p) => !guard.isAllowed(p))) {
      return list.map((p) => ({ name: path.basename(p), error: 'Fora das pastas liberadas.' }));
    }
    const out = [];
    for (const file of list.slice(0, 10)) {
      const name = path.basename(file);
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.isFile()) { out.push({ name, error: 'Não é um arquivo.' }); continue; }
        if (stat.size > MAX_ATTACH_READ) { out.push({ name, error: 'Arquivo grande demais (máx. 30 MB).' }); continue; }
        out.push({ name, bytes: new Uint8Array(await fs.promises.readFile(file)) });
      } catch (err) { out.push({ name, error: err.message }); }
    }
    return out;
  });
  ipcMain.handle('ai:cancel', (event, requestId) => sessions.get(event.sender)?.cancel(requestId));
  return { cancelAll: () => { for (const chat of sessions.values()) chat.cancelAll(); } };
}
module.exports = { register };
