# Fase 1 — Fundação: Plano de Implementação

> **Para o executor:** leia antes o [guia do executor](00-guia-do-executor.md). Execute tarefa a tarefa, na ordem. Passos com checkbox (`- [ ]`).

**Objetivo:** base segura e testável para as próximas fases: lint, testes unitários e E2E, `main.js` dividido em módulos, secrets fora do `settings.json`, acesso a arquivos restrito e bugs do onboarding corrigidos.

**Arquitetura:** o `main.js` vira só ciclo de vida, janelas e menu. Cada grupo de IPC vai para `src/main/ipc/<grupo>.js`, exportando `register(ipcMain, deps)`. A lógica pura vai para `src/main/lib/`, testada com `node --test`. O E2E usa Playwright `_electron` com `userData` isolado por teste.

**Stack:** Electron 32, Node 22, ESLint 9 (flat config), Playwright 1.x, `node:test`.

**Branch:** `feat/fase-1-fundacao`

## Restrições globais

- Sem bundler, sem TypeScript.
- Dependências novas desta fase: `eslint@^9`, `@eslint/js@^9`, `globals@^15`, `@playwright/test@^1.47` (todas dev).
- `settings.json` não pode conter `aiApiKey` nem token GitHub após esta fase.
- Textos de UI em pt-BR.

## Foco de revisão

1. `settings.json` corrompido ou de versão antiga (com `aiApiKey`) → o app abre, migra a chave para o secret store e remove o campo.
2. `safeStorage` indisponível (Linux sem keyring) → o app abre e salvar secret mostra erro claro, sem gravar em texto puro.
3. Caminho fora da pasta aberta (`../`, `/etc/passwd`, prefixo `/proj` vs `/proj-x`) → IPC rejeita com `Acesso negado`.
4. Fechar a janela com terminal rodando → sem exceção "Object has been destroyed" no main.
5. Usuário conclui o onboarding sem tocar em nada → tema padrão salvo e aplicado.

---

### Tarefa 1: Lint e testes unitários

**Arquivos:**
- Criar: `eslint.config.js`, `test/unit/smoke.test.js`
- Modificar: `package.json` (scripts e devDependencies)

**Interfaces:**
- Produz: scripts `lint`, `test:unit`, `check`.

- [ ] **Passo 1:** instalar `npm i -D eslint@^9 @eslint/js@^9 globals@^15`.
- [ ] **Passo 2:** criar `eslint.config.js` (flat config):
  - ignorar `src/renderer/vendor/**`, `node_modules/**`, `dist/**`;
  - `src/main/**`, `tools/**`, `test/**`, `eslint.config.js`, `playwright.config.js`: `globals.node`, `sourceType: 'commonjs'` (exceto `test/e2e/**`, que é CommonJS também);
  - `src/renderer/**`: `globals.browser`, `sourceType: 'module'`; `src/renderer/scripts/state.js` com `sourceType: 'script'`;
  - regras: `js.configs.recommended`; `no-unused-vars` como `warn` com `argsIgnorePattern: '^_'`; `no-empty` com `allowEmptyCatch: true`.
- [ ] **Passo 3:** scripts no `package.json`:
  - `"lint": "eslint ."`
  - `"test:unit": "node --test \"test/unit/**/*.test.js\""`
  - `"check": "npm run lint && npm run test:unit"`
- [ ] **Passo 4:** `test/unit/smoke.test.js` com um teste `node:test` que faz `assert.ok(true)`.
- [ ] **Passo 5:** `npm run check`. Esperado: 0 erros (warnings são aceitos). Se houver **erros** no código existente, corrija só o mínimo para passar (ex.: variável indefinida). Liste cada correção na mensagem do commit.
- [ ] **Passo 6:** commit `chore: eslint e testes unitários com node:test`.

---

### Tarefa 2: E2E com Playwright e userData isolado

**Arquivos:**
- Criar: `playwright.config.js`, `test/e2e/helpers.js`, `test/e2e/boot.spec.js`
- Modificar: `src/main/main.js` (linha do `app.setPath('userData', …)`), `package.json`

