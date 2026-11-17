/**
 * Agrega as ferramentas do agente de cada módulo nativo.
 * Cada `agent-tool.js` exporta null (sem ferramenta), uma ferramenta extra ou uma lista.
 * Formato de ferramenta extra: ver o cabeçalho de src/main/agent/tools.js.
 */

const { normalizeModules } = require('../lib/settings');

const MODULE_TOOLS = [
  { module: 'broom', load: () => require('./broom/agent-tool') },
  { module: 'envVault', load: () => require('./envvault/agent-tool') },
  { module: 'tree', load: () => require('./tree/agent-tool') },
];

/** Ferramentas extras dos módulos habilitados em `settings.modules`. */
function getModuleTools(settings, { registry = MODULE_TOOLS } = {}) {
  const modules = normalizeModules(settings?.modules);
  const out = [];
  for (const entry of registry) {
    if (!modules[entry.module]?.enabled) continue;
    const exported = entry.load();
    if (!exported) continue;
    for (const tool of Array.isArray(exported) ? exported : [exported]) {
      if (tool && tool.definition && typeof tool.prepare === 'function') out.push(tool);
    }
  }
  return out;
}

module.exports = { getModuleTools, MODULE_TOOLS };
