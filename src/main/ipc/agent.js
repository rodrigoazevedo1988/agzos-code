/**
 * IPC do agente (window.agzos.agent): agent:run / approve / steer / cancel / undo / setMode,
 * skills (agent:skills, agent:skills:new, agent:skills:openFolder).
 * Eventos main → renderer no canal 'agent:event' (requestId, evt).
 *
 * Ferramentas que leem o editor (read_terminal, get_problems): o main pergunta ao
 * renderer pelo canal 'agent:query' (queryId, what, args) e espera 'agent:query:reply'.
 *
 * Raiz do agente: payload.root (se liberada no guard da janela que pediu) ou a pasta da janela que
 * pediu (getWindowRoot(sender), várias janelas). Sem getWindowRoot, cai na pasta
 * aberta por último (recentFolders[0], gravada pelo workspace:open). Sempre liberada.
 * A chave da API vem do cofre (como ipc/ai.js) e nunca vai ao renderer nem ao modelo.
 */

const path = require('path');
const { getActiveProfile, createProviderForProfile } = require('../ai/profiles');
const { createAgentSessions, isDirectory } = require('../agent/session');
const { createCheckpointStore } = require('../agent/checkpoints');
const { MODES } = require('../agent/loop');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { getModuleTools } = require('../modules/agent-tools');
const { guardResolver } = require('../lib/window-guards');
const { loadSkills, describeSkill, SKILL_TEMPLATE } = require('../agent/skills');
const { createRendererTools } = require('../agent/renderer-tools');

const QUERY_TIMEOUT = 5000;

