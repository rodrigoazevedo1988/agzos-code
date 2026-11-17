/**
 * Histórico local — instância única do processo main (userData/local-history).
 *
 * configureHistory({ userDataDir, getSettings }) é chamado por ipc/history.js no boot.
 * recordBefore(absPath, origin) é chamado ANTES das escritas do agente, da Vassoura e
 * do Cofre: guarda o conteúdo atual (se o módulo estiver ligado). Nunca lança — uma
 * falha do histórico não pode impedir a escrita. Sem configuração → não faz nada.
 */

const path = require('node:path');
const { createHistoryStore } = require('./store');
const { normalizeModules } = require('../../lib/settings');

let state = null; // { store, getSettings }

function options() {
  return normalizeModules(state?.getSettings?.()?.modules).localHistory;
}

/** Opções do Git Slider (settings.modules.gitSlider normalizado). */
function sliderOptions() {
  return normalizeModules(state?.getSettings?.()?.modules).gitSlider;
}

function configureHistory({ userDataDir, getSettings = () => ({}), now } = {}) {
  if (!userDataDir) return null;
  const store = createHistoryStore({
    dir: path.join(userDataDir, 'local-history'),
    getLimits: () => options(),
    ...(now ? { now } : {}),
  });
  state = { store, getSettings };
  return store;
}

function getHistoryStore() {
  return state?.store || null;
}

function isEnabled() {
  return !!state && options().enabled;
}

/** Guarda o conteúdo atual de `absPath` (ou `content`, se dado) com a origem. → entry | null */
function recordBefore(absPath, origin, { content } = {}) {
  try {
    if (!isEnabled() || typeof absPath !== 'string' || !absPath) return null;
    return state.store.record(absPath, origin, content === undefined ? {} : { content });
  } catch (err) {
    console.warn('[histórico] cópia não gravada:', err.message);
    return null;
  }
}

/** Só para testes. */
function resetHistory() {
  state = null;
}

module.exports = {
  configureHistory, getHistoryStore, isEnabled, recordBefore, sliderOptions, resetHistory,
};
