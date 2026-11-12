const { randomUUID } = require('node:crypto');
const { PRESETS } = require('./presets');
const { createOpenAICompatibleProvider } = require('./providers/openai-compatible');
const { createAnthropicProvider } = require('./providers/anthropic');

function aiSettings(settings) {
  return settings?.ai && typeof settings.ai === 'object' && !Array.isArray(settings.ai)
    ? settings.ai
    : { activeProfileId: null, profiles: [] };
}

function upsertProfile(settings, profile) {
  const ai = aiSettings(settings);
  const profiles = Array.isArray(ai.profiles) ? ai.profiles : [];
  const existingIndex = profiles.findIndex((item) => item.id === profile.id);
  const nextProfiles = profiles.slice();
  if (existingIndex === -1) nextProfiles.push({ ...profile });
  else nextProfiles[existingIndex] = { ...profile };
  const activeProfileId = profiles.length === 0 ? profile.id : ai.activeProfileId;
  return { ...settings, ai: { ...ai, profiles: nextProfiles, activeProfileId } };
}

function removeProfile(settings, id) {
  const ai = aiSettings(settings);
  const profiles = Array.isArray(ai.profiles) ? ai.profiles : [];
  const nextProfiles = profiles.filter((profile) => profile.id !== id);
  const activeProfileId = ai.activeProfileId === id
    ? (nextProfiles[0]?.id ?? null)
    : ai.activeProfileId;
  return { ...settings, ai: { ...ai, profiles: nextProfiles, activeProfileId } };
}

function setActiveProfile(settings, id) {
  const ai = aiSettings(settings);
  const profiles = Array.isArray(ai.profiles) ? ai.profiles : [];
  if (!profiles.some((profile) => profile.id === id)) return settings;
  return { ...settings, ai: { ...ai, activeProfileId: id, profiles: profiles.slice() } };
}

function getActiveProfile(settings) {
  const ai = aiSettings(settings);
  if (!Array.isArray(ai.profiles)) return null;
  return ai.profiles.find((profile) => profile.id === ai.activeProfileId) || null;
}

function migrateLegacyAi(settings, store) {
  const ai = aiSettings(settings);
  const profiles = Array.isArray(ai.profiles) ? ai.profiles : [];
  if (!settings?.aiProvider || profiles.length > 0) return { settings, changed: false };

  const preset = Object.hasOwn(PRESETS, settings.aiProvider) ? settings.aiProvider : 'custom';
  const definition = PRESETS[preset];
  // migrateLegacySecrets pode ter mantido a chave em settings se o cofre estava
  // indisponível. Aguarda a próxima inicialização para não separar chave e perfil.
  if (settings.aiApiKey && !store.get('ai.legacy')) return { settings, changed: false };
  const profile = {
    id: randomUUID(),
    preset,
    label: definition.label,
    baseUrl: definition.baseUrl,
    model: null,
  };

  const legacyKey = store.get('ai.legacy');
  if (legacyKey) {
    try {
      store.set(`ai.${profile.id}`, legacyKey);
      store.delete('ai.legacy');
    } catch {
      return { settings, changed: false };
    }
  }

  const out = {
    ...settings,
    ai: { ...ai, profiles: [profile], activeProfileId: profile.id },
  };
  delete out.aiProvider;
  return { settings: out, changed: true };
}

function createProviderForProfile(profile, store, { fetchImpl } = {}) {
  const preset = PRESETS[profile?.preset];
  if (!preset) throw new Error(`Preset de IA desconhecido: ${profile?.preset}`);
  const apiKey = store.get(`ai.${profile.id}`) || undefined;
  const baseUrl = profile.baseUrl || preset.baseUrl;
  if (preset.kind === 'anthropic') {
    return createAnthropicProvider({ baseUrl, apiKey, fetchImpl });
  }
  const extraHeaders = profile.preset === 'openrouter'
    ? { 'HTTP-Referer': 'https://github.com/rodrigoazevedo1988/agzos-code', 'X-Title': 'Agzos Code' }
    : {};
  return createOpenAICompatibleProvider({ baseUrl, apiKey, fetchImpl, extraHeaders });
}

module.exports = {
  upsertProfile,
  removeProfile,
  setActiveProfile,
  getActiveProfile,
  migrateLegacyAi,
  createProviderForProfile,
};
