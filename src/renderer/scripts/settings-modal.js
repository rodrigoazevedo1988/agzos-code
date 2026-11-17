/**
 * Settings Modal — Redesenho no padrão Modal Separado estilo VS Code.
 *
 * Características:
 *  - Modal dedicado com backdrop (Ctrl+, / Cmd+,)
 *  - Busca instantânea de configurações (suporta @modified para ver apenas alterações)
 *  - Menu lateral por categorias:
 *      * Comumente Usados
 *      * Editor de Texto
 *      * Aparência & Temas
 *      * Terminal
 *      * Agzos IA
 *      * Git & GitHub
 *      * Atualizações (OTA)
 *      * Privacidade & Dados
 *      * Módulos Agzos (subseções por módulo)
 *  - Indicador visual em configurações alteradas do padrão + botão individual de reset
 *  - Alternância para editor JSON direto ({ } settings.json)
 */

import { toast } from './toast.js';
import { lucideIcon } from './lucide.js';
import { perfLabel } from './labels.js';
import { applyTheme, applyFontSize, applyEditorSettings } from './editor.js';
import { applyTerminalFontSize } from './terminal.js';
import { matchShortcut } from './keymap.js';
import { clampNumber, resetModalOwnedSettings } from './ui-utils.js';

const State = window.AgzosState;

const DEFAULTS = {
  theme: 'agzos-dark',
  iconTheme: 'lucide-color',
  performanceMode: 'balanced',
  telemetry: false,
  fontSize: 14,
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
  window: {
    confirmBeforeQuit: true,
  },
  terminal: {
    fontSize: 13,
    scrollback: 1000,
  },
  update: {
    autoDownload: true,
    channel: 'stable',
  },
  aiPanel: {
    position: 'right',
    width: 380,
    visible: true,
    fontSize: 13,
    density: 'comfortable',
    showAvatars: true,
    sendKey: 'enter',
    defaultContext: { file: true, selection: true, terminal: false },
  },
  // Espelho de DEFAULT_SETTINGS.modules (src/main/lib/settings.js).
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
      extraPatterns: [],
      allowlist: [],
      revealTimeoutSec: 10,
    },
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

/** Avisa os módulos nativos que `settings.modules` mudou. */
function notifyModules() {
  window.dispatchEvent(new CustomEvent('agzos:modules-settings', { detail: { modules: State.settings.modules } }));
}

/** Avisa o painel de chat para reaplicar fonte/densidade/avatares/atalho. */
function notifyAiPanel() {
  window.dispatchEvent(new CustomEvent('agzos:ai-panel-settings'));
}

const CATEGORIES = [
  { id: 'commonlyUsed', label: 'Comumente Usados', icon: 'sliders' },
  { id: 'editor',       label: 'Editor de Texto',   icon: 'code' },
  { id: 'appearance',   label: 'Aparência & Temas', icon: 'palette' },
  { id: 'terminal',     label: 'Terminal',          icon: 'square-terminal' },
  { id: 'ai',           label: 'Agzos IA',          icon: 'sparkles' },
  { id: 'git',          label: 'Git & GitHub',      icon: 'git-branch' },
  { id: 'update',       label: 'Atualizações (OTA)',icon: 'refresh-cw' },
  { id: 'privacy',      label: 'Privacidade & Dados',icon: 'shield' },
  { id: 'modules',      label: 'Módulos Agzos',     icon: 'blocks' },
];

let activeCategory = 'commonlyUsed';
let searchQuery = '';
let isJsonMode = false;
let otaProgressData = null;

function getNestedValue(obj, path) {
  const parts = path.split('.');
  let curr = obj;
  for (const part of parts) {
    if (curr == null) return undefined;
    curr = curr[part];
  }
  return curr;
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let curr = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (curr[p] == null || typeof curr[p] !== 'object') curr[p] = {};
    curr = curr[p];
  }
  curr[parts[parts.length - 1]] = value;
}

function isModified(key) {
  const currentVal = getNestedValue(State.settings, key);
  const defaultVal = getNestedValue(DEFAULTS, key);
  if (defaultVal === undefined) return false;
  return JSON.stringify(currentVal) !== JSON.stringify(defaultVal);
}

