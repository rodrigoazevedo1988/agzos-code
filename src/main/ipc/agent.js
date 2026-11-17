/**
 * IPC do agente (window.agzos.agent): agent:run / approve / steer / cancel / undo / setMode,
 * skills (agent:skills, agent:skills:new, agent:skills:openFolder, agent:skills:trust).
 *
 * Skills de projeto (.agzos/skills, id `project:<id>`) só rodam depois que o usuário confia
 * nelas: agent:skills:trust({ root?, id, sha256 }) grava raiz + caminho + sha256 em
 * settings.aiSkills.trusted. Sem registro (ou conteúdo mudou) → erro `skill_untrusted`.
 * Eventos main → renderer no canal 'agent:event' (requestId, evt).
 *
 * Ferramentas que leem o editor (read_terminal, get_problems): o main pergunta ao
 * renderer pelo canal 'agent:query' (queryId, what, args) e espera 'agent:query:reply'.
 *
 * Raiz do agente: payload.root (se liberada no guard da janela que pediu) ou a pasta da janela que
 * pediu (getWindowRoot(sender), várias janelas). Sem getWindowRoot, cai na pasta
 * aberta por último (recentFolders[0], gravada pelo workspace:open). Sempre liberada.
 * A chave da API vem do cofre (como ipc/ai.js) e nunca vai ao renderer nem ao modelo.
 *
 * Dono: cada checkpoint (done/error com checkpointId) e cada agent:query lembram o
 * webContents.id que os gerou. agent:undo e agent:query:reply de outra janela são recusados,
 * e a restauração passa cada caminho pelo guard da janela que pediu.
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
const { providerFor, isRemote } = require('../workspace/provider-for');
const {
  loadSkills, describeSkill, SKILL_TEMPLATE, pickSkill, trustRecord, isSkillTrusted,
} = require('../agent/skills');
const { normalizeAiSkills } = require('../lib/settings');
const { createRendererTools } = require('../agent/renderer-tools');

const QUERY_TIMEOUT = 5000;

function register(ipcMain, {
  settingsStore, store, guard, guardFor, userDataDir, fetchImpl = fetch, getWindowRoot,
  checkpoints = createCheckpointStore({ dir: userDataDir ? path.join(userDataDir, 'agent-checkpoints') : null }),
  sessionOptions = {}, attachments = null, shell = null,
}) {
  const sessions = new Map();
  const skillsDir = userDataDir ? path.join(userDataDir, 'skills') : null;
  const queries = new Map(); // queryId → { resolve, timer, owner }
  const checkpointOwners = new Map(); // checkpointId → webContents.id
  const senderId = (sender) => (sender && sender.id !== undefined ? sender.id : null);

  function skillsFor(root) {
    // Pasta remota: só skills do usuário (as do projeto ficariam no host).
    return loadSkills({ userDir: skillsDir, projectRoot: root && !isRemote(root) ? root : null });
  }
  const trustedSkills = () => normalizeAiSkills(settingsStore.load().aiSkills).trusted;

  /** Pergunta algo ao renderer (terminal, problemas). Sem resposta em 5 s → erro. */
  function queryRenderer(sender, what, args) {
    if (sender.isDestroyed()) return Promise.reject(new Error('Editor indisponível'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { queries.delete(id); reject(new Error('O editor não respondeu a tempo')); }, QUERY_TIMEOUT);
      queries.set(id, { resolve, timer, owner: senderId(sender) });
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
      // Pasta remota (ssh://): o guard da janela já exige a raiz aberta (workspace:open conferiu a pasta).
      if (isRemote(candidate)) { if (g.isAllowed(candidate)) return g.assertAllowed(candidate); continue; }
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

  function rememberOwner(checkpointId, sender) {
    checkpointOwners.set(checkpointId, senderId(sender));
    // Só os mais recentes (o store também guarda no máx. 20).
    while (checkpointOwners.size > 200) checkpointOwners.delete(checkpointOwners.keys().next().value);
  }

  function forSender(sender) {
    if (!sessions.has(sender)) {
      const agent = createAgentSessions({
        getRoot: (payload) => getRoot(payload, sender),
        getProvider,
        getMode: () => settingsStore.load().aiAgent?.mode,
        // Pasta remota: só as ferramentas do renderer (as dos módulos leem o disco local).
        getExtraTools: ({ remote = false } = {}) => [
          ...createRendererTools((what, args) => queryRenderer(sender, what, args)),
          ...(remote ? [] : getModuleTools(settingsStore.load())),
        ],
        providerFor: (root) => providerFor(root, sender),
        getSkill: (id, root) => pickSkill(skillsFor(root).skills, id, { trusted: trustedSkills(), kind: 'agent' }),
        ...(attachments ? { buildContent: (text, list) => attachments.buildContent(text, list) } : {}),
        checkpoints,
        send: (requestId, evt) => {
          if (evt?.checkpointId) rememberOwner(evt.checkpointId, sender);
          if (!sender.isDestroyed()) sender.send('agent:event', requestId, evt);
        },
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
  ipcMain.handle('agent:query:reply', (event, id, result) => {
    const query = queries.get(id);
    if (!query) return false;
    // Resposta de outra janela é ignorada (a pergunta continua esperando a dona).
    if (query.owner !== senderId(event?.sender)) return false;
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
    const trusted = trustedSkills();
    return { skills: skills.map((skill) => describeSkill(skill, { trusted })), warnings, userDir: skillsDir, projectDir: root ? path.join(root, '.agzos', 'skills') : null };
  });
  // Usuário confiou numa skill de projeto depois de ver caminho, hash e prompt (diálogo do renderer).
  // O sha256 enviado precisa bater com o arquivo atual: se mudou, o usuário confiou em outro conteúdo.
  ipcMain.handle('agent:skills:trust', (event, payload) => {
    const root = getRoot(payload || {}, event.sender);
    if (!root) return { ok: false, error: 'Abra uma pasta de projeto.' };
    const skill = skillsFor(root).skills.find((s) => s.id === payload?.id && s.source === 'project');
    if (!skill) return { ok: false, error: 'Skill do projeto não encontrada.' };
    if (typeof payload?.sha256 !== 'string' || payload.sha256 !== skill.sha256) {
      return { ok: false, error: 'O arquivo da skill mudou; revise de novo antes de confiar.' };
    }
    const settings = settingsStore.load();
    const current = normalizeAiSkills(settings.aiSkills).trusted;
    if (!isSkillTrusted(skill, current)) {
      const record = trustRecord(skill);
      // Um registro por raiz + arquivo: confiar no conteúdo novo substitui o antigo.
      const others = current.filter((t) => !(t.root === record.root && t.path === record.path));
      settingsStore.save({ ...settings, aiSkills: normalizeAiSkills({ trusted: [...others, record] }) });
    }
    return { ok: true };
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
  ipcMain.handle('agent:undo', async (event, checkpointId) => {
    const sender = event?.sender;
    // Checkpoint de outra janela: recusado. Sem dono conhecido (ex.: depois de reiniciar),
    // vale só o guard da janela que pediu.
    if (checkpointOwners.has(checkpointId) && checkpointOwners.get(checkpointId) !== senderId(sender)) {
      return { restored: [], errors: [{ path: null, message: 'Este checkpoint pertence a outra janela.' }] };
    }
    try {
      const g = guardOf(sender);
      // undoAsync: caminhos ssh:// voltam pelo provider desta janela.
      const result = await checkpoints.undoAsync(checkpointId, { assertPath: (p) => g.assertAllowed(p), providerFor: (p) => providerFor(p, sender) });
      if (!result.errors.length || result.restored.length) checkpointOwners.delete(checkpointId);
      return result;
    } catch (err) { return { restored: [], errors: [{ path: null, message: err.message }] }; }
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
