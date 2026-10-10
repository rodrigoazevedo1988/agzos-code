/**
 * State central do app — singleton minimal.
 */

const State = {
  workspaceRoot: null,        // path absoluto da pasta aberta
  files: new Map(),            // path → { path, content, dirty, model }
  activePath: null,
  expandedDirs: new Set(),
  settings: {
    theme: 'agzos-dark',
    performanceMode: 'balanced',
    aiProvider: null,
    aiApiKey: null,
    telemetry: false,
    fontSize: 14,
    recentFolders: [],
  },
  term: null,                  // { id, proc, term, fit }
  sidebarHidden: false,
  bottomHidden: false,
};

// Expõe para outros módulos
window.AgzosState = State;
