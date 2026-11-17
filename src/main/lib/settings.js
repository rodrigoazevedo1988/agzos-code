/**
 * Settings persistidas em JSON (userData/settings.json).
 * Sem dependência do Electron: recebe o caminho por parâmetro.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  theme: 'agzos-dark',
  iconTheme: 'lucide-color', // lucide-color | lucide-minimal | badges | emoji
  performanceMode: 'balanced', // economy | balanced | high
  telemetry: false,
  fontSize: 14,
  recentFolders: [],
  welcomeSeen: false,
  onboardingCompleted: false,
  onboardingSkipped: false,
  onboardingAnswers: null,
  ai: { activeProfileId: null, profiles: [], context: { file: true, selection: true, terminal: false } },
  aiPanel: {
    position: 'right', // left | right | bottom
    width: 380,
    visible: true,
    fontSize: 13, // 11–18
    density: 'comfortable', // compact | comfortable
    showAvatars: true,
    sendKey: 'enter', // enter | ctrlEnter
    defaultContext: { file: true, selection: true, terminal: false },
    // Compactar conversa: automática antes do pedido e dentro do agente (ai/compact.js).
    autoCompact: true,
    compactThresholdTokens: 60000, // 8k–400k
  },
  // Agente: modo de autonomia ask | edit | auto. Dono: ipc/agent.js (agent:setMode).
  aiAgent: { mode: 'edit', maxSteps: 100 },
  // Skills de projeto confiadas pelo usuário: [{ root, path, sha256 }] (só o main grava).
  aiSkills: { trusted: [] },
  // Contas GitHub (só metadados; tokens no cofre em github.<id>). Dono: ipc/github.js.
  github: { accounts: [], defaultAccountId: null, repoAccounts: {} },
  editor: {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off', // off | on | wordWrapColumn
    wordWrapColumn: 80,
    lineNumbers: 'on', // on | off | relative
    minimap: true,
    renderWhitespace: 'selection', // none | boundary | selection | all
    bracketPairColorization: true,
    cursorBlinking: 'smooth', // blink | smooth | phase | expand | solid
    cursorSmoothCaretAnimation: 'on', // on | off | explicit
    smoothScrolling: true,
    formatOnSave: false,
    autoSave: 'off', // off | afterDelay | onFocusChange
    autoSaveDelay: 1000,
  },
  workbench: {
    sidebarPosition: 'left', // left | right
    statusBarVisible: true,
  },
  // Janela/app: Ctrl+Q e Arquivo › Sair pedem confirmação (ver lib/quit-confirm.js).
  window: {
    confirmBeforeQuit: true,
  },
  terminal: {
    fontSize: 13,
    scrollback: 1000,
  },
  update: {
    autoDownload: true,
    channel: 'stable', // stable | beta
  },
  // Módulos nativos (1.1.0). Normalização em normalizeModules.
  modules: {
    broom: {
      enabled: true,
      rules: { console: true, comments: true, unusedImports: true, deadCode: true },
      keepConsole: ['error', 'warn'],
      keepComments: ['jsdoc', 'directives', 'license'],
      statusBar: true,
    },
    envVault: {
      enabled: true,
      blockCommits: true,
      extraPatterns: [], // [{ name, regex }]
      allowlist: [], // valores/hashes de valores que nunca bloqueiam
      revealTimeoutSec: 10, // 3–120
    },
    // Histórico local e Git Slider (1.2.0). Normalização em normalizeHistoryModules.
    localHistory: { enabled: true, maxPerFile: 50, maxDays: 30, maxTotalMB: 300 },
    gitSlider: { enabled: true, maxCommits: 200 },
    // Módulos de editor (1.2.0). Normalização em normalizeEditorMods.
    inlineErrors: { enabled: true, severities: ['error', 'warning'], onlyCursorLine: false },
    prettyErrors: { enabled: true },
    highlighter: { enabled: true, tags: ['!=#FF5252', '?=#4FC3F7', 'TODO=#FF9800', 'FIXME=#FF9800', '*=#98C379', '//=#7A7A7A'] },
    formatter: {
      enabled: true,
      formatOnSave: {
        javascript: false, typescript: false, json: false, css: false, scss: false, less: false, html: false, markdown: false, yaml: false,
      },
    },
  },
};

function defaults() {
  return structuredClone(DEFAULT_SETTINGS);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(target, source) {
  const output = isPlainObject(target) ? { ...target } : {};
  if (!isPlainObject(source)) return output;

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

const AI_PANEL_WIDTH = { min: 240, max: 1600 };
const COMPACT_THRESHOLD = { min: 8000, max: 400000 };

/** Valores inválidos de `aiPanel` voltam ao padrão (campo a campo). */
function normalizeAiPanel(value, legacyContext) {
  const def = DEFAULT_SETTINGS.aiPanel;
  const v = isPlainObject(value) ? value : {};
  const pick = (val, allowed, fallback) => (allowed.includes(val) ? val : fallback);
  const int = (val, min, max, fallback) => {
    const n = typeof val === 'number' ? val : Number.NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const ctxSource = isPlainObject(v.defaultContext) ? v.defaultContext
    : (isPlainObject(legacyContext) ? legacyContext : def.defaultContext);
  const defaultContext = {};
  for (const key of ['file', 'selection', 'terminal']) {
    defaultContext[key] = typeof ctxSource[key] === 'boolean' ? ctxSource[key] : def.defaultContext[key];
  }
  return {
    ...v,
    position: pick(v.position, ['left', 'right', 'bottom'], def.position),
    width: int(v.width, AI_PANEL_WIDTH.min, AI_PANEL_WIDTH.max, def.width),
    visible: typeof v.visible === 'boolean' ? v.visible : def.visible,
    fontSize: int(v.fontSize, 11, 18, def.fontSize),
    density: pick(v.density, ['compact', 'comfortable'], def.density),
    showAvatars: typeof v.showAvatars === 'boolean' ? v.showAvatars : def.showAvatars,
    sendKey: pick(v.sendKey, ['enter', 'ctrlEnter'], def.sendKey),
    defaultContext,
    autoCompact: typeof v.autoCompact === 'boolean' ? v.autoCompact : def.autoCompact,
    // Campo numérico das Configurações pode chegar como string.
    compactThresholdTokens: int(
      typeof v.compactThresholdTokens === 'string' && v.compactThresholdTokens.trim() ? Number(v.compactThresholdTokens) : v.compactThresholdTokens,
      COMPACT_THRESHOLD.min, COMPACT_THRESHOLD.max, def.compactThresholdTokens,
    ),
  };
}

/** Limites de passos do agente por pedido. */
const AGENT_STEP_LIMITS = [25, 50, 100, 200, 500];

/** `aiAgent.mode` inválido volta a 'edit'; `maxSteps` fora da lista volta a 100. */
function normalizeAiAgent(value) {
  const v = isPlainObject(value) ? value : {};
  const steps = Number(v.maxSteps);
  return {
    ...v,
    mode: ['ask', 'edit', 'auto'].includes(v.mode) ? v.mode : DEFAULT_SETTINGS.aiAgent.mode,
    maxSteps: AGENT_STEP_LIMITS.includes(steps) ? steps : DEFAULT_SETTINGS.aiAgent.maxSteps,
  };
}

const MAX_TRUSTED_SKILLS = 500;

/**
 * `aiSkills.trusted`: registros { root, path, sha256 } de skills de projeto confiadas.
 * Descarta itens inválidos (caminho relativo, hash que não é sha256 hex) e duplicados.
 */
function normalizeAiSkills(value) {
  const v = isPlainObject(value) ? value : {};
  const seen = new Set();
  const trusted = [];
  for (const t of Array.isArray(v.trusted) ? v.trusted : []) {
    if (!isPlainObject(t)) continue;
    const { root, path: file, sha256 } = t;
    if (typeof root !== 'string' || typeof file !== 'string' || !path.isAbsolute(root) || !path.isAbsolute(file)) continue;
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) continue;
    const key = `${root}\0${file}\0${sha256}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trusted.push({ root, path: file, sha256 });
  }
  return { trusted: trusted.slice(-MAX_TRUSTED_SKILLS) };
}

/** `window.confirmBeforeQuit` não booleano volta ao padrão (true). */
function normalizeWindow(value) {
  const v = isPlainObject(value) ? value : {};
  const c = v.confirmBeforeQuit;
  return { ...v, confirmBeforeQuit: typeof c === 'boolean' ? c : DEFAULT_SETTINGS.window.confirmBeforeQuit };
}

const BROOM_RULES = ['console', 'comments', 'unusedImports', 'deadCode'];
const BROOM_KEEP_COMMENTS = ['jsdoc', 'directives', 'license'];

function isValidRegex(src) {
  try {
    new RegExp(src);
    return true;
  } catch {
    return false;
  }
}

/** localHistory/gitSlider: inteiros fora da faixa voltam ao padrão, campo a campo. */
function normalizeHistoryModules(v) {
  const def = DEFAULT_SETTINGS.modules;
  const int = (val, min, max, fallback) => (Number.isInteger(val) && val >= min && val <= max ? val : fallback);
  const h = isPlainObject(v.localHistory) ? v.localHistory : {};
  const g = isPlainObject(v.gitSlider) ? v.gitSlider : {};
  return {
    localHistory: {
      ...h,
      enabled: typeof h.enabled === 'boolean' ? h.enabled : def.localHistory.enabled,
      maxPerFile: int(h.maxPerFile, 1, 1000, def.localHistory.maxPerFile),
      maxDays: int(h.maxDays, 1, 3650, def.localHistory.maxDays),
      maxTotalMB: int(h.maxTotalMB, 10, 10000, def.localHistory.maxTotalMB),
    },
    gitSlider: {
      ...g,
      enabled: typeof g.enabled === 'boolean' ? g.enabled : def.gitSlider.enabled,
      maxCommits: int(g.maxCommits, 10, 2000, def.gitSlider.maxCommits),
    },
  };
}

const INLINE_SEVERITIES = ['error', 'warning', 'info'];
const HIGHLIGHT_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** "marcador=#cor" válido → forma canônica (sem espaços); inválido → null. */
function normalizeHighlightTag(raw) {
  if (typeof raw !== 'string') return null;
  const at = raw.lastIndexOf('=');
  if (at <= 0) return null;
  const tag = raw.slice(0, at).trim();
  const color = raw.slice(at + 1).trim();
  if (!tag || tag.length > 20 || /\s/.test(tag) || !HIGHLIGHT_COLOR.test(color)) return null;
  return `${tag}=${color}`;
}

/** Módulos de editor da 1.2.0 (Erros na Linha, Erros Claros, Marca-texto, Formatador). */
function normalizeEditorMods(v) {
  const def = DEFAULT_SETTINGS.modules;
  const bool = (val, fallback) => (typeof val === 'boolean' ? val : fallback);
  const obj = (val) => (isPlainObject(val) ? val : {});

  const ie = obj(v.inlineErrors);
  const hl = obj(v.highlighter);
  const fm = obj(v.formatter);
  const fosIn = obj(fm.formatOnSave);
  const formatOnSave = {};
  for (const [lang, val] of Object.entries(def.formatter.formatOnSave)) formatOnSave[lang] = bool(fosIn[lang], val);
  const severities = Array.isArray(ie.severities)
    ? INLINE_SEVERITIES.filter((s) => ie.severities.includes(s))
    : [...def.inlineErrors.severities];

  return {
    inlineErrors: {
      ...ie,
      enabled: bool(ie.enabled, def.inlineErrors.enabled),
      severities,
      onlyCursorLine: bool(ie.onlyCursorLine, def.inlineErrors.onlyCursorLine),
    },
    prettyErrors: { ...obj(v.prettyErrors), enabled: bool(obj(v.prettyErrors).enabled, def.prettyErrors.enabled) },
    highlighter: {
      ...hl,
      enabled: bool(hl.enabled, def.highlighter.enabled),
      tags: Array.isArray(hl.tags) ? hl.tags.map(normalizeHighlightTag).filter(Boolean) : [...def.highlighter.tags],
    },
    formatter: { ...fm, enabled: bool(fm.enabled, def.formatter.enabled), formatOnSave },
  };
}

/** Valores inválidos de `modules` voltam ao padrão (campo a campo; listas item a item). */
function normalizeModules(value) {
  const def = DEFAULT_SETTINGS.modules;
  const v = isPlainObject(value) ? value : {};
  const bool = (val, fallback) => (typeof val === 'boolean' ? val : fallback);

  const b = isPlainObject(v.broom) ? v.broom : {};
  const rulesIn = isPlainObject(b.rules) ? b.rules : {};
  const rules = {};
  for (const key of BROOM_RULES) rules[key] = bool(rulesIn[key], def.broom.rules[key]);
  const keepConsole = Array.isArray(b.keepConsole)
    ? b.keepConsole.filter((m) => typeof m === 'string' && /^[A-Za-z]+$/.test(m))
    : [...def.broom.keepConsole];
  const keepComments = Array.isArray(b.keepComments)
    ? b.keepComments.filter((k) => BROOM_KEEP_COMMENTS.includes(k))
    : [...def.broom.keepComments];

  const e = isPlainObject(v.envVault) ? v.envVault : {};
  const extraPatterns = Array.isArray(e.extraPatterns)
    ? e.extraPatterns
      .filter((p) => isPlainObject(p) && typeof p.name === 'string' && p.name.trim()
        && typeof p.regex === 'string' && p.regex && isValidRegex(p.regex))
      .map((p) => ({ name: p.name, regex: p.regex }))
    : [];
  const allowlist = Array.isArray(e.allowlist) ? e.allowlist.filter((a) => typeof a === 'string' && a) : [];
  const t = e.revealTimeoutSec;
  const revealTimeoutSec = typeof t === 'number' && Number.isInteger(t) && t >= 3 && t <= 120
    ? t : def.envVault.revealTimeoutSec;

  return {
    ...v,
    broom: {
      ...b,
      enabled: bool(b.enabled, def.broom.enabled),
      rules,
      keepConsole,
      keepComments,
      statusBar: bool(b.statusBar, def.broom.statusBar),
    },
    envVault: {
      ...e,
      enabled: bool(e.enabled, def.envVault.enabled),
      blockCommits: bool(e.blockCommits, def.envVault.blockCommits),
      extraPatterns,
      allowlist,
      revealTimeoutSec,
    },
    ...normalizeHistoryModules(v),
    ...normalizeEditorMods(v),
  };
}

/**
 * Lê as settings. Arquivo ausente → defaults. JSON inválido → move o arquivo
 * para `settings.json.corrupt-<timestamp>` e retorna defaults.
 */
function loadSettings(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('settings read error', e);
    return defaults();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error('settings corrompidas, criando backup', e.message);
    try {
      fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    } catch (renameErr) {
      console.error('settings backup error', renameErr);
    }
    return defaults();
  }

  if (!isPlainObject(parsed)) return defaults();
  const merged = deepMerge(defaults(), parsed);
  // Contexto padrão herda a escolha antiga (ai.context) de quem já usava o chat.
  merged.aiPanel = normalizeAiPanel(parsed.aiPanel, parsed.ai?.context);
  merged.aiAgent = normalizeAiAgent(parsed.aiAgent);
  merged.aiSkills = normalizeAiSkills(parsed.aiSkills);
  merged.modules = normalizeModules(parsed.modules);
  merged.window = normalizeWindow(parsed.window);
  return merged;
}

/**
 * Grava em `<arquivo>.tmp` e troca pelo arquivo final (escrita atômica).
 * Retorna true se gravou.
 */
function saveSettings(filePath, settings) {
  const tmp = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
    return true;
  } catch (e) {
    console.error('settings save error', e);
    return false;
  }
}

/**
 * Move segredos antigos de settings.json para o cofre.
 *  - aiApiKey        → store 'ai.legacy'
 *  - onboardingAnswers.github.token → store 'github.onboarding'
 * Se o cofre falhar, o segredo permanece no settings (não se perde) e changed = false.
 */
function migrateLegacySecrets(settings, store) {
  const out = { ...settings };
  let changed = false;

  if (typeof out.aiApiKey === 'string' && out.aiApiKey) {
    try {
      store.set('ai.legacy', out.aiApiKey);
      delete out.aiApiKey;
      changed = true;
    } catch (e) {
      console.error('migração da API key falhou; mantida no settings', e.message);
      return { settings: out, changed: false };
    }
  }

  const token = out.onboardingAnswers?.github?.token;
  if (typeof token === 'string' && token) {
    try {
      store.set('github.onboarding', token);
      out.onboardingAnswers = {
        ...out.onboardingAnswers,
        github: { type: 'pat' },
      };
      changed = true;
    } catch (e) {
      console.error('migração do token do onboarding falhou; mantido no settings', e.message);
    }
  }

  return { settings: out, changed };
}

module.exports = {
  DEFAULT_SETTINGS, normalizeAiPanel, normalizeAiAgent, normalizeAiSkills, normalizeModules, normalizeWindow, loadSettings, saveSettings, migrateLegacySecrets,
};
