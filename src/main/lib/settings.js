/**
 * Settings persistidas em JSON (userData/settings.json).
 * Sem dependência do Electron: recebe o caminho por parâmetro.
 */

const fs = require('fs');

const DEFAULT_SETTINGS = {
  theme: 'agzos-dark',
  iconTheme: 'lucide-color', // lucide-color | lucide-minimal | badges | emoji
  performanceMode: 'balanced', // economy | balanced | high
  telemetry: false,
  fontSize: 14,
  showHiddenFiles: true,
  recentFolders: [],
  welcomeSeen: false,
  onboardingCompleted: false,
  onboardingSkipped: false,
  onboardingAnswers: null,
  ai: { activeProfileId: null, profiles: [] },
  github: { accounts: [], repoAccounts: {} },
};

function defaults() {
  return structuredClone(DEFAULT_SETTINGS);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// BOMs aceitos. `JSON.parse` não tolera BOM, então ele é removido antes.
const BOM_UTF8 = Buffer.from([0xef, 0xbb, 0xbf]);
const BOM_UTF16LE = Buffer.from([0xff, 0xfe]);
const BOM_UTF16BE = Buffer.from([0xfe, 0xff]);

/**
 * Decodifica o conteúdo de settings.json tolerando BOM.
 * PowerShell (5.1) grava UTF-16 LE com BOM em `>`/`Out-File`, e editores
 * Windows gravam UTF-8 com BOM; nos dois casos o arquivo é JSON válido.
 */
function decodeText(buffer) {
  if (buffer.subarray(0, 3).equals(BOM_UTF8)) {
    return buffer.subarray(3).toString('utf-8');
  }
  if (buffer.subarray(0, 2).equals(BOM_UTF16LE)) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.subarray(0, 2).equals(BOM_UTF16BE)) {
    const body = Buffer.from(buffer.subarray(2));
    body.swap16(); // utf16le lendo bytes trocados = utf16be
    return body.toString('utf16le');
  }
  const text = buffer.toString('utf-8');
  // Cinto e suspensório: BOM pode sobrar como U+FEFF se decodificado antes.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Lê as settings. Arquivo ausente → defaults. JSON inválido → move o arquivo
 * para `settings.json.corrupt-<timestamp>` e retorna defaults.
 * BOM (UTF-8 ou UTF-16) não torna o arquivo inválido.
 */
function loadSettings(filePath) {
  let raw;
  try {
    raw = decodeText(fs.readFileSync(filePath));
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
  return { ...defaults(), ...parsed };
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

module.exports = { DEFAULT_SETTINGS, loadSettings, saveSettings, migrateLegacySecrets };
