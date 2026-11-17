/**
 * Acesso do main (ferramentas do agente) à biblioteca de snippets configurada por ipc/snippets.js.
 * configureSnippets({ store, variables }) · getSnippetsRuntime() → { store, variables() } | null
 */

let runtime = null;

function configureSnippets(next) {
  runtime = next || null;
}

function getSnippetsRuntime() {
  return runtime;
}

module.exports = { configureSnippets, getSnippetsRuntime };
