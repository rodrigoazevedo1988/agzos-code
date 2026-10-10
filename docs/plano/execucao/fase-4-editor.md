# Fase 4 — Editor completo: Plano de Implementação

> **Para o executor:** leia antes o [guia do executor](00-guia-do-executor.md). Pré-requisito: Fase 3 mergeada.

**Objetivo:** fechar as lacunas de editor do dia a dia: IntelliSense nas linguagens web, terminal real, busca rápida, recarregar arquivos alterados fora do app, restaurar sessão, modos de performance com efeito e importação de configurações do VS Code.

**Arquitetura:** workers do Monaco carregados do `vendor/`. Terminal com `node-pty` no main. Busca e listagem de arquivos com `@vscode/ripgrep` no main, com streaming de resultados por IPC.

**Stack:** `node-pty@^1`, `@vscode/ripgrep@^1`, `@xterm/xterm@^5` + `@xterm/addon-fit` (substituem os pacotes `xterm`/`xterm-addon-fit`, que estão descontinuados).

**Branch:** `feat/fase-4-editor`

## Restrições globais

- `node-pty` é módulo nativo: precisa ser recompilado para o Electron. Usar `electron-builder install-app-deps` no `postinstall` e `asarUnpack` para `node_modules/node-pty/**` e `node_modules/@vscode/ripgrep/**`.
- Busca ignora `.git`, `node_modules`, `dist`, `out`, `build` e respeita `.gitignore` (padrão do ripgrep).
- Máx. 2 000 resultados de busca por consulta.

## Foco de revisão

1. Arquivo aberto e alterado por fora (ex.: `git pull`) sem edição local → recarrega sozinho; com edição local → pergunta `Manter minha versão` / `Recarregar do disco`.
2. Arquivo binário ou > 5 MB na busca → ignorado sem travar.
3. Terminal: `vim`, `htop`, `Ctrl+C` e redimensionar a janela funcionam.
4. Workspace com 50 000 arquivos → Quick Open responde em < 1 s após a indexação inicial.
5. App reaberto → mesma pasta e mesmas abas (arquivos apagados nesse meio tempo são ignorados sem erro).

---

### Tarefa 1: IntelliSense com workers do Monaco

**Arquivos:** Modificar `src/renderer/scripts/editor.js` (antes de carregar o loader), `test/e2e/editor.spec.js`

**Interfaces:**
- `self.MonacoEnvironment = { getWorkerUrl: (_id, label) => … }` apontando para `vendor/monaco/vs/base/worker/workerMain.js` (o build `min` do Monaco resolve o worker de cada linguagem a partir dele). Ajustar CSP só se necessário (`worker-src 'self' blob:` já existe).
- TS/JS: `compilerOptions` com `target: ESNext`, `allowJs: true`, `checkJs: false`, `moduleResolution: NodeJs`.

- [ ] **Passo 1:** E2E: abrir `a.ts` com `const x: number = "texto";`; em até 5 s `monaco.editor.getModelMarkers({})` tem 1+ marcador de erro.
- [ ] **Passo 2:** FAIL → implementar → PASS. Commit `feat(editor): IntelliSense para TS/JS/JSON/CSS/HTML`.

---

### Tarefa 2: Terminal com node-pty

**Arquivos:** Modificar `package.json`, `src/main/ipc/term.js`, `src/renderer/scripts/terminal.js`, `tools/setup-vendor.js`, `src/renderer/index.html`, `test/e2e/terminal.spec.js`

**Interfaces:**
- `term:create(cols, rows, cwd?)` usa `pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd: cwd || workspaceRoot || home, env })`. Shell: `process.env.SHELL` (macOS/Linux, com `-l`), `powershell.exe` (Windows).
- `term:resize(id, cols, rows)` passa a chamar `pty.resize`.
- Renderer: chamar `term.resize` no `onResize` do xterm (após `fit()`).
- Trocar `xterm`/`xterm-addon-fit` por `@xterm/xterm`/`@xterm/addon-fit` (atualizar `setup-vendor.js` e imports).

- [ ] **Passo 1:** E2E: abrir terminal; enviar `echo agzos-$((40+2))\r`; buffer do xterm contém `agzos-42`.
- [ ] **Passo 2:** FAIL → implementar → PASS. Verificar `npm run pack` gera app que abre o terminal (Linux local).
- [ ] **Passo 3:** commit `feat(terminal): pty real com redimensionamento`.

---

### Tarefa 3: Busca e Quick Open com ripgrep

**Arquivos:** Criar `src/main/search/ripgrep.js`, `src/main/ipc/search.js`, `src/renderer/scripts/quick-open.js`, `src/renderer/scripts/fuzzy.js`, `test/unit/ripgrep.test.js`, `test/unit/fuzzy.test.js`. Modificar `src/renderer/scripts/search.js`, `src/renderer/scripts/app.js` (Ctrl+P abre `quick-open`), `src/main/preload.js`

