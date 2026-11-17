# Módulos nativos 1.1.0 — Plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** entregar a base de módulos nativos (F0), a Vassoura de Produção e o Cofre .env na versão 1.1.0, mais o spike do Sandbox.

**Arquitetura:** trabalho pesado de CPU (AST) roda num `utilityProcess` criado sob demanda; cada módulo tem motor puro em `src/main/modules/<id>/`, IPC em `src/main/ipc/<id>.js`, namespace no preload e UI em `src/renderer/scripts/<id>.js`. O agente recebe ferramentas extras por módulo. A UI entra pelo hub "Módulos Agzos" (antigo Extensões).

**Stack:** Electron 32, Node 22, Monaco 0.50, `typescript` 5.9 (novo em `dependencies`), `node:test`, Playwright (`xvfb-run`).

**Spec:** `docs/superpowers/specs/2026-11-17-modulos-nativos-1.1.0-design.md` — os executores leem a spec e este plano.

## Restrições globais

- UI em JS puro (sem React). `contextIsolation`, sem `nodeIntegration`; todo caminho passa pelo `path-guard` do workspace.
- Sem módulos nativos novos (nada que precise compilar). `typescript` é carregado **só** no worker.
- Valores de `.env` e segredos nunca são logados, nunca vão ao modelo e só chegam ao renderer via `envVault.reveal`.
- Textos de UI em pt-BR com acentos.
- Testes unitários: `node:test` + `node:assert/strict` em `test/unit/*.test.js` (padrão de `test/unit/agent-tools.test.js`). E2E: `test/e2e/*.spec.js` com `launchApp` de `test/e2e/helpers.js` e `global.__agzosAllowRoot`.
- Verificação de cada tarefa: `npm run check` verde. E2E: `xvfb-run -a npx playwright test <spec>`.
- Commits pequenos, mensagem em pt-BR no formato `feat(<módulo>): …`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ao remover algo no repositório, usar caminhos explícitos (nada de `rm -rf` com glob).

## Foco de revisão

1. **Arquivo sujo no editor** quando a Vassoura ou o Cofre alteram o disco → aplicar pede para salvar antes (preview) ou recarrega pelo caminho `file_changed`; nunca perde a edição do usuário. Teste na Tarefa 9.
2. **CRLF e BOM** em arquivos limpos → a remoção de linha inteira consome `\r\n` e o BOM é preservado. Teste na Tarefa 5.
3. **`.env` com valor contendo `#`, `=` ou aspas internas** → o parser não corta o valor e `serialize` não altera outras linhas. Teste na Tarefa 10.
4. **Repositório sem commits ou em detached HEAD** no bloqueio de commit → a varredura do staged funciona (usa `--cached`, sem HEAD). Teste na Tarefa 12.
5. **Workspace com milhares de arquivos ou arquivo > 1 MB** no scan → respeita os limites (5000 arquivos, 1 MB) e o Cancelar interrompe em < 1 s. Teste na Tarefa 7.

---

## Distribuição entre agentes

| Fase | Quem | Tarefas | Paralelo? |
|---|---|---|---|
| A | Agente **F** (base) | 1–4 | sequencial; bloqueia B |
| B | Agente **V** (Vassoura), worktree próprio | 5–9 | em paralelo com C e P |
| B | Agente **C** (Cofre .env), worktree próprio | 10–14 | em paralelo com V e P |
| B | Agente **P** (spike Sandbox) | 15 | em paralelo; só `spikes/` e docs |
| C | Sênior (sessão principal) | 16 | depois de V e C |

A Fase A deixa **todos os pontos de integração prontos** (stubs registrados no main, preload, index.html, app.js, settings e agregador de ferramentas). Assim V e C só criam arquivos próprios e preenchem os stubs dos seus módulos, e o merge das duas branches não conflita.

---

## Fase A — Base (Agente F)

### Tarefa 1: Host de `utilityProcess`

**Arquivos:**
- Criar: `src/main/modules/worker-host.js`
- Teste: `test/unit/worker-host.test.js` (fixture `test/unit/fixtures/echo-worker.js`)

