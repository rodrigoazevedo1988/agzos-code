# Fase 3 — Git e GitHub multi-conta: Plano de Implementação

> **Para o executor:** leia antes o [guia do executor](00-guia-do-executor.md). Pré-requisito: Fase 2 mergeada.

**Objetivo:** painel Git real (status, diff, stage, commit, push/pull, branches) e várias contas GitHub com troca rápida e associação por repositório.

**Arquitetura:** o main executa o `git` do sistema com `execFile` (sem shell). O token da conta vai para o git **por variável de ambiente** (`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` com `http.https://github.com/.extraheader`), nunca por argumento de linha de comando (visível no `ps`) nem gravado em `.git/config`.

**Stack:** `git` CLI ≥ 2.31 (exigido pelo `GIT_CONFIG_COUNT`), API REST do GitHub.

**Branch:** `feat/fase-3-git`

## Restrições globais

- Sem dependência nova (nada de `simple-git`/`isomorphic-git`).
- Toda chamada git: `GIT_TERMINAL_PROMPT=0`, timeout de 60 s (push/pull) ou 15 s (demais).
- Tokens: secret store, chave `github.<accountId>`. Settings guardam só `{ id, login, name, avatarUrl }`.

## Foco de revisão

1. Pasta aberta não é repositório git → painel mostra `Esta pasta não é um repositório Git` e botão `Inicializar repositório`.
2. `git` não instalado → mensagem `Git não encontrado. Instale o Git e reinicie o Agzos Code.`
3. Push rejeitado (non-fast-forward) → mensagem do git legível, sugestão de `Pull`.
4. Token revogado → push falha com 401/403 → `Token da conta <login> inválido. Atualize em Contas GitHub.`
5. Nome de arquivo com espaço, acento ou renomeado → aparece certo no status e no diff.

---

### Tarefa 1: Runner de git e parser de status

**Arquivos:** Criar `src/main/git/run.js`, `src/main/git/status.js`, `test/unit/git-status.test.js`, `test/unit/git-run.test.js`

**Interfaces:**
- Produz:
  - `runGit(cwd: string, args: string[], { token?: string, timeoutMs = 15000, execFileImpl } = {}) → Promise<{ stdout: string, stderr: string }>`. Erro: `GitError` com `{ code, stderr, message }`. `ENOENT` → mensagem `Git não encontrado…`.
  - `authEnv(token) → object` — `{ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic ' + base64('x-access-token:' + token) }`.
  - `parseStatusV2(output: string) → { branch: string|null, upstream: string|null, ahead: number, behind: number, files: Array<{ path, origPath?: string, index: string, worktree: string, untracked: boolean, conflicted: boolean }> }` — para `git status --porcelain=v2 --branch -z`.
  - `getStatus(cwd) → Promise<ReturnType<parseStatusV2> | { notRepo: true }>`.

- [ ] **Passo 1:** testes do parser com saídas fixas (`-z`, separador `\0`): branch + ahead/behind; arquivo modificado; renomeado (`2 R.`) com `origPath`; untracked `?`; conflito `u`; nome com espaço e acento; detached HEAD (`branch: null`).
- [ ] **Passo 2:** testes do runner com repositório real temporário (`git init` em `mkdtemp`): `getStatus` lista arquivo novo como untracked; pasta sem git → `{ notRepo: true }`; `authEnv` não coloca o token nos `args` (inspecionar chamada com `execFileImpl` falso).
- [ ] **Passo 3:** FAIL → implementar → PASS.
- [ ] **Passo 4:** commit `feat(git): runner e parser de status`.

---

### Tarefa 2: Operações git e IPC

**Arquivos:** Criar `src/main/git/ops.js`, `src/main/ipc/git.js`, `test/unit/git-ops.test.js`. Modificar `src/main/main.js`, `src/main/preload.js`

**Interfaces:**
- Produz (`ops.js`, todas `async`, `cwd` passa pelo path guard no IPC):
  `init(cwd)`, `stage(cwd, paths[])`, `unstage(cwd, paths[])`, `discard(cwd, paths[])` (pede confirmação na UI), `commit(cwd, message)`, `showHead(cwd, path) → string` (conteúdo no HEAD, `''` se novo), `branches(cwd) → { current, local: string[] }`, `checkout(cwd, branch)`, `createBranch(cwd, name)`, `push(cwd, { token })`, `pull(cwd, { token })` (`--ff-only`), `remoteUrl(cwd) → string|null`.
- IPC: `git:<nome>` para cada função; `push`/`pull` resolvem o token pela conta associada ao repositório (Tarefa 4).
- Preload: `agzos.git.*` com os mesmos nomes.

- [ ] **Passo 1:** testes com repo temporário: `stage + commit` cria commit; `unstage` volta; `showHead` devolve versão commitada; `createBranch + checkout`; `pull --ff-only` contra um repo "remoto" local (`git clone` de outro temp dir) traz commit novo.
- [ ] **Passo 2:** FAIL → implementar → PASS.
- [ ] **Passo 3:** commit `feat(git): operações e IPC`.

---

### Tarefa 3: Painel Git e branch na status bar

**Arquivos:** Criar `src/renderer/scripts/git-panel.js`, `test/e2e/git.spec.js`. Modificar `src/renderer/index.html` (`#panel-git`), `src/renderer/styles/app.css`, `src/renderer/scripts/app.js`, `src/renderer/scripts/diff-view.js` (só se precisar de ajuste; o normal é apenas importar)