**Interfaces:**
- Produz:
  - env `AGZOS_USER_DATA`: se definida, vira o `userData` do app.
  - env `AGZOS_TEST=1`: habilita ganchos de teste no main (Tarefa 6).
  - `test/e2e/helpers.js`:
    - `launchApp({ userData?: string, settings?: object }) → Promise<{ app: ElectronApplication, page: Page, userData: string, errors: string[] }>` — cria `userData` temporário se não vier, grava `settings.json` se `settings` vier, lança com `args: ['.']` (+ `--no-sandbox` se Linux e root), `env: { ...process.env, AGZOS_USER_DATA, AGZOS_TEST: '1' }`, espera a janela cuja URL termina em `renderer/index.html`, espera `#topbar`, coleta `pageerror` em `errors`.
    - `readSettings(userData) → object`.
    - `completeOnboarding(page) → Promise<void>` — clica `.welcome-primary`, depois `.onb-primary` até `#onboarding-overlay` perder `.active` (máx. 10 cliques).

- [ ] **Passo 1:** `npm i -D @playwright/test@^1.47`. Script `"test:e2e": "playwright test"`.
- [ ] **Passo 2:** `playwright.config.js`: `testDir: 'test/e2e'`, `workers: 1`, `timeout: 30000`, `retries: 0`.
- [ ] **Passo 3:** em `main.js`, `userData` = `process.env.AGZOS_USER_DATA || path.join(app.getPath('appData'), DATA_DIR)`.
- [ ] **Passo 4:** escrever `test/e2e/boot.spec.js`:
  - `primeira execução mostra welcome e conclui onboarding`: `#welcome-popup.active` visível; `completeOnboarding`; `readSettings` → `welcomeSeen === true`, `onboardingCompleted === true`; `errors` vazio.
  - `segunda execução não mostra overlays`: `launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true } })`; `#welcome-popup.active` e `#onboarding-overlay.active` com contagem 0; `.monaco-editor` visível.
- [ ] **Passo 5:** `npm run test:e2e` (Linux sem display: `xvfb-run -a npm run test:e2e`). Esperado: 2 passed.
- [ ] **Passo 6:** commit `test: e2e de boot e onboarding com Playwright`.

---

### Tarefa 3: Dividir `main.js` em módulos de IPC (sem mudar comportamento)

**Arquivos:**
- Criar: `src/main/ipc/fs.js`, `src/main/ipc/dialog.js`, `src/main/ipc/term.js`, `src/main/ipc/settings.js`, `src/main/ipc/app-info.js`
- Modificar: `src/main/main.js`

**Interfaces:**
- Produz: cada módulo exporta `register(ipcMain, deps)`. `deps` = `{ app, shell, dialog, getMainWindow: () => BrowserWindow | null, isDev }` (cada módulo usa só o que precisa).
- Os canais IPC continuam **idênticos**: `fs:*`, `dialog:*`, `term:*`, `settings:*`, `app:info`, `app:openExternal`.

- [ ] **Passo 1:** mover cada bloco `ipcMain.handle` de `main.js` para o módulo do grupo, sem alterar a lógica.
- [ ] **Passo 2:** em `term.js`, exportar também `killAll()` (usado em `window-all-closed`).
- [ ] **Passo 3:** no `main.js`, chamar `require('./ipc/<grupo>').register(ipcMain, deps)` para cada grupo.
- [ ] **Passo 4:** `npm run check && npm run test:e2e`. Esperado: tudo verde.
- [ ] **Passo 5:** commit `refactor(main): separa handlers IPC em módulos`.

---

### Tarefa 4: Módulo de settings com defaults e tolerância a erro

**Arquivos:**
- Criar: `src/main/lib/settings.js`, `test/unit/settings.test.js`
- Modificar: `src/main/ipc/settings.js`

**Interfaces:**
- Produz (`src/main/lib/settings.js`):
  - `DEFAULT_SETTINGS` — objeto com: `theme: 'agzos-dark'`, `performanceMode: 'balanced'`, `telemetry: false`, `fontSize: 14`, `recentFolders: []`, `welcomeSeen: false`, `onboardingCompleted: false`, `onboardingSkipped: false`, `onboardingAnswers: null`, `ai: { activeProfileId: null, profiles: [] }`, `github: { accounts: [], repoAccounts: {} }`.
  - `loadSettings(filePath) → object`: `{ ...DEFAULT_SETTINGS, ...arquivo }`. Arquivo ausente → defaults. JSON inválido → renomeia para `settings.json.corrupt-<timestamp>` e retorna defaults.
  - `saveSettings(filePath, settings) → boolean`: escrita atômica (grava `<arquivo>.tmp` e faz `rename`).