**Interfaces:**
- Produz: `createWorkerHost({ script, idleMs = 60000, fork }) → { call(method, params, { signal } = {}) → Promise<any>, dispose() → void, isAlive() → boolean }`. `fork(script)` padrão = `require('electron').utilityProcess.fork`; o objeto filho precisa de `postMessage`, `on('message')`, `on('exit')`, `kill()`.
- Protocolo: pai envia `{ id, method, params }` e `{ id, cancel: true }`; filho responde `{ id, ok: true, result }` ou `{ id, ok: false, error: { message, code } }`. Lado filho: helper `serveWorker(handlers)` exportado do mesmo arquivo, que usa `process.parentPort` (Electron) ou `process` (child_process) e passa um `AbortSignal` como 2º argumento de cada handler.

- [ ] **Passo 1: testes que falham** — usando `fork` injetado que embrulha `child_process.fork` (adaptador `postMessage → send`):
  - `cria o processo só na primeira chamada` (`isAlive()` false → `call('echo', 1)` resolve `1` → `isAlive()` true)
  - `encerra após idleMs sem pendências` (`idleMs: 50`, espera 150 ms → `isAlive()` false; nova chamada recria)
  - `cancelamento rejeita com AbortError e avisa o filho` (`call('sleep', 1000, { signal })`, `abort()` → rejeita `name === 'AbortError'` em < 100 ms)
  - `processo morto rejeita pendentes e recria` (`call('crash')` rejeita com mensagem contendo "encerrou"; `call('echo', 2)` → 2)
  - `erro do handler vira rejeição com message e code`
- [ ] **Passo 2:** `node --test test/unit/worker-host.test.js` → FAIL (módulo não existe).
- [ ] **Passo 3:** implementar `createWorkerHost` e `serveWorker`. O timer de ociosidade reinicia a cada resposta e só conta com zero pendências.
- [ ] **Passo 4:** teste → PASS; `npm run check` verde.
- [ ] **Passo 5:** commit `feat(modules): host de utilityProcess sob demanda`.

### Tarefa 2: Settings `modules` + categoria nas Configurações

**Arquivos:**
- Modificar: `src/main/lib/settings.js` (defaults + `normalizeModules`, no padrão de `aiPanel`/`aiAgent`)
- Modificar: `src/renderer/scripts/settings-modal.js` (categoria `modules`)
- Teste: `test/unit/settings.test.js` (acrescentar casos); `test/e2e/settings-modal.spec.js` (1 caso)

**Interfaces:**
- Produz: `settings.modules` exatamente como na spec (F0.4): `broom.{enabled, rules.{console,comments,unusedImports,deadCode}, keepConsole, keepComments, statusBar}` e `envVault.{enabled, blockCommits, extraPatterns, allowlist, revealTimeoutSec}`.

- [ ] **Passo 1: testes** — `defaults de modules`; `modules.broom.rules.console inválido volta a true`; `keepConsole não-array volta a ['error','warn']`; `revealTimeoutSec fora de 3..120 volta a 10`; `extraPatterns com regex inválida é descartado item a item`; `settings:save preserva modules ao salvar outra seção`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar normalização. Categoria `{ id: 'modules', label: 'Módulos Agzos', icon: 'blocks' }` com subseções "Vassoura de Produção" (habilitar, 4 regras, métodos de console mantidos, contador na status bar) e "Cofre .env" (habilitar, bloquear commits, tempo de revelação). `extraPatterns`/`allowlist` editáveis só pelo modo JSON nesta versão.
- [ ] **Passo 4:** e2e `categoria Módulos Agzos mostra Vassoura e Cofre e persiste blockCommits=false` → PASS; `npm run check` verde.
- [ ] **Passo 5:** commit `feat(modules): configurações dos módulos nativos`.

### Tarefa 3: Ferramentas extras do agente

**Arquivos:**
- Modificar: `src/main/agent/tools.js` (`createToolbox({ …, extraTools = [] })`)
- Modificar: `src/main/agent/session.js` (passa `extraTools` e respeita o `kind` no modo de autonomia)
- Criar: `src/main/modules/agent-tools.js`; stubs `src/main/modules/broom/agent-tool.js` e `src/main/modules/envvault/agent-tool.js` exportando `module.exports = null` (V e C preenchem)
- Teste: `test/unit/agent-tools.test.js`, `test/unit/agent-loop.test.js` (acrescentar)

