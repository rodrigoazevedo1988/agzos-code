const { randomUUID } = require('node:crypto');
const { PRESETS } = require('../ai/presets');
const { upsertProfile, removeProfile, setActiveProfile, getActiveProfile, createProviderForProfile } = require('../ai/profiles');
const { createChatSessions } = require('../ai/sessions');

function register(ipcMain, { settingsStore, store, fetchImpl = fetch }) {
  const sessions = new Map();
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
    forSender(event.sender).start(requestId, { ...payload, model: payload.model || profile?.model });
  });
  ipcMain.handle('ai:cancel', (event, requestId) => sessions.get(event.sender)?.cancel(requestId));
  return { cancelAll: () => { for (const chat of sessions.values()) chat.cancelAll(); } };
}
module.exports = { register };