- [ ] **Passo 1:** testes em `test/unit/settings.test.js` (use `fs.mkdtempSync(os.tmpdir())`):
  - `arquivo ausente retorna defaults` → `deepEqual(loadSettings(p), DEFAULT_SETTINGS)`;
  - `mescla arquivo com defaults` → arquivo `{ fontSize: 18 }` → `fontSize === 18` e `theme === 'agzos-dark'`;
  - `JSON inválido vira backup e retorna defaults` → existe arquivo `settings.json.corrupt-*`;
  - `saveSettings grava e loadSettings lê de volta`.
- [ ] **Passo 2:** `npm run test:unit` → FAIL (módulo não existe).
- [ ] **Passo 3:** implementar. Trocar `loadSettings`/`saveSettings` antigos de `ipc/settings.js` por este módulo.
- [ ] **Passo 4:** `npm run check && npm run test:e2e` → verde.
- [ ] **Passo 5:** commit `feat(settings): defaults, backup de JSON corrompido e escrita atômica`.

---

### Tarefa 5: Secret store com `safeStorage` + migração

**Arquivos:**
- Criar: `src/main/lib/secrets.js`, `src/main/ipc/secrets.js`, `test/unit/secrets.test.js`, `test/unit/migrate-secrets.test.js`
- Modificar: `src/main/main.js`, `src/main/preload.js`, `src/main/lib/settings.js`, `src/renderer/scripts/app.js` (campo API key), `src/renderer/scripts/onboarding.js` (`renderGithubStep`)

**Interfaces:**
- Produz:
  - `createSecretStore({ filePath, safeStorage }) → { isAvailable(): boolean, set(key: string, value: string): void, get(key: string): string | null, delete(key: string): void, has(key: string): boolean }`.
    Arquivo `secrets.json` = `{ [key]: base64(safeStorage.encryptString(value)) }`. `set` lança `Error('Cofre do sistema indisponível')` se `!safeStorage.isEncryptionAvailable()`. Nunca grava texto puro.
  - `migrateLegacySecrets(settings, store) → { settings: object, changed: boolean }` em `src/main/lib/settings.js`:
    - `settings.aiApiKey` não vazio → `store.set('ai.legacy', valor)`; remove `aiApiKey`.
    - `settings.onboardingAnswers?.github?.token` → `store.set('github.onboarding', token)`; deixa `github: { type: 'pat' }`.
  - IPC (`ipc/secrets.js`): `secrets:set(key, value)`, `secrets:delete(key)`, `secrets:has(key)`. **Não existe `secrets:get` no IPC.**
  - Preload: `agzos.secrets.set/delete/has`.
  - Chaves usadas no projeto: `ai.<profileId>`, `ai.legacy`, `github.<accountId>`, `github.onboarding`.

- [ ] **Passo 1:** testes de `secrets.test.js` com `safeStorage` falso (`encryptString: s => Buffer.from('enc:' + s)`, `decryptString: b => b.toString().slice(4)`, `isEncryptionAvailable: () => true`):
  - `set/get/has/delete`;
  - `arquivo não contém o valor em texto puro` (ler o arquivo e `assert.ok(!conteudo.includes('sk-123'))`);
  - `set lança quando cofre indisponível` (`isEncryptionAvailable: () => false`).
- [ ] **Passo 2:** testes de `migrate-secrets.test.js`: settings com `aiApiKey: 'sk-1'` e `onboardingAnswers.github.token: 'ghp_1'` → `store.get('ai.legacy') === 'sk-1'`, `store.get('github.onboarding') === 'ghp_1'`, `settings.aiApiKey === undefined`, `settings.onboardingAnswers.github` deep-equal `{ type: 'pat' }`, `changed === true`.
- [ ] **Passo 3:** rodar → FAIL. Implementar.
- [ ] **Passo 4:** no `main.js`, após `app.whenReady()`: criar o store (`filePath: <userData>/secrets.json`, `safeStorage` do Electron), rodar `migrateLegacySecrets` e salvar settings se `changed`.
- [ ] **Passo 5:** renderer:
  - campo `#setting-ai-key` em `app.js`: no `change`, chama `agzos.secrets.set('ai.legacy', valor)`; nunca preenche o input com a chave (placeholder `•••• salva` quando `has('ai.legacy')`); remove `aiApiKey` do `State.settings`;
  - `renderGithubStep`: token vai para `agzos.secrets.set('github.onboarding', token)`; `answers.github = { type: 'pat' }`;
  - erro de `set` → `toast(mensagem, 'error')`.