**Interfaces:**
- Produz: ferramenta extra = `{ definition: { name, description, input_schema }, kind: 'read'|'write'|'command', prepare(input, ctx) → { title, preview?, run() → Promise<{ summary, meta?, output? }> } }`, no mesmo formato de retorno do `prepare` atual. `ctx = { resolvePath, rel, checkpoint, readTextFile, root }`.
- Produz: `getModuleTools(settings) → ExtraTool[]` em `src/main/modules/agent-tools.js`, que inclui cada stub não nulo cujo módulo esteja `enabled`.
- Regra de autonomia: `read` nunca pede OK; `write` segue a regra de criar/editar do modo; `command` segue a regra de comando. Uma ferramenta pode forçar aprovação devolvendo `preview.risk = '<motivo>'` (usado pelo Cofre na Tarefa 12).

- [ ] **Passo 1: testes** — `extraTools aparecem em definitions`; `prepare de extra recebe ctx com resolvePath que nega fora da raiz`; `kind write pede OK no modo ask e não no modo edit`; `preview.risk força aprovação no modo auto`; `getModuleTools ignora módulo desabilitado e stub null`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** → PASS; `npm run check` verde.
- [ ] **Passo 5:** commit `feat(agent): ferramentas extras de módulos`.

### Tarefa 4: Hub "Módulos Agzos" e pontos de integração

**Arquivos:**
- Modificar: `src/renderer/index.html` (`data-view="modules"`, `#panel-modules`, `<link>` para `styles/modules.css`, `styles/broom.css`, `styles/envvault.css`)
- Modificar: `src/renderer/scripts/keymap.js` (`Ctrl+Shift+X` → `view.modules`), `src/renderer/scripts/app.js` (import e `setup` de `modules-hub.js`, `broom.js`, `envvault.js`)
- Modificar: `src/renderer/scripts/command-palette.js` (exportar `registerCommands(cmds)`), `src/renderer/scripts/file-tree.js` (exportar `registerContextMenuItems(fn)` e `setFileBadge(path, text|null)`)
- Modificar: `src/main/main.js` (registrar `./ipc/broom` e `./ipc/envvault`), `src/main/preload.js` (namespaces `broom` e `envVault` com todos os métodos da spec mapeados para canais `broom:*`/`envvault:*`, e `onEvent` de `broom:event`)
- Criar: `src/renderer/scripts/modules-hub.js`, `src/renderer/styles/modules.css`; stubs `src/renderer/scripts/broom.js` e `src/renderer/scripts/envvault.js` (exportam `setupBroom()`/`setupEnvVault()` vazios); `src/renderer/styles/broom.css` e `envvault.css` vazios; `src/main/ipc/broom.js` e `src/main/ipc/envvault.js` com `register(ipcMain, deps)` vazio
- Teste: `test/e2e/modules-hub.spec.js`; `test/unit/keymap.test.js` (acrescentar)

**Interfaces:**
- Produz (renderer): `registerModule({ id, label, icon, description, comingSoon = false, open(container) })`, `openModule(id)`, `showModulesHub()`. A view do módulo recebe `container` e o hub mostra "← Módulos" no topo.
- Produz: `registerCommands([{ id, label, run }])`; `registerContextMenuItems((node) => [{ label, run }])`; `setFileBadge(absPath, text|null)`.
- Produz (main): `register(ipcMain, { guard, settingsStore, userDataDir, workerHost })` para `ipc/broom.js` e `ipc/envvault.js`. O `main.js` cria **um** `workerHost` com `script: path.join(__dirname, 'modules/worker.js')` (arquivo criado aqui com `serveWorker({})`; V acrescenta handlers).
- Preload `window.agzos.broom`: `analyzeFile, cleanFile, scanWorkspace, cleanWorkspace, cancel, undo, onEvent`. `window.agzos.envVault`: `list, reveal, setValue, addKey, removeKey, generateExample, copy, scanStaged, installHook, removeHook, hookStatus, gitignoreStatus, addToGitignore`.
- Cards: Vassoura e Cofre `.env` (ativos); Snippets, Sandbox e Git Slider com `comingSoon: true`.