**Interfaces:**
- `listFiles(root, { rgPath, signal }) → Promise<string[]>` (`rg --files --hidden -g !.git`).
- `searchText(root, query, { regex = false, caseSensitive = false, rgPath, signal, onMatch }) → Promise<{ total, truncated }>` (`rg --json`), `onMatch({ path, line, column, preview })`.
- IPC: `search:files(root)`, `search:text(requestId, root, query, opts)` com eventos `search:match`, `search:done`; `search:cancel(requestId)`.
- `fuzzy.js` (puro): `fuzzyFilter(items: string[], query: string, limit = 50) → Array<{ item, score, positions: number[] }>` — prioriza match no nome do arquivo, depois no caminho.
- Quick Open: overlay estilo Command Palette, lista com destaque dos caracteres, Enter abre, setas navegam.

- [ ] **Passo 1:** testes unitários (repo temporário com arquivos): `listFiles ignora .git e respeita .gitignore`; `searchText acha linha e coluna`; `regex`; `truncated após 2000`; `fuzzyFilter` (`'appjs'` → `src/renderer/scripts/app.js` primeiro).
- [ ] **Passo 2:** FAIL → implementar → PASS. Commit `feat(search): busca e quick open com ripgrep`.

---

### Tarefa 4: Arquivos alterados fora do app e sessão

**Arquivos:** Criar `src/main/ipc/watch.js`. Modificar `src/main/preload.js`, `src/renderer/scripts/editor.js`, `src/renderer/scripts/file-tree.js`, `src/renderer/scripts/app.js`, `test/e2e/session.spec.js`

**Interfaces:**
- `watch:file(path)`, `watch:unfile(path)`; evento `watch:changed(path)` (debounce 200 ms, via `fs.watch`). Árvore de arquivos atualiza quando muda o diretório expandido.
- Ao `watch:changed`: aba sem alteração local → recarrega; com alteração → barra de aviso com `Manter minha versão` / `Recarregar do disco`.
- Sessão em `settings.session = { workspaceRoot, openFiles: string[], activePath }`, salva ao abrir/fechar aba e restaurada no boot (via `workspace:open`).

- [ ] **Passo 1:** E2E: abrir arquivo, alterar por fora com `fs.writeFileSync` → editor mostra novo conteúdo; reiniciar app → mesma aba aberta.
- [ ] **Passo 2:** FAIL → implementar → PASS. Commit `feat(editor): recarregar arquivos externos e restaurar sessão`.

---

### Tarefa 5: Modos de performance com efeito

**Arquivos:** Criar `src/renderer/scripts/perf.js`. Modificar `src/renderer/scripts/app.js`, `src/renderer/scripts/editor.js`, `src/renderer/scripts/command-palette.js`

**Interfaces:**
- `applyPerformanceMode(mode) → void`, com a tabela:

| Opção | Economia | Balanceado | Alta performance |
|---|---|---|---|
| Monaco `minimap.enabled` | false | true | true |
| `smoothScrolling` / `cursorSmoothCaretAnimation` | false / `off` | true / `on` | true / `on` |
| `bracketPairColorization` | false | true | true |
| Classe CSS no body (sem animações) | `perf-economy` | — | — |
| Polling do Git (Fase 3) | 60 s | 15 s | 5 s |
| Histórico de chat carregado | 50 msgs | 200 | 200 |

- [ ] **Passo 1:** E2E: trocar para Economia → `.minimap` não visível; voltar para Balanceado → visível.
- [ ] **Passo 2:** FAIL → implementar → PASS. Commit `feat(perf): modos de performance aplicados ao editor`.

---

### Tarefa 6: Importar configurações do VS Code / Cursor

**Arquivos:** Criar `src/main/lib/import-vscode.js`, `src/main/ipc/import.js`, `test/unit/import-vscode.test.js`. Modificar `src/renderer/scripts/migrate.js` (passa a chamar o IPC), `src/main/preload.js`

**Interfaces:**
- `vscodeUserDir(editor: 'vscode'|'cursor', platform, home) → string` (caminhos já listados em `migrate.js`).
- `mapVSCodeSettings(json: object) → Partial<settings>`: `editor.fontSize → fontSize`, `editor.tabSize → editor.tabSize`, `editor.wordWrap → editor.wordWrap`, `editor.minimap.enabled → editor.minimap`, `workbench.colorTheme` contendo `Light` → `agzos-light`, senão `agzos-dark`. Aceita JSON com comentários e vírgula sobrando (JSONC).
- IPC `import:detect() → Array<{ editor, path }>`, `import:run(editor) → { imported: string[] }`. Lê só do main (sem passar pelo path guard do renderer).

- [ ] **Passo 1:** testes: JSONC com comentários; mapeamento de cada campo; tema Light.
- [ ] **Passo 2:** FAIL → implementar → PASS. Commit `feat: importar configurações do VS Code e Cursor`.

---

### Tarefa 7: Documentação e relatório

- [ ] Atualizar docs + `ROADMAP.md`. Commit `docs: fase 4 — editor`.
- [ ] Relatório `docs/plano/relatorios/fase-4-relatorio.md`, push, PR. **Não fazer merge.**

## Critério de saída

Time usa o Agzos Code 1 semana no lugar do VS Code em projeto JS/TS sem voltar ao VS Code para terminal, busca ou Git.