- [ ] **Passo 6:** E2E novo em `test/e2e/boot.spec.js`: `migra aiApiKey antigo para o cofre` → `launchApp({ settings: { welcomeSeen: true, onboardingCompleted: true, aiApiKey: 'sk-teste' } })` → `readSettings` sem `aiApiKey`; `secrets.json` existe e não contém `sk-teste`.
  Linux CI sem keyring: lance com `--password-store=basic` (adicionar em `launchApp` só no Linux).
- [ ] **Passo 7:** `npm run check && npm run test:e2e` → verde.
- [ ] **Passo 8:** commit `feat(security): secrets no cofre do SO e migração de chaves antigas`.

---

### Tarefa 6: Restringir acesso a arquivos à pasta aberta

**Arquivos:**
- Criar: `src/main/lib/path-guard.js`, `test/unit/path-guard.test.js`
- Modificar: `src/main/ipc/fs.js`, `src/main/ipc/dialog.js`, `src/main/main.js`, `src/main/preload.js`, `src/renderer/scripts/file-tree.js` (`openWorkspace`)

**Interfaces:**
- Produz:
  - `createPathGuard({ platform = process.platform } = {}) → { allow(p: string): void, isAllowed(p: string): boolean, assertAllowed(p: string): string, roots(): string[] }`.
    `assertAllowed` retorna o caminho resolvido ou lança `Error('Acesso negado: <p>')`. Resolve com `path.resolve` + `fs.realpathSync.native` (se o arquivo não existe, resolve o diretório pai). Comparação com separador no fim (`/proj` não libera `/proj-x`). Case-insensitive em `win32`.
  - IPC `workspace:open(path)`: aceita só se o caminho estiver em `settings.recentFolders` ou já liberado; chama `allow`. Retorna `boolean`.
  - `dialog:openFolder` → `allow(pasta)`; `dialog:openFile` e `dialog:saveFile` → `allow(arquivo)`.
  - Guard aplicado em `fs:readDir`, `fs:readFile`, `fs:writeFile`, `fs:mkdir`, `fs:delete`, `fs:rename` (os dois caminhos). `fs:exists` e `fs:stat` **sem** guard.
  - Com `AGZOS_TEST=1`: `global.__agzosAllowRoot = (p) => guard.allow(p)` (para o E2E).
  - Preload: `agzos.workspace.open(p)`.

- [ ] **Passo 1:** testes `path-guard.test.js` (com diretórios temporários reais):
  - `libera arquivo dentro da raiz`;
  - `bloqueia ../ que sai da raiz`;
  - `bloqueia prefixo parecido` (`/tmp/x/proj` liberado, `/tmp/x/proj-x/a` bloqueado);
  - `bloqueia symlink dentro da raiz que aponta para fora` (pule no Windows);
  - `aceita arquivo novo (inexistente) dentro da raiz`;
  - `win32 compara sem diferenciar maiúsculas` (`platform: 'win32'`, testar só `isAllowed` com caminhos fictícios que não dependam de realpath — se precisar, aceite parâmetro `realpath` injetável).
- [ ] **Passo 2:** FAIL → implementar → PASS.
- [ ] **Passo 3:** ligar o guard nos IPCs. Em `file-tree.js`, `openWorkspace(p)` chama `agzos.workspace.open(p)` antes de ler; se `false`, `toast('Abra a pasta pelo diálogo.', 'error')`.
- [ ] **Passo 4:** E2E `fs fora da workspace é negado`: após boot, `page.evaluate(() => window.agzos.fs.readFile('/etc/hosts').then(() => 'ok', e => e.message))` contém `Acesso negado` (no Windows, use `C:\\Windows\\win.ini`).
- [ ] **Passo 5:** `npm run check && npm run test:e2e` → verde.
- [ ] **Passo 6:** commit `feat(security): restringe IPC de arquivos à pasta aberta`.

---

### Tarefa 7: Bugs da Fase 0

**Arquivos:**
- Modificar: `src/renderer/scripts/onboarding.js`, `src/renderer/scripts/app.js`, `src/renderer/scripts/command-palette.js`, `src/renderer/scripts/welcome.js`, `src/renderer/index.html`, `src/renderer/styles/app.css`, `src/main/ipc/term.js`
- Teste: `test/e2e/boot.spec.js`, `test/e2e/onboarding.spec.js`

