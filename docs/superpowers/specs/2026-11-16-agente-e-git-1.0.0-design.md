# Agzos Code 1.0.0 — Agzos IA agêntico + Git/GitHub

Data: 2026-11-16 · Aprovado pelo usuário em chat (versão final 1.0.0).

Dois subsistemas independentes, entregues juntos. Três frentes de implementação:
**E** motor do agente (main), **U** interface do agente (renderer), **G** Git/GitHub.

---

## A) Agzos IA agêntico

### Objetivo
O chat passa a agir: ler/editar/criar arquivos e pastas, apagar, mover, buscar no código e rodar comandos dentro da pasta do projeto aberta — para corrigir bugs, criar sites/projetos e fazer melhorias pedidas em linguagem natural.

### Modos de autonomia (selecionável no composer, salvo em `settings.aiAgent.mode`)
| modo | ler/buscar | criar/editar | apagar/mover | comando |
|---|---|---|---|---|
| `ask` (Perguntar tudo) | livre | pede OK | pede OK | pede OK |
| `edit` (Edição livre, **padrão**) | livre | livre | pede OK | pede OK |
| `auto` (Automático) | livre | livre | livre | livre |

Sempre pede OK, em qualquer modo: comando que bate em lista de risco (`rm -rf` em raiz/home/`/`, `del /s` em raiz, `format`, `mkfs`, `dd of=/dev`, `git push --force`/`-f`, `git reset --hard`, `git clean -fd`, `shutdown`, `Remove-Item -Recurse` em raiz, `curl|sh`/`iwr|iex`), e qualquer caminho fora da raiz (negado, não perguntado). "Permitir sempre nesta conversa" disponível no cartão de aprovação para a mesma ferramenta+comando.

### Ferramentas (main, todas restritas à raiz do workspace via path-guard; caminhos relativos à raiz)
- `list_dir(path, depth≤3)` · `read_file(path, offset?, limit?)` (máx 2000 linhas/256KB por chamada) · `search(query, glob?, regex?)` (ignora node_modules/.git/dist; máx 200 resultados)
- `write_file(path, content)` (cria pastas pai) · `edit_file(path, old_string, new_string, replace_all?)` (old_string precisa ser único salvo replace_all)
- `create_dir(path)` · `move_path(from, to)` · `delete_path(path)`
- `run_command(command, cwd?, timeout_s≤600)` — shell do perfil padrão (pwsh/powershell no Windows, $SHELL/bash no POSIX), ambiente limpo (`winEnv.freshEnv`), cwd dentro da raiz, saída stdout+stderr ao vivo, truncada a 30KB para o modelo (início+fim).
- Sem acesso a segredos: tool não lê o cofre; variáveis `*TOKEN*`/`*KEY*` não são enviadas ao modelo.

### Laço (E)
- Provedores ganham tool calling: OpenAI-compatível (`tools`, `tool_choice:auto`, streaming de `delta.tool_calls`) e Anthropic (`tools`, blocos `tool_use`/`tool_result`, streaming `input_json_delta`). Modelo sem suporte (erro 400 de tools) → evento `error` com código `tools_unsupported`; U oferece usar o chat normal.
- System prompt do agente: papel, raiz do projeto, SO/shell, regras (ler antes de editar, edits mínimos, rodar testes quando existirem, resumir no fim), árvore do projeto (2 níveis) no 1º turno.
- Limite 50 passos por pedido; cancelamento a qualquer momento (aborta request e mata comando em execução).
- Checkpoint por pedido: antes da 1ª modificação de cada arquivo, guarda o conteúdo original (ou "não existia") em memória + `userData/agent-checkpoints/<id>.json` (máx 20 checkpoints, 50MB). `undo(checkpointId)` restaura tudo (recria, sobrescreve, apaga criados).

### Contrato IPC (E ↔ U) — `window.agzos.agent`
- `run(requestId, { profileId, model, messages, mode })` → inicia; `messages` = histórico `{role, content}` da conversa (U mantém o histórico incluindo resumos das ações).
- `onEvent((requestId, evt) => …)` → unsubscribe. Tipos de `evt`:
  - `{type:'text', delta}`
  - `{type:'tool_start', callId, tool, input, title}` — `title` legível, ex. "Editar src/app.js"
  - `{type:'approval', callId, tool, input, preview}` — `preview`: `{diff:{path, before, after}}` para edits/criação, `{command, cwd}` para comando, `{path, kind}` para apagar/mover; aguarda `approve`
  - `{type:'tool_output', callId, chunk}` — saída ao vivo de comando
  - `{type:'tool_end', callId, ok, summary, meta}` — `meta` p/ arquivos: `{path, added, removed, created?, deleted?}`; p/ comando: `{exitCode, durationMs}`
  - `{type:'file_changed', path}` — absoluto, para o editor recarregar
  - `{type:'done', checkpointId, changes:[{path, added, removed, created?, deleted?}], steps}`
  - `{type:'error', message, code?}`