// Definição dos itens de configuração para exibição
const SETTINGS_DEF = [
  // Comumente Usados
  {
    key: 'theme',
    title: 'Workbench: Color Theme',
    desc: 'Define o tema visual geral da interface e do editor de código.',
    categories: ['commonlyUsed', 'appearance'],
    type: 'select',
    options: [
      { value: 'agzos-dark', label: 'Agzos Dark (Padrão Oficial)' },
      { value: 'agzos-light', label: 'Agzos Light' },
      { value: 'monokai', label: 'Monokai' },
    ],
    apply: (val) => {
      applyTheme(val);
      document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${val}`;
    },
  },
  {
    key: 'fontSize',
    title: 'Editor: Font Size',
    desc: 'Controls the font size in pixels for code editors.',
    categories: ['commonlyUsed', 'editor'],
    type: 'number',
    min: 10,
    max: 32,
    apply: (val) => applyFontSize(Number(val)),
  },
  {
    key: 'iconTheme',
    title: 'Workbench: Icon Theme',
    desc: 'Estilo dos ícones exibidos na árvore de arquivos e nas abas.',
    categories: ['commonlyUsed', 'appearance'],
    type: 'select',
    options: [
      { value: 'lucide-color', label: 'Lucide Moderno (Colorido)' },
      { value: 'lucide-minimal', label: 'Lucide Minimalista' },
      { value: 'badges', label: 'Badges Técnicos (Seti)' },
      { value: 'emoji', label: 'Emoji Clássico' },
    ],
    apply: async (val) => {
      State.settings.iconTheme = val;
      const fileTreeMod = await import('./file-tree.js');
      fileTreeMod.refreshTree(true);
      const tabsMod = await import('./tabs.js');
      tabsMod.renderTabs();
    },
  },
  {
    key: 'performanceMode',
    title: 'Workbench: Performance Mode',
    desc: 'Controla animações, consumo de CPU e suavizações de rolagem.',
    categories: ['commonlyUsed', 'appearance'],
    type: 'select',
    options: [
      { value: 'economy', label: 'Economia (desativa animações e transições)' },
      { value: 'balanced', label: 'Balanceado (recomendado)' },
      { value: 'high', label: 'Alta Performance' },
    ],
    apply: (val) => {
      document.body.classList.remove('perf-economy', 'perf-high');
      if (val === 'economy') document.body.classList.add('perf-economy');
      if (val === 'high') document.body.classList.add('perf-high');
      const statusEl = document.getElementById('status-perf');
      if (statusEl) statusEl.textContent = perfLabel(val);
    },
  },
  {
    key: 'window.confirmBeforeQuit',
    title: 'Janela: Confirmar ao Sair',
    desc: 'Pergunta antes de sair do app (Ctrl+Q / Arquivo › Sair). Fechar uma janela não pergunta; com arquivos não salvos, sempre pergunta.',
    categories: ['appearance'],
    type: 'boolean',
  },
  {
    key: 'editor.tabSize',
    title: 'Editor: Tab Size',
    desc: 'O número de espaços equivalentes a uma tabulação.',
    categories: ['commonlyUsed', 'editor'],
    type: 'number',
    min: 1,
    max: 8,
    apply: (val) => applyEditorSettings({ tabSize: Number(val) }),
  },
  {
    key: 'editor.wordWrap',
    title: 'Editor: Quebra de Linha (Word Wrap)',
    desc: 'Controla como as linhas longas devem quebrar na tela.',
    categories: ['commonlyUsed', 'editor'],
    type: 'select',
    options: [
      { value: 'off', label: 'Desativado (rolagem horizontal)' },
      { value: 'on', label: 'Ativado (quebra na largura da janela)' },
      { value: 'wordWrapColumn', label: 'Quebrar na coluna configurada' },
    ],
    apply: (val) => applyEditorSettings({ wordWrap: val }),
  },
  {
    key: 'editor.minimap',
    title: 'Editor: Minimapa',
    desc: 'Exibe a visualização em miniatura do código no lado direito.',
    categories: ['commonlyUsed', 'editor'],
    type: 'boolean',
    apply: (val) => applyEditorSettings({ minimap: val }),
  },

  // Editor de Texto
  {
    key: 'editor.fontFamily',
    title: 'Editor: Família da Fonte',
    desc: 'Fonte usada no editor (monospace).',
    categories: ['editor'],
    type: 'text',
    apply: (val) => applyEditorSettings({ fontFamily: val }),
  },
  {
    key: 'editor.insertSpaces',
    title: 'Editor: Inserir Espaços',
    desc: 'Insere espaços ao pressionar a tecla Tab.',
    categories: ['editor'],
    type: 'boolean',
    apply: (val) => applyEditorSettings({ insertSpaces: val }),
  },
  {
    key: 'editor.lineNumbers',
    title: 'Editor: Números de Linha',
    desc: 'Controla a exibição dos números de linha na margem esquerda.',
    categories: ['editor'],
    type: 'select',
    options: [
      { value: 'on', label: 'Ligado' },
      { value: 'off', label: 'Desligado' },
      { value: 'relative', label: 'Relativo' },
    ],
    apply: (val) => applyEditorSettings({ lineNumbers: val }),
  },
  {
    key: 'editor.renderWhitespace',
    title: 'Editor: Exibir Caracteres em Branco',
    desc: 'Define como espaços e tabulações são renderizados.',
    categories: ['editor'],
    type: 'select',
    options: [
      { value: 'none', label: 'Nenhum' },
      { value: 'boundary', label: 'Apenas entre palavras' },
      { value: 'selection', label: 'Apenas no texto selecionado' },
      { value: 'all', label: 'Sempre' },
    ],
    apply: (val) => applyEditorSettings({ renderWhitespace: val }),
  },
  {
    key: 'editor.bracketPairColorization',
    title: 'Editor: Colorização de Pares de Colchetes',
    desc: 'Coloriza pares correspondentes de colchetes e chaves com cores distintas.',
    categories: ['editor'],
    type: 'boolean',
    apply: (val) => applyEditorSettings({ bracketPairColorization: val }),
  },
  {
    key: 'editor.formatOnSave',
    title: 'Editor: Formatar ao Salvar',
    desc: 'Formata o arquivo automaticamente antes de salvar no disco.',
    categories: ['editor'],
    type: 'boolean',
    apply: () => {},
  },
  {
    key: 'editor.autoSave',
    title: 'Editor: Salvamento Automático (Auto Save)',
    desc: 'Salva arquivos modificados automaticamente sem precisar de Ctrl+S.',
    categories: ['editor'],
    type: 'select',
    options: [
      { value: 'off', label: 'Desativado (salvar com Ctrl+S)' },
      { value: 'afterDelay', label: 'Após atraso configurado' },
      { value: 'onFocusChange', label: 'Quando o editor perder o foco' },
    ],
    apply: () => {},
  },
  {
    key: 'editor.autoSaveDelay',
    title: 'Editor: Atraso do Auto Save (ms)',
    desc: 'Tempo em milissegundos para salvar o arquivo após parar de digitar.',
    categories: ['editor'],
    type: 'number',
    min: 200,
    max: 10000,
    apply: () => {},
  },

  // Terminal
  {
    key: 'terminal.fontSize',
    title: 'Terminal: Tamanho da Fonte',
    desc: 'Tamanho da fonte em pixels para o terminal integrado.',
    categories: ['terminal'],
    type: 'number',
    min: 10,
    max: 24,
    apply: (val) => applyTerminalFontSize(Number(val)),
  },
  {
    key: 'terminal.scrollback',
    title: 'Terminal: Linhas de Histórico (Scrollback)',
    desc: 'Quantidade máxima de linhas mantidas no buffer do terminal.',
    categories: ['terminal'],
    type: 'number',
    min: 100,
    max: 10000,
    apply: () => {},
  },

  // Agzos IA — personalização do painel (aplicação ao vivo)
  {
    key: 'aiPanel.position',
    title: 'Agzos IA: Posição do Painel',
    desc: 'Onde o painel de chat fica acoplado. A conversa e uma resposta em andamento são mantidas ao mover.',
    categories: ['ai'],
    type: 'select',
    options: [
      { value: 'right', label: 'Direita (ao lado do editor)' },
      { value: 'left', label: 'Esquerda (na barra lateral)' },
      { value: 'bottom', label: 'Embaixo (aba do painel inferior)' },
    ],
    apply: (val) => window.AgzosAiDock?.setPosition?.(val),
  },
  {
    key: 'aiPanel.fontSize',
    title: 'Agzos IA: Tamanho da Fonte',
    desc: 'Tamanho do texto das mensagens e da caixa de mensagem, em pixels (11 a 18).',
    categories: ['ai'],
    type: 'number',
    min: 11,
    max: 18,
    apply: notifyAiPanel,
  },
  {
    key: 'aiPanel.density',
    title: 'Agzos IA: Densidade',
    desc: 'Espaçamento entre mensagens e margens do painel.',
    categories: ['ai'],
    type: 'select',
    options: [
      { value: 'comfortable', label: 'Confortável' },
      { value: 'compact', label: 'Compacta' },
    ],
    apply: notifyAiPanel,
  },
  {
    key: 'aiPanel.showAvatars',
    title: 'Agzos IA: Avatar nas Respostas',
    desc: 'Mostra a marca Agzos ao lado de cada resposta da IA.',
    categories: ['ai'],
    type: 'boolean',
    apply: notifyAiPanel,
  },
  {
    key: 'aiPanel.sendKey',
    title: 'Agzos IA: Tecla de Envio',
    desc: 'Atalho que envia a mensagem. A outra combinação quebra a linha.',
    categories: ['ai'],
    type: 'select',
    options: [
      { value: 'enter', label: 'Enter envia (Shift+Enter quebra linha)' },
      { value: 'ctrlEnter', label: 'Ctrl/Cmd+Enter envia (Enter quebra linha)' },
    ],
    apply: notifyAiPanel,
  },
  {
    key: 'aiPanel.defaultContext.file',
    title: 'Agzos IA: Enviar Arquivo Atual por Padrão',
    desc: 'Envia o arquivo aberto junto com cada nova conversa.',
    categories: ['ai'],
    type: 'boolean',
    apply: notifyAiPanel,
  },
  {
    key: 'aiPanel.defaultContext.selection',
    title: 'Agzos IA: Enviar Seleção por Padrão',
    desc: 'Envia o trecho selecionado no editor junto com cada nova conversa.',
    categories: ['ai'],
    type: 'boolean',
    apply: notifyAiPanel,
  },
  {
    key: 'aiPanel.defaultContext.terminal',
    title: 'Agzos IA: Enviar Terminal por Padrão',
    desc: 'Envia a saída recente do terminal junto com cada nova conversa.',
    categories: ['ai'],
    type: 'boolean',
    apply: notifyAiPanel,
  },
  {
    key: 'aiAgent.mode',
    title: 'Agzos IA: Autonomia do Agente',
    desc: 'O que o agente pode fazer sem pedir OK. Comandos de risco sempre pedem confirmação.',
    categories: ['ai'],
    type: 'select',
    options: [
      { value: 'ask', label: 'Perguntar tudo (pede OK para criar, editar, apagar e rodar comandos)' },
      { value: 'edit', label: 'Edição livre (cria e edita sozinho; pede OK para apagar, mover e comandos)' },
      { value: 'auto', label: 'Automático (faz tudo sem perguntar)' },
    ],
    apply: (val) => {
      Promise.resolve(window.agzos.agent?.setMode?.(val)).catch(() => {});
      window.dispatchEvent(new CustomEvent('agzos:agent-mode', { detail: { mode: val } }));
    },
  },

  // Módulos Agzos — Vassoura de Produção
  {
    key: 'modules.broom.enabled',
    title: 'Vassoura: Habilitada',
    desc: 'Ativa a Vassoura de Produção (limpeza de console, comentários, imports não usados e código morto).',
    categories: ['modules'],
    section: 'Vassoura de Produção',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.broom.rules.console',
    title: 'Vassoura: Remover console.*',
    desc: 'Remove chamadas de console usadas como instrução (exceto os métodos mantidos abaixo).',
    categories: ['modules'],
    section: 'Vassoura de Produção',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.broom.rules.comments',
    title: 'Vassoura: Remover comentários',
    desc: 'Remove comentários comuns. JSDoc, diretivas (@ts-…, eslint-…) e licenças são mantidos.',
    categories: ['modules'],
    section: 'Vassoura de Produção',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.broom.rules.unusedImports',
    title: 'Vassoura: Remover imports não usados',
    desc: 'Remove especificadores importados que não são usados no arquivo.',
    categories: ['modules'],
    section: 'Vassoura de Produção',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.broom.rules.deadCode',
    title: 'Vassoura: Remover código morto',
    desc: 'Remove instruções após return/throw/break/continue e blocos if (false).',
    categories: ['modules'],
    section: 'Vassoura de Produção',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.broom.keepConsole',
    title: 'Vassoura: Métodos de console mantidos',
    desc: 'Métodos de console que nunca são removidos, separados por vírgula (ex.: error, warn).',
    categories: ['modules'],
    section: 'Vassoura de Produção',
    type: 'list',
    apply: notifyModules,
  },
  {
    key: 'modules.broom.statusBar',
    title: 'Vassoura: Contador na barra de status',
    desc: 'Mostra na barra de status quantos itens a Vassoura removeria do arquivo atual.',
    categories: ['modules'],
    section: 'Vassoura de Produção',
    type: 'boolean',
    apply: notifyModules,
  },

  // Módulos Agzos — Cofre .env
  {
    key: 'modules.envVault.enabled',
    title: 'Cofre .env: Habilitado',
    desc: 'Ativa o Cofre .env (valores mascarados, comparação com .env.example e detecção de segredos).',
    categories: ['modules'],
    section: 'Cofre .env',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.envVault.blockCommits',
    title: 'Cofre .env: Bloquear commits com segredos',
    desc: 'Antes de commitar, verifica o que está no stage e bloqueia se encontrar possíveis segredos.',
    categories: ['modules'],
    section: 'Cofre .env',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.envVault.revealTimeoutSec',
    title: 'Cofre .env: Tempo de revelação (segundos)',
    desc: 'Por quanto tempo um valor revelado fica visível antes de ser mascarado de novo (3 a 120).',
    categories: ['modules'],
    section: 'Cofre .env',
    type: 'number',
    min: 3,
    max: 120,
    apply: notifyModules,
  },

  // Módulos Agzos — Agzos Erros na Linha
  {
    key: 'modules.inlineErrors.enabled',
    title: 'Erros na Linha: Habilitado',
    desc: 'Mostra a mensagem de erros e avisos no fim da linha do editor.',
    categories: ['modules'],
    section: 'Agzos Erros na Linha',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.inlineErrors.severities',
    title: 'Erros na Linha: Severidades',
    desc: 'Quais severidades aparecem na linha, separadas por vírgula: error (erro), warning (aviso), info.',
    categories: ['modules'],
    section: 'Agzos Erros na Linha',
    type: 'list',
    apply: notifyModules,
  },
  {
    key: 'modules.inlineErrors.onlyCursorLine',
    title: 'Erros na Linha: Só na linha do cursor',
    desc: 'Mostra a mensagem apenas na linha onde o cursor está.',
    categories: ['modules'],
    section: 'Agzos Erros na Linha',
    type: 'boolean',
    apply: notifyModules,
  },

  // Módulos Agzos — Agzos Erros Claros
  {
    key: 'modules.prettyErrors.enabled',
    title: 'Erros Claros: Habilitado',
    desc: 'Reformata as mensagens do TypeScript/JavaScript no hover e no painel Problemas (tipos quebrados e realçados, link para a documentação do erro).',
    categories: ['modules'],
    section: 'Agzos Erros Claros',
    type: 'boolean',
    apply: notifyModules,
  },

  // Módulos Agzos — Agzos Marca-texto
  {
    key: 'modules.highlighter.enabled',
    title: 'Marca-texto: Habilitado',
    desc: 'Colore comentários que começam com um marcador (!, ?, TODO, FIXME, *, //).',
    categories: ['modules'],
    section: 'Agzos Marca-texto',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.highlighter.tags',
    title: 'Marca-texto: Marcadores e cores',
    desc: 'Lista "marcador=#cor" separada por vírgula (ex.: TODO=#FF9800, NOTE=#00BCD4). O marcador // fica riscado.',
    categories: ['modules'],
    section: 'Agzos Marca-texto',
    type: 'list',
    apply: notifyModules,
  },

  // Módulos Agzos — Agzos Formatador
  {
    key: 'modules.formatter.enabled',
    title: 'Formatador: Habilitado',
    desc: '"Formatar Documento" usa o Prettier embutido (com .prettierrc/.json/.yaml do projeto; configs em código são ignoradas).',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.javascript',
    title: 'Formatador: Formatar ao salvar (JavaScript/JSX)',
    desc: 'Formata arquivos JavaScript/JSX com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.typescript',
    title: 'Formatador: Formatar ao salvar (TypeScript/TSX)',
    desc: 'Formata arquivos TypeScript/TSX com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.json',
    title: 'Formatador: Formatar ao salvar (JSON)',
    desc: 'Formata arquivos JSON com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.css',
    title: 'Formatador: Formatar ao salvar (CSS)',
    desc: 'Formata arquivos CSS com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.scss',
    title: 'Formatador: Formatar ao salvar (SCSS)',
    desc: 'Formata arquivos SCSS com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.less',
    title: 'Formatador: Formatar ao salvar (LESS)',
    desc: 'Formata arquivos LESS com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.html',
    title: 'Formatador: Formatar ao salvar (HTML)',
    desc: 'Formata arquivos HTML com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.markdown',
    title: 'Formatador: Formatar ao salvar (Markdown)',
    desc: 'Formata arquivos Markdown com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },
  {
    key: 'modules.formatter.formatOnSave.yaml',
    title: 'Formatador: Formatar ao salvar (YAML)',
    desc: 'Formata arquivos YAML com o Agzos Formatador ao salvar.',
    categories: ['modules'],
    section: 'Agzos Formatador',
    type: 'boolean',
    apply: notifyModules,
  },

  // Atualizações (OTA)
  {
    key: 'update.autoDownload',
    title: 'Atualizações: Download Automático',
    desc: 'Baixar atualizações automaticamente em segundo plano quando disponíveis.',
    categories: ['update'],
    type: 'boolean',
    apply: () => {},
  },
  {
    key: 'update.channel',
    title: 'Atualizações: Canal de Atualização',
    desc: 'Escolha se deseja receber versões estáveis ou prévias antecipadas.',
    categories: ['update'],
    type: 'select',
    options: [
      { value: 'stable', label: 'Estável (Recomendado)' },
      { value: 'beta', label: 'Beta (Novidades antecipadas)' },
    ],
    apply: () => {},
  },
];

export function setupSettingsModal() {
  let overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'settings-modal-overlay';
    overlay.className = 'overlay settings-overlay';
    overlay.hidden = true;
    document.body.appendChild(overlay);
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSettingsModal();
  });

  window.addEventListener('keydown', (e) => {
    // Só abre (idempotente): no macOS o accelerator CmdOrCtrl+, do menu nativo
    // também dispara menu:open-settings; um toggle aqui abriria e fecharia.
    if (matchShortcut(e) === 'settings.open') {
      e.preventDefault();
      e.stopPropagation();
      openSettingsModal();
    } else if (e.key === 'Escape' && !overlay.hidden) {
      e.preventDefault();
      closeSettingsModal();
    }
  }, true);
}

export function openSettingsModal(category = 'commonlyUsed', { json = false } = {}) {
  const overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) return;
  // Já aberto: não reseta categoria/busca (Ctrl+, e o menu nativo podem chegar juntos)
  if (!overlay.hidden) {
    if (json && !isJsonMode) {
      isJsonMode = true;
      renderModal();
    }
    document.getElementById(isJsonMode ? 'settings-json-textarea' : 'settings-search-input')?.focus();
    return;
  }
  activeCategory = category;
  searchQuery = '';
  isJsonMode = !!json;
  renderModal();
  overlay.hidden = false;
  overlay.classList.add('active');
  setTimeout(() => {
    const searchInput = document.getElementById('settings-search-input');
    if (searchInput) searchInput.focus();
  }, 40);
}

export function closeSettingsModal() {
  const overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  overlay.hidden = true;
}

export function isSettingsModalOpen() {
  const overlay = document.getElementById('settings-modal-overlay');
  return overlay && !overlay.hidden;
}

export function updateOTAProgress(progress) {
  otaProgressData = progress;
  if (isSettingsModalOpen() && activeCategory === 'update') {
    renderContent();
  }
}

function renderModal() {
  const overlay = document.getElementById('settings-modal-overlay');
  if (!overlay) return;

  overlay.innerHTML = `
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div class="settings-header">
        <div class="settings-header-top">
          <div class="settings-header-left">
            <span class="settings-header-icon">${lucideIcon('settings', { size: 18 }).outerHTML}</span>
            <h2 id="settings-modal-title">Configurações</h2>
          </div>
          <div class="settings-search-box">
            <span class="settings-search-icon">${lucideIcon('search', { size: 14 }).outerHTML}</span>
            <input type="text" id="settings-search-input" placeholder="Search settings (ex: font, tabSize, @modified)…" value="${escapeHtml(searchQuery)}" autocomplete="off" spellcheck="false" />
            ${searchQuery ? `<button id="settings-clear-search" class="icon-btn" title="Limpar busca">✕</button>` : ''}
          </div>
          <div class="settings-header-actions">
            <button id="btn-toggle-settings-json" class="settings-tool-btn" title="${isJsonMode ? 'Visualizar Interface (UI)' : 'Abrir settings.json'}">
              ${isJsonMode ? lucideIcon('sliders', { size: 15 }).outerHTML + ' <span>Interface</span>' : '<span>{ } JSON</span>'}
            </button>
            <button id="btn-close-settings-modal" class="settings-close-btn" title="Fechar (Esc)">✕</button>
          </div>
        </div>
        <div class="settings-header-subtabs">
          <button class="settings-subtab active" data-tab="user">Usuário (User)</button>
          <button class="settings-subtab" data-tab="workspace">Espaço de Trabalho (Workspace)</button>
        </div>
      </div>
      <div class="settings-body">
        <aside class="settings-sidebar" id="settings-sidebar">
          <ul class="settings-categories" role="tablist">
            ${CATEGORIES.map((cat) => `
              <li class="settings-category-item ${activeCategory === cat.id && !searchQuery ? 'active' : ''}" data-cat="${cat.id}">
                <span class="settings-cat-chevron">›</span>
                <span>${cat.label}</span>
              </li>
            `).join('')}
          </ul>
        </aside>
        <section class="settings-main" id="settings-main">
          ${renderContentHtml()}
        </section>
      </div>
    </div>
  `;

  bindModalEvents();
}

function renderContent() {
  const main = document.getElementById('settings-main');
  if (main) main.innerHTML = renderContentHtml();
  bindContentEvents();
}

function renderContentHtml() {
  if (isJsonMode) {
    return `
      <div class="settings-json-view">
        <div class="settings-json-banner">
          <span>Edite as preferências diretamente em formato JSON. Elas serão salvas em <code>settings.json</code>.</span>
          <button class="primary-btn" id="btn-save-settings-json">Salvar Alterações</button>
        </div>
        <textarea id="settings-json-textarea" spellcheck="false">${escapeHtml(JSON.stringify(State.settings, null, 2))}</textarea>
      </div>
    `;
  }

  // Filtragem
  let items = SETTINGS_DEF;
  const isSearchModified = searchQuery.trim().toLowerCase() === '@modified';
  const query = searchQuery.trim().toLowerCase();

  if (isSearchModified) {
    items = items.filter((item) => isModified(item.key));
  } else if (query) {
    items = items.filter((item) =>
      item.title.toLowerCase().includes(query) ||
      item.desc.toLowerCase().includes(query) ||
      item.key.toLowerCase().includes(query)
    );
  } else {
    items = items.filter((item) => item.categories.includes(activeCategory));
  }

  // Seções especiais extras para IA, Git, OTA e Privacidade quando na aba específica ou sem busca restrita
  let extraHtml = '';
  if (!query && activeCategory === 'ai') {
    extraHtml = renderAIExtraHtml();
  } else if (!query && activeCategory === 'git') {
    extraHtml = renderGitExtraHtml();
  } else if (!query && activeCategory === 'update') {
    extraHtml = renderUpdateExtraHtml();
  } else if (!query && activeCategory === 'privacy') {
    extraHtml = renderPrivacyExtraHtml();
  }

  if (items.length === 0 && !extraHtml) {
    return `
      <div class="settings-empty">
        <p>Nenhuma configuração encontrada para "<strong>${escapeHtml(searchQuery)}</strong>".</p>
        ${query ? `<button class="secondary-btn" id="btn-reset-search">Limpar busca</button>` : ''}
      </div>
    `;
  }

  const activeCatObj = CATEGORIES.find((c) => c.id === activeCategory);
  const categoryHeading = query
    ? (isSearchModified ? 'Configurações Modificadas (@modified)' : `Resultados da busca por "${escapeHtml(searchQuery)}"`)
    : (activeCatObj?.label || 'Configurações');

  return `
    <div class="settings-category-header">
      <h2 class="settings-category-title">${categoryHeading}</h2>
    </div>
    <div class="settings-items-list">
      ${renderItemsWithSections(items, !query)}
      ${extraHtml}
    </div>
  `;
}

/** Itens agrupados por `section` (subseções da categoria); na busca, lista corrida. */
function renderItemsWithSections(items, withSections) {
  let current = null;
  return items.map((item) => {
    let head = '';
    if (withSections && item.section && item.section !== current) {
      current = item.section;
      head = `<h3 class="settings-subsection-title">${escapeHtml(item.section)}</h3>`;
    }
    return head + renderSettingItemHtml(item);
  }).join('');
}

/** "error, warn" → ['error', 'warn'] */
function parseListInput(text) {
  return String(text || '').split(',').map((t) => t.trim()).filter(Boolean);
}

function renderSettingItemHtml(item) {
  const currentVal = getNestedValue(State.settings, item.key);
  const modified = isModified(item.key);

  let controlHtml = '';
  if (item.type === 'select') {
    controlHtml = `
      <select class="settings-control-select" data-key="${item.key}">
        ${item.options.map((opt) => `
          <option value="${opt.value}" ${String(currentVal) === String(opt.value) ? 'selected' : ''}>${opt.label}</option>
        `).join('')}
      </select>
    `;
  } else if (item.type === 'number') {
    controlHtml = `
      <input type="number" class="settings-control-input" data-key="${item.key}" min="${item.min ?? 0}" max="${item.max ?? 9999}" value="${escapeHtml(String(currentVal ?? ''))}" />
    `;
  } else if (item.type === 'list') {
    controlHtml = `
      <input type="text" class="settings-control-list" data-key="${item.key}" value="${escapeHtml((Array.isArray(currentVal) ? currentVal : []).join(', '))}" />
    `;
  } else if (item.type === 'text') {
    controlHtml = `
      <input type="text" class="settings-control-input" data-key="${item.key}" value="${escapeHtml(String(currentVal || ''))}" />
    `;
  } else if (item.type === 'boolean') {
    controlHtml = `
      <label class="settings-checkbox-wrap">
        <input type="checkbox" class="settings-control-checkbox" data-key="${item.key}" ${currentVal ? 'checked' : ''} />
        <span class="settings-checkbox-label-text">${item.desc}</span>
      </label>
    `;
  }

  return `
    <div class="setting-item-row ${modified ? 'modified' : ''}" data-key="${item.key}">
      <div class="setting-item-info">
        <div class="setting-item-title-row">
          <strong class="setting-item-title">${item.title}</strong>
          <span class="setting-item-key">(${item.key})</span>
          ${modified ? `<button class="setting-reset-btn" data-reset-key="${item.key}" title="Restaurar valor padrão">↺ Restaurar padrão</button>` : ''}
        </div>
        ${item.type !== 'boolean' ? `<p class="setting-item-desc">${item.desc}</p>` : ''}
      </div>
      <div class="setting-item-control">
        ${controlHtml}
      </div>
    </div>
  `;
}

function renderAIExtraHtml() {
  const ai = State.settings.ai || {};
  const profiles = ai.profiles || [];
  const activeProfile = profiles.find((p) => p.id === ai.activeProfileId);

  return `
    <div class="settings-section-card">
      <h3 class="settings-section-title">Perfis de IA Configurados</h3>
      <p class="setting-item-desc">Gerencie suas conexões com provedores de inteligência artificial (OpenAI, Anthropic, Groq, Ollama, etc.). Suas chaves ficam protegidas no cofre do SO.</p>
      <div class="ai-profiles-overview">
        <div class="ai-profile-current">
          <span>Perfil Ativo: <strong>${activeProfile ? (activeProfile.model || activeProfile.label) : 'Nenhum'}</strong></span>
        </div>
        <div class="ai-profiles-actions">
          <button class="primary-btn" id="btn-settings-open-ai-wizard">+ Configurar Novo Provider</button>
        </div>
      </div>
    </div>
    <div class="settings-section-card">
      <h3 class="settings-section-title">Skills (modos do Agzos IA)</h3>
      <div id="ai-skills-host"></div>
    </div>
  `;
}

function renderGitExtraHtml() {
  // Conteúdo montado por github-settings.js (bindContentEvents → mountGithubSettings)
  return `
    <div class="settings-section-card" id="github-settings-card">
      <h3 class="settings-section-title">Contas GitHub</h3>
      <p class="setting-item-desc">Conecte contas pessoais ou de organizações. Cada repositório usa a conta do dono, a escolhida para ele ou a padrão.</p>
      <div id="github-settings-host"></div>
    </div>
  `;
}

function renderUpdateExtraHtml() {
  const percent = otaProgressData ? Math.round(otaProgressData.percent) : null;

  return `
    <div class="settings-section-card">
      <h3 class="settings-section-title">Atualização Over-The-Air (OTA Multiplataforma)</h3>
      <p class="setting-item-desc">O Agzos Code consulta e baixa atualizações diretamente de <code>https://code.rsolutionsbr.com/release/</code>.</p>

      <div class="ota-status-panel">
        <div class="ota-info-line">
          <span>Versão instalada: <strong>v${escapeHtml(State.appVersion || '0.3.0')}</strong></span>
          <span>Plataforma: <strong>${escapeHtml(State.platform || 'linux')}</strong></span>
        </div>

        ${percent != null && percent < 100 ? `
          <div class="ota-progress-container">
            <div class="ota-progress-bar" style="width: ${percent}%"></div>
            <span class="ota-progress-text">Baixando atualização: ${percent}%</span>
          </div>
        ` : ''}

        <div class="ota-actions-row">
          <button class="primary-btn" id="btn-check-updates-now">
            ${lucideIcon('refresh-cw', { size: 14 }).outerHTML} Verificar Atualizações Agora
          </button>
          <button class="secondary-btn" id="btn-import-vscode-now">
            ${lucideIcon('download', { size: 14 }).outerHTML} Importar Configurações do VS Code
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPrivacyExtraHtml() {
  return `
    <div class="settings-section-card">
      <h3 class="settings-section-title">Privacidade e Armazenamento Local</h3>
      <p class="setting-item-desc">
        O Agzos Code respeita sua privacidade: não coletamos nem enviamos telemetria em segundo plano.
        Suas chaves de API de IA e tokens do GitHub permanecem criptografados no cofre nativo do seu sistema operacional.
      </p>
      <div class="settings-danger-zone">
        <h4>Zona de Manutenção</h4>
        <div class="danger-zone-actions">
          <button class="secondary-btn" id="btn-restart-onboarding-modal">Refazer Onboarding Inicial</button>
          <button class="danger-btn" id="btn-reset-all-settings">Restaurar Todas as Configurações de Fábrica</button>
        </div>
      </div>
    </div>
  `;
}

function bindModalEvents() {
  // Busca
  const searchInput = document.getElementById('settings-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderContent();
      const clearBtn = document.getElementById('settings-clear-search');
      if (clearBtn) clearBtn.hidden = !searchQuery;
    });
  }

  const clearBtn = document.getElementById('settings-clear-search');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      renderContent();
    });
  }

  // Alternar JSON
  const btnToggleJson = document.getElementById('btn-toggle-settings-json');
  if (btnToggleJson) {
    btnToggleJson.addEventListener('click', () => {
      isJsonMode = !isJsonMode;
      renderModal();
    });
  }

  // Fechar
  const btnClose = document.getElementById('btn-close-settings-modal');
  if (btnClose) btnClose.addEventListener('click', closeSettingsModal);

  // Categorias da Sidebar
  document.querySelectorAll('.settings-category-item').forEach((item) => {
    item.addEventListener('click', () => {
      activeCategory = item.dataset.cat;
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      document.querySelectorAll('.settings-category-item').forEach((i) => i.classList.remove('active'));
      item.classList.add('active');
      renderContent();
    });
  });

  bindContentEvents();
}