- [ ] **Passo 1: testes** — unit `Ctrl+Shift+X → view.modules`; e2e `hub lista 5 cards, 3 "Em breve"`, `abrir card e voltar com ← Módulos`, `window.agzos.broom e window.agzos.envVault existem`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar. Remover o texto "Open VSX…" e qualquer referência a `view.extensions`.
- [ ] **Passo 4:** → PASS; `npm run check` e e2e existentes (`shortcuts-settings`, `layout-terminal`, `ai-dock`) verdes.
- [ ] **Passo 5:** commit `feat(modules): hub Módulos Agzos e pontos de integração`.

**Fim da Fase A:** o Agente F reporta os nomes finais exportados. O sênior confere e dispara V, C e P.

---

## Fase B1 — Vassoura (Agente V, worktree `feat/v1.1.0-broom` a partir do fim da Fase A)

Escopo de arquivos: `src/main/modules/broom/**`, `src/main/modules/worker.js` (só acrescentar handlers `broom.*`), `src/main/ipc/broom.js`, `src/renderer/scripts/broom.js`, `src/renderer/styles/broom.css`, `package.json` (só `typescript` em `dependencies` e exclusões de build), testes `broom-*`. Não tocar arquivos do Cofre.

### Tarefa 5: Análise AST — regras

**Arquivos:**
- Criar: `src/main/modules/broom/analyze.js`, `src/main/modules/broom/apply.js`
- Teste: `test/unit/broom-analyze.test.js`, fixtures em `test/unit/fixtures/broom/`

**Interfaces:**
- Produz: `analyze(text, { fileName, rules, keepConsole, keepComments }) → { edits: Edit[], error?: string }`, onde `Edit = { id: string, start, end, rule: 'console'|'comments'|'unusedImports'|'deadCode', line, preview }` (`id` = `${rule}:${start}`).
- Produz: `applyEdits(text, edits) → string` (ordem decrescente de `start`, ignora sobreposições mantendo o intervalo maior).

- [ ] **Passo 1: testes** — um por caso da seção "Testes" da Vassoura na spec, mais:
  - `CRLF: remover linha inteira consome \r\n` e `BOM preservado`
  - `idempotente: analyze(applyEdits(x)) → 0 edits` em todas as fixtures
  - `resultado sem parseDiagnostics` em todas as fixtures
  - `.vue/.css → edits []`; arquivo com erro de sintaxe → `edits: []` e `error`
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** adicionar `typescript` (`^5.9.3`) a `dependencies` e implementar. Remoção de linha inteira: se a linha só contém o nó (e espaços), o intervalo vai do início da linha até depois do `\n`. Parse com `ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKindFromExt)`. Erro de sintaxe = `sourceFile.parseDiagnostics.length > 0`.
- [ ] **Passo 4:** → PASS.
- [ ] **Passo 5:** commit `feat(broom): análise AST e aplicação de remoções`.

### Tarefa 6: Worker, cache e build

**Arquivos:**
- Modificar: `src/main/modules/worker.js` (handlers `broom.analyze`, `broom.analyzeMany`)
- Criar: `src/main/modules/broom/cache.js`
- Modificar: `package.json` `build.files` (excluir `node_modules/typescript/lib/{tsserver*,typingsInstaller*,watchGuard*,_tsserver*,_typingsInstaller*,cancellationToken*}` e `node_modules/typescript/lib/*/diagnosticMessages.generated.json`)
- Teste: `test/unit/broom-cache.test.js`

**Interfaces:**
- Produz: `createAnalysisCache({ max = 200 }) → { get(key), set(key, value), invalidate(path), clear() }`, com `key = path|mtimeMs|size|rulesHash`.
- Produz (worker): `broom.analyze({ path, text, options }) → AnalyzeResult`; `broom.analyzeMany({ files: [{ path, text }], options }, signal)`, que verifica `signal.aborted` entre arquivos.

- [ ] **Passo 1: testes** — `LRU descarta o mais antigo acima de max`; `invalidate remove todas as chaves do path`; `rulesHash diferente não reaproveita`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** → PASS; `npx electron-builder --linux --dir` e conferir que `typescript/lib/typescript.js` está no asar e `tsserver.js` não está (`npx asar list dist/linux-unpacked/resources/app.asar | grep typescript/lib/ts`). Apagar `dist/linux-unpacked` com caminho explícito.
- [ ] **Passo 5:** commit `feat(broom): worker e cache de análise`.