- `approve(requestId, callId, decision)` — `'allow' | 'deny' | 'allow_session'`
- `cancel(requestId)`
- `undo(checkpointId)` → `{ restored:[path], errors:[…] }`
- `setMode(mode)` (persiste em settings)
- Requer workspace aberto; sem workspace → `error` code `no_workspace`.

### Interface (U)
- Toggle no composer: **Agente** / Chat (Agente padrão quando há workspace) + seletor de modo (ícone + rótulo curto) com tooltip explicando.
- Cartões de passo compactos e premium no fluxo da resposta: ícone por ferramenta, título, status (girando/ok/erro/negado), expandir para ver input/saída; edits mostram `+N −M` e "Ver diff" (diff-view.js); comandos mostram saída ao vivo em bloco mono recolhível com exit code e duração.
- Cartão de aprovação: diff inline (ou comando com cwd), botões **Permitir** · **Permitir sempre nesta conversa** · **Negar** (atalhos Enter / Esc), destaque vermelho para comandos de risco.
- Resumo ao final: lista de arquivos alterados (clicáveis, abrem no editor) + **Desfazer tudo** (chama `undo`; confirma antes).
- Editor: ao `file_changed`, recarrega modelo do arquivo aberto se não estiver sujo; se estiver sujo, avisa conflito (mantém o do usuário, oferece recarregar).
- File tree atualiza (invalidateTree / quick open cache) a cada mudança.
- Erro `tools_unsupported` → mensagem + botão "Responder como chat".

---

## B) Git + GitHub (G)

Segue `docs/plano/execucao/fase-3-git-github.md` (git do sistema via `execFile` sem shell, `GIT_TERMINAL_PROMPT=0`, timeouts 15s/60s, token via `GIT_CONFIG_COUNT`/`http.extraheader`, tokens no cofre `github.<accountId>`, `pickAccountForRepo` por `repoAccounts`). Onde este doc e o plano divergirem, este vence.

- Painel GIT (`#panel-git`): repo atual/branch com seletor (trocar/criar branch), ahead/behind com botões Sincronizar (pull+push), Fetch; seções **Staged** e **Alterações** (status por letra/cor, clique abre diff HEAD↔working no diff-view, ações por item e em massa: stage, unstage, descartar com confirmação); caixa de mensagem + Commit (Ctrl+Enter), "Commit e Push"; Histórico (últimos 50 commits: hash curto, autor, data relativa, mensagem). Pasta sem repo → "Inicializar repositório" e "Publicar no GitHub". Git ausente → instrução de instalação.
- Barra de status: branch + indicador de alterações; clique abre o painel GIT.
- Badge na activity bar com nº de alterações. File tree: cor por status (modificado/novo/ignorado) — nice-to-have.
- Clonar: botão "Clonar Repo" da welcome (hoje morto) + comando na paleta: URL, pasta destino (diálogo), conta GitHub opcional; progresso; abre a pasta ao final.
- GitHub (Configurações → GitHub e painel GIT): adicionar conta por PAT (valida em `GET /user`, guarda no cofre, mostra login/avatar), remover, conta padrão, conta por repositório; criar repositório (nome, privado/público, descrição) a partir da pasta local e fazer push inicial; abrir Pull Request da branch atual (base, título, corpo) e abrir no navegador; reaproveitar o token salvo no onboarding (`github.onboarding`) como primeira conta.
- Segurança: token nunca vai ao renderer nem ao agente/IA; URLs com credenciais nunca logadas; comandos git com argumentos em array; caminhos validados no guard.
- Paleta: Git: Commit, Push, Pull, Fetch, Sincronizar, Criar Branch, Trocar Branch, Clonar, Publicar no GitHub, Criar Pull Request.

---

## Testes
- E: unit para cada ferramenta (guard, limites, edit único, delete/move, checkpoint/undo), lista de risco, parsing de tool calls em streaming (OpenAI e Anthropic, com fixtures), laço com provider fake (multi-passo, aprovação, negação, cancel, limite de passos).
- U: e2e com servidor fake que emite tool calls (estender `test/e2e/fake-openai.js`): criar arquivo + editar + rodar comando com aprovação; modo ask pede OK para edit; negar; desfazer tudo restaura; editor recarrega arquivo aberto.
- G: unit dos parsers (`status --porcelain=v2 -b`, log, branch) e da montagem de env/args de token; e2e em repo temporário: status, stage, commit, histórico, criar/trocar branch, push/pull para um remote bare local; clonar de bare local; GitHub com servidor HTTP fake (`AGZOS_GITHUB_API` para apontar a API) para validar PAT, criar repo e PR.
- Todas as suítes existentes continuam verdes.