function bindContentEvents() {
  // Git & GitHub: contas montadas por github-settings.js
  const githubHost = document.getElementById('github-settings-host');
  if (githubHost) import('./github-settings.js').then((m) => m.mountGithubSettings(githubHost));

  // Limpar busca no botão vazio
  const resetSearch = document.getElementById('btn-reset-search');
  if (resetSearch) {
    resetSearch.addEventListener('click', () => {
      searchQuery = '';
      const input = document.getElementById('settings-search-input');
      if (input) input.value = '';
      renderContent();
    });
  }

  // Mudanças nos controles
  document.querySelectorAll('.settings-control-select').forEach((sel) => {
    sel.addEventListener('change', async (e) => {
      const key = e.target.dataset.key;
      const val = e.target.value;
      await updateSetting(key, val);
    });
  });

  document.querySelectorAll('.settings-control-input').forEach((inp) => {
    inp.addEventListener('change', async (e) => {
      const key = e.target.dataset.key;
      let val = e.target.value;
      if (inp.type === 'number') {
        const def = SETTINGS_DEF.find((d) => d.key === key);
        val = clampNumber(val, def?.min, def?.max);
        if (val === null) {
          // Vazio/inválido: ignora e volta ao valor atual
          e.target.value = String(getNestedValue(State.settings, key) ?? '');
          return;
        }
      }
      await updateSetting(key, val);
    });
  });

  document.querySelectorAll('.settings-control-list').forEach((inp) => {
    inp.addEventListener('change', async (e) => {
      await updateSetting(e.target.dataset.key, parseListInput(e.target.value));
    });
  });

  document.querySelectorAll('.settings-control-checkbox').forEach((chk) => {
    chk.addEventListener('change', async (e) => {
      const key = e.target.dataset.key;
      await updateSetting(key, e.target.checked);
    });
  });

  // Botões de reset individual
  document.querySelectorAll('.setting-reset-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const key = e.target.dataset.resetKey;
      const defVal = getNestedValue(DEFAULTS, key);
      await updateSetting(key, defVal);
    });
  });

  // Agzos IA: skills (modos) e visão do perfil
  const skillsHost = document.getElementById('ai-skills-host');
  if (skillsHost) import('./ai-skills-settings.js').then((m) => m.mountSkillsSettings(skillsHost));

  // Ações especiais
  const btnAIWizard = document.getElementById('btn-settings-open-ai-wizard');
  if (btnAIWizard) {
    btnAIWizard.addEventListener('click', async () => {
      closeSettingsModal();
      const { openAIWizard } = await import('./ai-wizard.js');
      await openAIWizard({ profileId: State.settings.ai?.activeProfileId });
    });
  }

  const btnCheckUpdates = document.getElementById('btn-check-updates-now');
  if (btnCheckUpdates) {
    btnCheckUpdates.addEventListener('click', async () => {
      btnCheckUpdates.disabled = true;
      btnCheckUpdates.textContent = 'Verificando atualizações…';
      try {
        await window.agzos.update.check();
      } catch (err) {
        toast(`Falha ao verificar: ${err.message}`, 'error');
      } finally {
        setTimeout(() => {
          btnCheckUpdates.disabled = false;
          btnCheckUpdates.innerHTML = `${lucideIcon('refresh-cw', { size: 14 }).outerHTML} Verificar Atualizações Agora`;
        }, 1500);
      }
    });
  }

  const btnImportVSCode = document.getElementById('btn-import-vscode-now');
  if (btnImportVSCode) {
    btnImportVSCode.addEventListener('click', async () => {
      try {
        // IPC devolve { ok, imported: string[], path } ou { ok: false, reason, … }
        const res = await window.agzos.settings.importVSCode?.();
        if (res?.ok) {
          const s = await window.agzos.settings.load();
          Object.assign(State.settings, s);
          await applySettingsLive();
          const n = res.imported?.length || 0;
          toast(n ? `Configurações importadas com sucesso: ${res.imported.join(', ')}` : 'Nenhuma configuração compatível encontrada no VS Code.', n ? 'success' : 'info', 3500);
          renderContent();
        } else {
          toast('Nenhuma configuração do VS Code foi encontrada neste sistema.', 'info', 3000);
        }
      } catch (e) {
        toast(`Erro na importação: ${e.message}`, 'error');
      }
    });
  }

  const btnRestartOnboarding = document.getElementById('btn-restart-onboarding-modal');
  if (btnRestartOnboarding) {
    btnRestartOnboarding.addEventListener('click', async () => {
      closeSettingsModal();
      const { startOnboarding } = await import('./onboarding.js');
      State.onboardingForced = true;
      startOnboarding();
    });
  }

  const btnResetAll = document.getElementById('btn-reset-all-settings');
  if (btnResetAll) {
    btnResetAll.addEventListener('click', async () => {
      if (confirm('Tem certeza que deseja restaurar todas as configurações para o padrão original?')) {
        // Só as chaves deste modal: preserva perfis de IA, contas GitHub, onboarding, recentes…
        const next = resetModalOwnedSettings(State.settings, DEFAULTS);
        Object.assign(State.settings, next);
        await window.agzos.settings.save(State.settings);
        await applySettingsLive();
        toast('Todas as configurações foram restauradas.', 'success', 2500);
        renderContent();
      }
    });
  }

  // Salvar JSON
  const btnSaveJson = document.getElementById('btn-save-settings-json');
  if (btnSaveJson) {
    btnSaveJson.addEventListener('click', async () => {
      const ta = document.getElementById('settings-json-textarea');
      if (!ta) return;
      try {
        const parsed = JSON.parse(ta.value);
        State.settings = parsed;
        await window.agzos.settings.save(State.settings);
        applyTheme(State.settings.theme || 'agzos-dark');
        applyFontSize(State.settings.fontSize || 14);
        applyEditorSettings(State.settings.editor || {});
        notifyAiPanel();
        toast('settings.json salvo com sucesso!', 'success', 2000);
        isJsonMode = false;
        renderModal();
      } catch (e) {
        toast(`JSON inválido: ${e.message}`, 'error', 4000);
      }
    });
  }
}