### Tarefa 7: IPC da Vassoura

**Arquivos:**
- Modificar: `src/main/ipc/broom.js`
- Teste: `test/unit/broom-ipc.test.js` (IPC com `ipcMain` falso, `workerHost` real via `child_process.fork`, workspace temporário)

**Interfaces:**
- Consome: `workerHost.call`, `createCheckpointStore({ dir: path.join(userDataDir, 'broom-checkpoints'), maxCount: 20 })`, `guard`.
- Produz os canais da spec: `broom:analyzeFile(path)`, `broom:cleanFile(path, { editIds? })`, `broom:scanWorkspace(requestId)`, `broom:cleanWorkspace(requestId, paths)`, `broom:cancel(requestId)`, `broom:undo(checkpointId)`; eventos `broom:event` `(requestId, { type: 'progress'|'done'|'error', … })`. Respostas exatamente como na spec.
- Scan: ignora `node_modules .git dist build .next coverage`, arquivos > 1 MB; máx. 5000 arquivos; extensões `.ts .tsx .js .jsx .mjs .cjs`.

- [ ] **Passo 1: testes** — `analyzeFile fora do workspace → erro de acesso`; `cleanFile aplica e undo restaura byte a byte`; `cleanFile com editIds aplica só as escolhidas`; `scan respeita ignorados, 1 MB e limite 5000 (com 5001 arquivos, done.files ≤ 5000 e flag truncated)`; `cancel interrompe scan em < 1 s`; `cleanWorkspace cria um único checkpoint`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar. Depois de alterar um arquivo, emitir `webContents.send('agent:file-changed', absPath)` ou o canal equivalente que o editor já escuta para `file_changed` (conferir em `editor.js`/`agent-ui.js`; reaproveitar, não criar outro).
- [ ] **Passo 4:** → PASS.
- [ ] **Passo 5:** commit `feat(broom): IPC de análise, limpeza e desfazer`.

### Tarefa 8: Interface da Vassoura

**Arquivos:**
- Modificar: `src/renderer/scripts/broom.js`, `src/renderer/styles/broom.css`; `src/renderer/index.html` (só o item `#status-broom` na status bar)
- Teste: `test/e2e/broom.spec.js`

**Interfaces:**
- Consome: `registerModule`, `registerCommands`, `registerContextMenuItems`, `setFileBadge`, `showDiff` (`diff-view.js`), `window.agzos.broom`, evento `agzos:file-saved`.
- Comandos (labels exatos): "Agzos: Limpar Código de Produção (arquivo atual)", "Agzos: Limpar Código de Produção (workspace)", "Agzos: Desfazer última limpeza". Menu de contexto: "Limpar código de produção".

- [ ] **Passo 1: e2e** — `status bar mostra 🧹 3 para fixture com 3 lixos e some com 0`; `preview abre diff e Limpar aplica`; `arquivo sujo: Limpar pede para salvar e não altera o disco antes`; `view do hub: analisar, desmarcar 1 arquivo, Limpar selecionados, toast Desfazer restaura`; `badge aparece no Explorer após análise`; `statusBar=false esconde o item`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar conforme a spec (seção "Interface" da Vassoura).
- [ ] **Passo 4:** → PASS; e2e existentes verdes.
- [ ] **Passo 5:** commit `feat(broom): interface, comandos e badges`.

### Tarefa 9: Ferramenta `clean_code` do agente

**Arquivos:**
- Modificar: `src/main/modules/broom/agent-tool.js`
- Teste: `test/unit/broom-agent-tool.test.js`; caso novo em `test/e2e/ai-agent.spec.js` (servidor fake emite `clean_code`)

**Interfaces:**
- Produz: ferramenta extra `kind: 'write'`, `definition.name = 'clean_code'`, `input_schema = { path: string (obrigatório), rules?: { console?, comments?, unusedImports?, deadCode? } }`. Pasta: até 200 arquivos. `run()` → `{ summary: 'Limpou N itens em M arquivos', meta: { files, removed, byRule } }`. Registra cada arquivo no `ctx.checkpoint` antes de escrever. `preview.diff` para um arquivo; para pasta, `preview.files`.

