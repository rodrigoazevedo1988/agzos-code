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
    aiProvider: null,
    telemetry: false,
    fontSize: 14,
    recentFolders: [],
    welcomeSeen: false,
    onboardingCompleted: false,
    onboardingSkipped: false,
    onboardingAnswers: null,
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
