/**
 * State central do app — singleton minimal.
 */

const State = {
  workspaceRoot: null,
  files: new Map(),
  activePath: null,
  expandedDirs: new Set(),
  settings: {
    theme: 'agzos-dark',
    iconTheme: 'lucide-color',
    performanceMode: 'balanced',
    telemetry: false,
    fontSize: 14,
    recentFolders: [],
    welcomeSeen: false,
    onboardingCompleted: false,
    onboardingSkipped: false,
    onboardingAnswers: null,
    ai: { activeProfileId: null, profiles: [], context: { file: true, selection: true, terminal: false } },
    github: { accounts: [], repoAccounts: {} },
    editor: {
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", monospace',
      tabSize: 2,
      insertSpaces: true,
      wordWrap: 'off',
      wordWrapColumn: 80,
      lineNumbers: 'on',
      minimap: true,
      renderWhitespace: 'selection',
      bracketPairColorization: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      smoothScrolling: true,
      formatOnSave: false,
      autoSave: 'off',
      autoSaveDelay: 1000,
    },
    workbench: {
      sidebarPosition: 'left',
      statusBarVisible: true,
    },
    terminal: {
      fontSize: 13,
      scrollback: 1000,
    },
    update: {
      autoDownload: true,
      channel: 'stable',
    },
  },
  term: null,
  sidebarHidden: false,
  bottomHidden: false,
  welcomeOpen: false,
  onboardingActive: false,
  onboardingForced: false,
  appVersion: null,
  platform: null,
};

window.AgzosState = State;