- [ ] **Passo 1: testes** — `limpa arquivo e checkpoint da conversa desfaz`; `pasta com 201 arquivos → erro claro`; `fora da raiz → negado`; e2e `agente chama clean_code no modo edit sem pedir OK e o arquivo aberto recarrega`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** → PASS; `npm run check` verde.
- [ ] **Passo 5:** commit `feat(broom): ferramenta clean_code do agente`.

**Fim de V:** relatório em `docs/plano/relatorios/v1.1.0-vassoura.md` (o que foi feito, testes, desvios da spec, pendências).

---

## Fase B2 — Cofre .env (Agente C, worktree `feat/v1.1.0-envvault` a partir do fim da Fase A)

Escopo de arquivos: `src/main/modules/envvault/**`, `src/main/ipc/envvault.js`, `src/main/ipc/git.js` (só o bloqueio em `git:commit`), `src/main/agent/session.js` ou `tools.js` (só o gancho de risco de `run_command`), `src/renderer/scripts/envvault.js`, `src/renderer/scripts/git-panel.js` (só o diálogo de bloqueio), `src/renderer/styles/envvault.css`, testes `envvault-*`. Não tocar arquivos da Vassoura.

### Tarefa 10: Parser e comparação

**Arquivos:**
- Criar: `src/main/modules/envvault/parse.js`, `src/main/modules/envvault/compare.js`
- Teste: `test/unit/envvault-parse.test.js`

**Interfaces:**
- Produz: `parseEnv(text) → { entries: [{ key, value, line, quoted: false|'"'|"'"|'`', exported }], eol }`; `setEntry(text, key, value) → string` (altera só a linha da chave; acrescenta no fim se não existir, com aspas duplas quando o valor tem espaço, `#`, aspas ou quebra de linha); `removeEntry(text, key) → string`.
- Produz: `compareEnv(exampleEntries, entries) → { missing: string[], extra: string[], empty: string[] }`; `findExampleFile(files) → path|null` (`.env.example` > `.env.sample` > `.env.template`).

- [ ] **Passo 1: testes** — `export KEY=v`; aspas simples, duplas e crase; multilinha em aspas duplas; `KEY=a#b` sem espaço mantém `a#b`; `KEY=a #c` → `a`; `KEY="x=y#z"`; linhas vazias e comentários ignorados; CRLF preservado; `setEntry` não altera as outras linhas (byte a byte); `removeEntry`; compare missing/extra/empty.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** → PASS.
- [ ] **Passo 5:** commit `feat(envvault): parser dotenv e comparação com example`.

### Tarefa 11: Detector de segredos e varredura de diff

**Arquivos:**
- Criar: `src/main/modules/envvault/detect.js`, `src/main/modules/envvault/staged.js`
- Teste: `test/unit/envvault-detect.test.js`

**Interfaces:**
- Produz: `detectSecrets(text, { fileName, extraPatterns = [], allowlist = [] }) → [{ line, column, rule, preview }]`. `preview` = 4 primeiros caracteres do valor + `…`. Padrões e exceções exatamente como na spec (seção "Motor" do Cofre). Entropia: Shannon ≥ 3.5 e comprimento ≥ 16.
- Produz: `scanStagedDiff(diffText, opts) → [{ file, line, rule, preview }]` (lê saída de `git diff --cached -U0 --no-color --no-ext-diff`, considera só linhas `+` e numera pela linha nova do hunk); `isRealEnvFile(path) → boolean` (`.env`/`.env.*`, exceto `*.example|*.sample|*.template`).
- Produz: `scanStaged(repoRoot, opts) → Promise<{ findings, envFiles }>` usando o runner de git existente (`src/main/git/run.js`).

- [ ] **Passo 1: testes** — positivo para cada padrão da spec (com valores sintéticos); negativos: `sk-test-placeholder`, `your-api-key`, `<TOKEN>`, `${API_KEY}`, `process.env.OPENAI_API_KEY`, UUID isolado, `integrity: sha512-…`, `package-lock.json` inteiro; `allowlist` silencia; `extraPatterns` detecta; o preview nunca contém o valor completo; diff `-U0` com 2 hunks numera certo; `scanStaged` em repo temporário **sem commits** e em **detached HEAD** funciona.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** → PASS.
- [ ] **Passo 5:** commit `feat(envvault): detector de segredos e varredura do staged`.