**Interfaces:**
- Produz: `setupGitPanel()`, `refreshGit() → Promise<void>`.
  - Seções `Alterações preparadas` e `Alterações`, com ícone de status (M, A, D, R, U, ?).
  - Clique no arquivo → `showDiff({ title: <path>, original: showHead(...), modified: conteúdo atual do disco, language, readOnly: true })` (de `diff-view.js`, Fase 2).
  - Botões por arquivo: `+` (stage), `−` (unstage), `↺` (descartar, com confirmação).
  - Caixa de mensagem + `Commit` (Ctrl/Cmd+Enter). Botões `Pull` e `Push`.
  - Atualiza ao salvar arquivo, ao focar a janela e ao abrir o painel.
  - `#status-remote` mostra branch real + `↑ahead ↓behind`; clique abre lista de branches (troca/cria) via Command Palette.
  - Remover o texto mock `↑0 ↓0` fixo de `index.html`.

- [ ] **Passo 1:** E2E: repo temporário com 1 commit; abrir pasta (via `__agzosAllowRoot` + `openWorkspace`); editar e salvar arquivo; painel lista o arquivo; stage; commit `teste`; painel vazio; `git log -1 --format=%s` = `teste`; status bar mostra a branch.
- [ ] **Passo 2:** FAIL → implementar → PASS.
- [ ] **Passo 3:** commit `feat(git): painel de controle de versão`.

---

### Tarefa 4: Contas GitHub e associação por repositório

**Arquivos:** Criar `src/main/github/accounts.js`, `src/main/ipc/github.js`, `src/renderer/scripts/github-accounts.js`, `test/unit/github-accounts.test.js`, `test/e2e/github.spec.js`. Modificar `src/main/preload.js`, `src/renderer/scripts/onboarding.js` (passo GitHub), `src/renderer/scripts/app.js` (Configurações → seção Contas GitHub)

**Interfaces:**
- Produz:
  - `normalizeRemote(url: string) → string|null` — `git@github.com:Org/Repo.git`, `https://github.com/Org/Repo(.git)`, `ssh://git@github.com/Org/Repo` → `github.com/org/repo`; não-GitHub → `null`.
  - `validateToken(token, { fetchImpl = fetch, apiBase = 'https://api.github.com' }) → Promise<{ id: string, login, name, avatarUrl }>` (`GET /user`, header `Authorization: Bearer`). 401 → `Error('Token inválido ou expirado')`.
  - `pickAccountForRepo(settings, remoteKey) → accountId|null` — usa `settings.github.repoAccounts[remoteKey]`; senão a conta cujo `login` (minúsculo) é o dono do repo; senão `null`.
  - IPC: `github:accounts`, `github:addPat(token)` (valida, salva token em `github.<id>`, adiciona à lista), `github:remove(id)`, `github:assign(remoteKey, accountId)`, `github:accountForCwd(cwd)`.
  - `github.onboarding` (Fase 1) é migrado no boot: valida e vira conta normal; se inválido, apaga.
  - Status bar: item `#status-github` com `@login` da conta do repositório atual; clique abre lista: contas + `Adicionar conta…` + `Usar esta conta neste repositório`.
  - `push`/`pull` sem conta resolvida → `Associe uma conta GitHub a este repositório.` com botão que abre o seletor.

- [ ] **Passo 1:** testes unitários: `normalizeRemote` (4 formatos + não-GitHub); `pickAccountForRepo` (mapeamento explícito ganha; fallback pelo dono; nenhum → null); `validateToken` com fetch falso (200 e 401).
- [ ] **Passo 2:** E2E: servidor falso para `GET /user` (variável `AGZOS_GITHUB_API` lida pelo main só com `AGZOS_TEST=1`); adicionar 2 contas por PAT; associar a um repo com remote `https://github.com/org-b/x.git`; `#status-github` mostra a conta associada; `settings.json` não contém tokens.
- [ ] **Passo 3:** FAIL → implementar → PASS.
- [ ] **Passo 4:** commit `feat(github): múltiplas contas e associação por repositório`.

---

### Tarefa 5 (opcional, depende do Rodrigo): Login com GitHub (Device Flow)

Precisa de um **GitHub OAuth App** da Agzos (`client_id`). Se o `client_id` não estiver em `docs/plano/execucao/fase-3-git-github.md` quando você chegar aqui, **pule a tarefa** e registre no relatório.

**Interfaces:**
- `startDeviceFlow(clientId) → { userCode, verificationUri, poll(): Promise<token> }` (`POST https://github.com/login/device/code`, scope `repo read:user`; polling em `https://github.com/login/oauth/access_token` respeitando `interval` e `slow_down`).
- UI: mostra o código, botão `Abrir GitHub` (`openExternal`), aguarda e adiciona a conta como no PAT.

---

### Tarefa 6: Documentação e relatório

- [ ] Atualizar `docs/tecnico/arquitetura.md` (Git: como o token chega ao git), `README.md`, `ROADMAP.md`. Commit `docs: fase 3 — git e github`.
- [ ] Relatório `docs/plano/relatorios/fase-3-relatorio.md`, push, PR `Fase 3 — Git e GitHub`. **Não fazer merge.**

## Critério de saída

Rodrigo faz commit e push em 2 repositórios de contas GitHub diferentes sem configurar credencial manualmente. CI verde.