function register(ipcMain, {
  settingsStore, store, guard, guardFor, userDataDir, fetchImpl = fetch, getWindowRoot,
  checkpoints = createCheckpointStore({ dir: userDataDir ? path.join(userDataDir, 'agent-checkpoints') : null }),
  sessionOptions = {}, attachments = null, shell = null,
}) {
  const sessions = new Map();
  const skillsDir = userDataDir ? path.join(userDataDir, 'skills') : null;
  const queries = new Map(); // queryId → { resolve, timer }

  function skillsFor(root) {
    return loadSkills({ userDir: skillsDir, projectRoot: root || null });
  }

  /** Pergunta algo ao renderer (terminal, problemas). Sem resposta em 5 s → erro. */
  function queryRenderer(sender, what, args) {
    if (sender.isDestroyed()) return Promise.reject(new Error('Editor indisponível'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { queries.delete(id); reject(new Error('O editor não respondeu a tempo')); }, QUERY_TIMEOUT);
      queries.set(id, { resolve, timer });
      sender.send('agent:query', id, what, args || {});
    });
  }
  const guardOf = guardResolver({ guard, guardFor });

  function findProfile(id) {
    const settings = settingsStore.load();
    return id ? settings.ai?.profiles?.find((profile) => profile.id === id) : getActiveProfile(settings);
  }

  function getRoot(payload, sender) {
    const candidates = [];
    if (typeof payload?.root === 'string' && payload.root) candidates.push(payload.root);
    if (typeof getWindowRoot === 'function') {
      const own = sender ? getWindowRoot(sender) : null;
      if (typeof own === 'string' && own) candidates.push(own);
    } else {
      const recent = settingsStore.load().recentFolders;
      if (Array.isArray(recent) && typeof recent[0] === 'string') candidates.push(recent[0]);
    }
    const g = guardOf(sender);
    for (const candidate of candidates) {
      if (path.isAbsolute(candidate) && g.isAllowed(candidate) && isDirectory(candidate)) return path.resolve(candidate);
    }
    return null;
  }

  function getProvider(payload) {
    const profile = findProfile(payload?.profileId);
    if (!profile) {
      const err = new Error('Configure um perfil de IA para usar o agente.');
      err.code = 'no_profile';
      throw err;
    }
    const provider = createProviderForProfile(profile, store, { fetchImpl });
    const model = payload?.model || profile.model;
    if (!model) {
      const err = new Error('Escolha um modelo para usar o agente.');
      err.code = 'no_model';
      throw err;
    }
    return { provider, model, apiKey: store.get(`ai.${profile.id}`) || undefined };
  }

  function forSender(sender) {
    if (!sessions.has(sender)) {
      const agent = createAgentSessions({
        getRoot: (payload) => getRoot(payload, sender),
        getProvider,
        getMode: () => settingsStore.load().aiAgent?.mode,
        getExtraTools: () => [...createRendererTools((what, args) => queryRenderer(sender, what, args)), ...getModuleTools(settingsStore.load())],
        getSkill: (id, root) => skillsFor(root).skills.find((skill) => skill.id === id && skill.kind === 'agent') || null,
        ...(attachments ? { buildContent: (text, list) => attachments.buildContent(text, list) } : {}),
        checkpoints,
        send: (requestId, evt) => { if (!sender.isDestroyed()) sender.send('agent:event', requestId, evt); },
        ...sessionOptions,
      });
      sessions.set(sender, agent);
      sender.once('destroyed', () => { agent.cancelAll(); sessions.delete(sender); });
    }
    return sessions.get(sender);
  }

  ipcMain.handle('agent:run', (event, requestId, payload) => forSender(event.sender).run(requestId, payload || {}));
  ipcMain.handle('agent:approve', (event, requestId, callId, decision) => sessions.get(event.sender)?.approve(requestId, callId, decision) ?? false);
  ipcMain.handle('agent:steer', (event, requestId, payload) => sessions.get(event.sender)?.steer(requestId, payload || {}) ?? false);
  ipcMain.handle('agent:query:reply', (_event, id, result) => {
    const query = queries.get(id);
    if (!query) return false;
    queries.delete(id);
    clearTimeout(query.timer);
    query.resolve(result);
    return true;
  });
  ipcMain.handle('agent:skills', (event, payload) => {
    const root = getRoot(payload || {}, event.sender);
    const { skills, warnings } = skillsFor(root);
    // Skills do usuário podem ser abertas no editor a partir das Configurações.
    if (skillsDir && fs.existsSync(skillsDir)) guardOf(event?.sender).allow(skillsDir);
    return { skills: skills.map(describeSkill), warnings, userDir: skillsDir, projectDir: root ? path.join(root, '.agzos', 'skills') : null };
  });
  ipcMain.handle('agent:skills:new', (event) => {
    if (!skillsDir) return null;
    fs.mkdirSync(skillsDir, { recursive: true });
    let n = 1;
    let file = path.join(skillsDir, 'minha-skill.md');
    while (fs.existsSync(file)) { n++; file = path.join(skillsDir, `minha-skill-${n}.md`); }
    const id = n === 1 ? 'minha-skill' : `minha-skill-${n}`;
    fs.writeFileSync(file, SKILL_TEMPLATE.replace('id: minha-skill', `id: ${id}`), 'utf8');
    guardOf(event?.sender).allow(skillsDir);
    return file;
  });
  ipcMain.handle('agent:skills:openFolder', async (event) => {
    if (!skillsDir) return false;
    fs.mkdirSync(skillsDir, { recursive: true });
    guardOf(event?.sender).allow(skillsDir);
    if (shell?.openPath) await shell.openPath(skillsDir);
    return skillsDir;
  });
  ipcMain.handle('agent:cancel', (event, requestId) => sessions.get(event.sender)?.cancel(requestId) ?? false);
  ipcMain.handle('agent:undo', (_event, checkpointId) => {
    try { return checkpoints.undo(checkpointId); }
    catch (err) { return { restored: [], errors: [{ path: null, message: err.message }] }; }
  });
  ipcMain.handle('agent:setMode', (_event, mode) => {
    if (!MODES.includes(mode)) return false;
    const settings = settingsStore.load();
    settingsStore.save({ ...settings, aiAgent: { ...(settings.aiAgent || {}), mode } });
    return true;
  });

  return {
    cancelAll: () => { for (const agent of sessions.values()) agent.cancelAll(); },
    _forSender: forSender,
    _rootsFor: (sender, payload) => getRoot(payload, sender),
    skillsFor,
  };
}

module.exports = { register };
