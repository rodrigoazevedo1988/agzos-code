/**
 * IPC do agente (window.agzos.agent): agent:run / approve / cancel / undo / setMode.
 * Eventos main → renderer no canal 'agent:event' (requestId, evt).
 *
 * Raiz do agente: payload.root (se liberada no guard) ou a pasta aberta por
 * último (recentFolders[0], gravada pelo workspace:open), desde que liberada.
 * A chave da API vem do cofre (como ipc/ai.js) e nunca vai ao renderer nem ao modelo.
 */

const path = require('path');
const { getActiveProfile, createProviderForProfile } = require('../ai/profiles');
const { createAgentSessions, isDirectory } = require('../agent/session');
const { createCheckpointStore } = require('../agent/checkpoints');
const { MODES } = require('../agent/loop');

function register(ipcMain, {
  settingsStore, store, guard, userDataDir, fetchImpl = fetch,
  checkpoints = createCheckpointStore({ dir: userDataDir ? path.join(userDataDir, 'agent-checkpoints') : null }),
  sessionOptions = {},
}) {
  const sessions = new Map();

  function findProfile(id) {
    const settings = settingsStore.load();
    return id ? settings.ai?.profiles?.find((profile) => profile.id === id) : getActiveProfile(settings);
  }

  function getRoot(payload) {
    const candidates = [];
    if (typeof payload?.root === 'string' && payload.root) candidates.push(payload.root);
    const recent = settingsStore.load().recentFolders;
    if (Array.isArray(recent) && typeof recent[0] === 'string') candidates.push(recent[0]);
    for (const candidate of candidates) {
      if (path.isAbsolute(candidate) && guard.isAllowed(candidate) && isDirectory(candidate)) return path.resolve(candidate);
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
        getRoot,
        getProvider,
        getMode: () => settingsStore.load().aiAgent?.mode,
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
  };
}

module.exports = { register };