### Tarefa 12: Bloqueio de commit (painel Git e agente)

**Arquivos:**
- Modificar: `src/main/ipc/git.js` (handler `git:commit`), `src/renderer/scripts/git-panel.js` (diálogo), gancho de risco do `run_command` (`src/main/agent/tools.js`, função de preparo do `run_command`)
- Teste: `test/unit/envvault-commit.test.js`; `test/unit/agent-tools.test.js` (acrescentar)

**Interfaces:**
- `git:commit(cwd, message, options)` aceita `options.ignoreSecretsOnce`. Com `modules.envVault.enabled && blockCommits` e achados, rejeita com `{ kind: 'secrets_detected', findings }` (no formato de erro que `wrap` já serializa para o renderer). Com `ignoreSecretsOnce`, commita e acrescenta uma linha a `userData/envvault-overrides.log`: `ISO-date\t<repo>\t<arquivos>\t<regras>`.
- Diálogo (labels exatos): título "Commit bloqueado: possíveis segredos"; botões "Cancelar" (foco padrão), "Remover do stage", "Ignorar uma vez". "Commit e Push" usa o mesmo fluxo.
- Agente: `run_command` com `/\bgit\b[^;|&]*\bcommit\b/` → roda `scanStaged`; com achados, `preview.risk = 'commit com possíveis segredos'`.

- [ ] **Passo 1: testes** — repo temporário: `segredo staged bloqueia e não cria commit`; `ignoreSecretsOnce commita e o log não contém o valor`; `.env staged bloqueia`; `.env.example passa`; `blockCommits=false não bloqueia`; agente: `git commit com staged sujo pede OK no modo auto`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** → PASS; `test/e2e/git.spec.js` continua verde.
- [ ] **Passo 5:** commit `feat(envvault): bloqueio de commit com segredos`.

### Tarefa 13: IPC do Cofre e hook pre-commit

**Arquivos:**
- Modificar: `src/main/ipc/envvault.js`
- Criar: `src/main/modules/envvault/hook.js`
- Teste: `test/unit/envvault-ipc.test.js`

**Interfaces:**
- Canais da spec, com as respostas da spec. `list()` **nunca** inclui `value`; `masked` = `'••••••••'` (fixo, não revela o comprimento). Busca `.env*` na raiz e em subpastas até profundidade 3, ignorando `node_modules`, `.git`, `dist`.
- `reveal(path, key) → { value }`; `copy(path, key)` usa `clipboard.writeText` no main e devolve `{ ok: true }`.
- `setValue`/`addKey`/`removeKey` registram checkpoint (`userData/envvault-checkpoints/`) antes de escrever.
- `generateExample(path)` mantém comentários e ordem, com os valores vazios.
- `gitignoreStatus() → { ignored: boolean }` (via `git check-ignore .env`); `addToGitignore()` acrescenta `.env` e `.env*.local` ao `.gitignore` da raiz (cria se não existir), sem duplicar linhas.
- Hook: `installHook(repoRoot) → { installed: boolean, reason? }` grava `.git/hooks/pre-commit` (modo 0755) com a linha marcadora `# agzos-envvault-hook`; se já existir arquivo sem o marcador, devolve `reason: 'exists'`. `removeHook` só apaga com o marcador. `hookStatus → 'installed'|'foreign'|'none'`. O script sh usa `git diff --cached -U0` + `grep -E` com os padrões AWS/Stripe/OpenAI/Anthropic/GitHub/chave privada e sai com 1 e mensagem pt-BR.

- [ ] **Passo 1: testes** — `list não contém valores (JSON.stringify não inclui o valor)`; `reveal devolve o valor`; `fora do workspace negado`; `setValue + undo restaura`; `generateExample`; `installHook cria executável com marcador`; `hook bloqueia commit com AKIA… via git real`; `installHook não sobrescreve hook alheio`; `removeHook respeita marcador`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** → PASS.
- [ ] **Passo 5:** commit `feat(envvault): IPC do cofre e hook pre-commit`.

### Tarefa 14: Interface do Cofre e `env_check`