/**
 * Aplica ao vivo as configurações atuais de State.settings (tema, ícones,
 * performance, editor, terminal). Usado após importar do VS Code e no reset.
 */
export async function applySettingsLive() {
  const s = State.settings;
  const theme = s.theme || DEFAULTS.theme;
  applyTheme(theme);
  document.body.className = document.body.className.replace(/theme-[\w-]+/g, '').trim() + ` theme-${theme}`;
  for (const key of ['performanceMode', 'iconTheme']) {
    const def = SETTINGS_DEF.find((d) => d.key === key);
    try { await def?.apply(s[key]); } catch (e) { console.warn(`[settings] erro ao aplicar ${key}:`, e); }
  }
  applyEditorSettings(s.editor || {});
  const termSize = Number(s.terminal?.fontSize);
  if (Number.isFinite(termSize)) applyTerminalFontSize(termSize);
  const aiPosition = s.aiPanel?.position;
  if (aiPosition && window.AgzosAiDock?.getPosition?.() !== aiPosition) window.AgzosAiDock?.setPosition?.(aiPosition);
  notifyAiPanel();
}

async function updateSetting(key, val) {
  setNestedValue(State.settings, key, val);
  await window.agzos.settings.save(State.settings);

  // Aplica efeito imediato se houver definição
  const def = SETTINGS_DEF.find((d) => d.key === key);
  if (def && typeof def.apply === 'function') {
    try {
      def.apply(val);
    } catch (e) {
      console.warn(`[settings] erro ao aplicar ${key}:`, e);
    }
  }

  renderContent();
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
