const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PRESETS } = require('../ai/presets');
const { upsertProfile, removeProfile, setActiveProfile, getActiveProfile, createProviderForProfile } = require('../ai/profiles');
const { createChatSessions } = require('../ai/sessions');
const { loadSkills, pickSkill } = require('../agent/skills');
const { SKILL_RULE } = require('../agent/prompt');
const { normalizeAiSkills } = require('../lib/settings');
const { guardResolver } = require('../lib/window-guards');
const { buildSummaryMessages } = require('../ai/compact');

const MAX_ATTACH_READ = 30 * 1024 * 1024;

function register(ipcMain, {
  settingsStore, store, fetchImpl = fetch, attachments = null, guard = null, guardFor = null, dialog = null,
  getMainWindow = () => null, getWindowFor = null, userDataDir = null,
}) {
  const sessions = new Map();
  const summarizing = new Map(); // requestId → AbortController (ai:summarize)
  // Guard da janela que pediu (várias janelas: lib/window-guards.js).
  const guardOf = guardResolver({ guard, guardFor });

  /**
   * Mensagens do chat: anexos (refs) viram conteúdo; skill de chat vira system prompt.
   * Skill de projeto não confiada → lança Error com code 'skill_untrusted'.
   */
  function prepareMessages(payload, sender) {
    const list = Array.isArray(payload?.messages) ? payload.messages : [];
    const messages = list.map((m) => {
      if (!m || m.role !== 'user' || !Array.isArray(m.attachments) || !m.attachments.length || !attachments) {
        return { role: m?.role, content: m?.content };
      }
      return { role: 'user', content: attachments.buildContent(typeof m.content === 'string' ? m.content : '', m.attachments) };
    });
    const skillId = typeof payload?.skill === 'string' ? payload.skill : null;
    if (skillId) {
      const root = typeof payload.root === 'string' && guardOf(sender)?.isAllowed?.(payload.root) ? payload.root : null;
      try {
        const { skills } = loadSkills({ userDir: userDataDir ? path.join(userDataDir, 'skills') : null, projectRoot: root });
        const skill = pickSkill(skills, skillId, { trusted: normalizeAiSkills(settingsStore.load().aiSkills).trusted });
        // Depois das mensagens de sistema do renderer (contexto do arquivo), antes da conversa.
        const at = messages.findIndex((m) => m.role !== 'system');
        const origin = skill?.source === 'project' ? 'Este modo vem do repositório do projeto (arquivo .agzos/skills).\n' : '';
        if (skill?.prompt) messages.splice(at < 0 ? messages.length : at, 0, { role: 'system', content: `Você é o Agzos IA, assistente do editor Agzos Code.\n\n## Modo ativo: ${skill.label}\n${origin}${SKILL_RULE}\n\n${skill.prompt}` });
      } catch (err) {
        if (err.code === 'skill_untrusted') throw err;
        console.error('[ai] skill do chat indisponível:', err.message);
      }
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
    let messages;
    try {
      messages = prepareMessages(payload, event.sender);
    } catch (err) {
      if (err.code !== 'skill_untrusted') throw err;
      if (!event.sender.isDestroyed()) event.sender.send('ai:error', requestId, err.message);
      return;
    }
    forSender(event.sender).start(requestId, { ...payload, model: payload.model || profile?.model, messages });
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
  ipcMain.handle('ai:attach:read', async (event, paths) => {
    const g = guardOf(event?.sender);
    let list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && path.isAbsolute(p)) : null;
    if (!list) {
      if (!dialog?.showOpenDialog) return [];
      // Diálogo modal na janela que pediu.
      const win = typeof getWindowFor === 'function' ? getWindowFor(event) : getMainWindow();
      const options = {
        title: 'Anexar arquivos', properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Suportados', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'json', 'js', 'ts', 'py', 'csv', 'log', 'html', 'css', '*'] },
        ],
      };
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (result.canceled) return [];
      list = result.filePaths;
    } else if (!g || list.some((p) => !g.isAllowed(p))) {
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
  /**
   * Compactar conversa: resume `messages` com o modelo do perfil (prompt de ai/compact.js).
   * → { ok: true, summary } | { ok: false, error }. Nunca lança: a conversa fica intacta no renderer.
   * Cancelável por ai:cancel(requestId).
   */
  ipcMain.handle('ai:summarize', async (event, requestId, payload) => {
    const controller = new AbortController();
    if (typeof requestId === 'string' && requestId) summarizing.set(requestId, controller);
    try {
      const profile = findProfile(payload?.profileId);
      if (!profile) return { ok: false, error: 'Configure um perfil de IA para compactar a conversa.' };
      const conversation = prepareMessages({ messages: payload?.messages }, event?.sender);
      if (!conversation.some((m) => m.role === 'user' || m.role === 'assistant')) {
        return { ok: false, error: 'Não há mensagens para compactar.' };
      }
      let summary = '';
      const chat = provider(profile).chat({
        model: payload?.model || profile.model, messages: buildSummaryMessages(conversation), signal: controller.signal,
      });
      for await (const text of chat) summary += text;
      summary = summary.trim();
      if (!summary) return { ok: false, error: 'Não foi possível compactar: o modelo devolveu um resumo vazio.' };
      return { ok: true, summary };
    } catch (err) {
      if (controller.signal.aborted) return { ok: false, error: 'Interrompido', cancelled: true };
      return { ok: false, error: `Não foi possível resumir a conversa: ${err.userMessage || err.message || 'erro do provedor'}` };
    } finally {
      if (summarizing.get(requestId) === controller) summarizing.delete(requestId);
    }
  });
  ipcMain.handle('ai:cancel', (event, requestId) => {
    const summary = summarizing.get(requestId);
    if (summary) { summary.abort(); return true; }
    return sessions.get(event.sender)?.cancel(requestId);
  });
  return {
    cancelAll: () => {
      for (const chat of sessions.values()) chat.cancelAll();
      for (const controller of summarizing.values()) controller.abort();
    },
  };
}
module.exports = { register };