**Arquivos:**
- Modificar: `src/renderer/scripts/envvault.js`, `src/renderer/styles/envvault.css`, `src/main/modules/envvault/agent-tool.js`
- Teste: `test/e2e/envvault.spec.js`; `test/unit/envvault-agent-tool.test.js`

**Interfaces:**
- Consome: `registerModule`, `registerCommands`, `window.agzos.envVault`, `settings.modules.envVault.revealTimeoutSec`.
- `env_check`: `kind: 'read'`, sem parâmetros. Retorno exatamente como na spec, sem valores.
- Revelar: clique longo de 500 ms ou `Alt` pressionado com o mouse sobre a linha; esconder após `revealTimeoutSec`.

- [ ] **Passo 1: testes** — e2e: `valor não está no DOM antes de revelar` (`page.content()` não contém o valor); `clique longo revela e some após o timeout` (com `revealTimeoutSec: 3`); `selos segredo/vazia/faltando`; `Gerar .env.example`; `aviso de .gitignore e botão adiciona a linha`; `commit com segredo abre o diálogo e Ignorar uma vez cria o commit`. Unit: `env_check não contém valores`.
- [ ] **Passo 2:** rodar → FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** → PASS; e2e existentes verdes.
- [ ] **Passo 5:** commit `feat(envvault): view do cofre e ferramenta env_check`.

**Fim de C:** relatório em `docs/plano/relatorios/v1.1.0-cofre-env.md`.

---

## Fase B3 — Spike do Sandbox (Agente P)

### Tarefa 15: Spike

**Arquivos:**
- Criar (descartável): `spikes/sandbox/**` (não comitar `node_modules` do spike; o spike tem `package.json` próprio)
- Criar: `docs/superpowers/specs/2026-11-17-sandbox-spike.md`

- [ ] **Passo 1:** montar uma fixture Next/React com Tailwind (componente de cerca de 300 linhas, 5 imports locais, 1 alias `@/`, `next/link` e `next/image`).
- [ ] **Passo 2:** medir as 5 perguntas da spec (esbuild-wasm a frio e a quente, resolução de alias/node_modules, shims Next, Tailwind offline v3 vs v4 lendo o config, RAM de `WebContentsView` com partition vs iframe sandbox). Cada número com o comando que o gerou.
- [ ] **Passo 3:** escrever o relatório com a recomendação, os tamanhos a embutir (MB) e os riscos.
- [ ] **Passo 4:** apagar `spikes/sandbox/node_modules` com caminho explícito; comitar só o relatório (e, se útil, o código do spike sem dependências) com `docs(sandbox): resultado do spike`.

---

## Fase C — Integração e release (sênior)

### Tarefa 16: Integrar, medir e publicar

**Arquivos:**
- Criar: `tools/measure-ram.js`, `test/e2e/ram.spec.js`
- Modificar: `package.json` (`version: 1.1.0`), `CHANGELOG.md`, `README.md`, `docs/plano/ROADMAP.md`

- [ ] **Passo 1:** revisar os relatórios de V e C; merge de `feat/v1.1.0-broom` e `feat/v1.1.0-envvault` em `feat/v1.1.0-modulos-nativos`; resolver conflitos (esperado: nenhum fora de `package-lock.json`).
- [ ] **Passo 2:** `tools/measure-ram.js` conforme a spec F0.5; `ram.spec.js` roda o script e anexa o JSON ao relatório. Saída esperada: `deltaMB` da Vassoura < 50 (reportado, não reprova).
- [ ] **Passo 3:** `npm run check` e `xvfb-run -a npx playwright test` completos verdes.
- [ ] **Passo 4:** revisão do branch inteiro por um revisor novo (superpowers:requesting-code-review).
- [ ] **Passo 5:** versão 1.1.0, CHANGELOG, README (seção Módulos Agzos), ROADMAP (Onda 1 concluída). Commit.
- [ ] **Passo 6:** `npx electron-builder --linux` e `--win`, staging com hardlinks, `node tools/publish-vps-release.js` (keep 2), verificar `sha256sum` e `curl` 200, limpar o stage e `dist/` com caminhos explícitos.
- [ ] **Passo 7:** push, PR para `main` e links para o usuário.