**Interfaces:**
- Criar: `src/renderer/scripts/labels.js` (ESM, porque `state.js` é script clássico).
- Produz: `perfLabel(mode: 'economy'|'balanced'|'high') → string`, com os rótulos `Economia`, `Balanceado` e `Alta performance`.

Bugs:
- (a) Tema padrão não é salvo: em `renderThemeStep`, se `answers.theme` vazio, inicializar com `current`.
- (b) Respostas aplicadas: em `exitOnboarding({ completed: true })`, `State.settings.theme = answers.theme` quando definido, aplicar ao body e ao Monaco (`applyTheme`), salvar.
- (c) Tela de boas-vindas do editor some: `setupEditor()` limpa `#editor-host`, que contém `#welcome`. Mover `#welcome` para fora de `#editor-host` (irmão, dentro de `#editor-area`), posicionado por cima (`position:absolute; inset` da área do editor). Visível quando `State.files.size === 0`; escondido ao abrir arquivo, reexibido ao fechar a última aba.
- (d) Status bar mostra `balanced`: usar `perfLabel` em `app.js` (2 lugares) e em `command-palette.js` (`setPerf`).
- (e) `ipc/term.js`: antes de `evt.sender.send(...)`, checar `!evt.sender.isDestroyed()`.

- [ ] **Passo 1:** E2E (`test/e2e/onboarding.spec.js`):
  - `concluir sem escolher tema salva agzos-dark` → `readSettings().onboardingAnswers.theme === 'agzos-dark'`;
  - `escolher Agzos Light aplica e persiste` → clicar no card com texto `Agzos Light` no passo de tema, concluir, `body` tem classe `theme-agzos-light`, `readSettings().theme === 'agzos-light'`;
  - `tela de boas-vindas do editor aparece e some ao abrir arquivo` → após onboarding, `#welcome` visível; criar arquivo temporário, `app.evaluate` com `__agzosAllowRoot(dir)`, `page.evaluate(p => window.AgzosEditor.openFile(p), arquivo)`, `#welcome` oculto;
  - `status bar em português` → `#status-perf` com texto `Balanceado`.
- [ ] **Passo 2:** `npm run test:e2e` → os 4 falham.
- [ ] **Passo 3:** corrigir (a)–(e).
- [ ] **Passo 4:** `npm run check && npm run test:e2e` → verde.
- [ ] **Passo 5:** commit `fix: onboarding persiste tema, boas-vindas do editor e rótulos em pt-BR`.

---

### Tarefa 8: CI no GitHub Actions

**Arquivos:**
- Criar: `.github/workflows/ci.yml`

- [ ] **Passo 1:** workflow `CI`, `on: [push, pull_request]`, job `test` em `ubuntu-latest`:
  `actions/checkout@v4` → `actions/setup-node@v4` (`node-version: 22`, `cache: npm`) → `npm ci` → `npm run check` → `xvfb-run -a npm run test:e2e`. Não precisa de `npx playwright install` (o Playwright usa o Electron do projeto).
- [ ] **Passo 2:** push da branch; conferir no GitHub que o workflow passou (`gh run watch`).
- [ ] **Passo 3:** commit `ci: lint, unit e e2e no GitHub Actions`.

---

### Tarefa 9: Documentação da fase

**Arquivos:**
- Modificar: `docs/tecnico/arquitetura.md` (novos módulos, secrets, path guard, testes), `README.md` (seção Testes com `check`, `test:e2e`), `docs/plano/ROADMAP.md` (marcar Fase 1)

- [ ] **Passo 1:** atualizar os 3 arquivos.
- [ ] **Passo 2:** commit `docs: fase 1 — fundação`.
- [ ] **Passo 3:** gerar o relatório `docs/plano/relatorios/fase-1-relatorio.md` (modelo no guia do executor) e commitar `docs: relatório da fase 1`.
- [ ] **Passo 4:** push e PR `Fase 1 — Fundação` para `main`, com o relatório no corpo do PR. **Não fazer merge.**

## Critério de saída

CI verde; `settings.json` sem segredos; IPC de arquivos restrito; onboarding salva e aplica o tema; Rodrigo testou no Mac.
