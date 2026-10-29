# Backlog de melhorias por fases — Agzos Code

**Versão:** 1.2 (aprovada e em execução)
**Data:** 28/10/2026
**Base analisada:** `main` @ `4d086e9` + PR #3 (mergeado em `d203eed`); Electron 44 aplicado na Fase 1.5
**Status:** aprovado em 28/10/2026 — **Fase 1.5 concluída em código/testes; falta teste manual no Mac e PR**

> Este documento **não substitui** o [ROADMAP](ROADMAP.md) nem os [planos de execução](execucao/). Ele responde a três perguntas: **o que está quebrado hoje**, **o que entra em cada fase** e **em que ordem**.

**Decisões aprovadas:** Fase 1.5 completa antes da Fase 2; PR #3 mergeado; multi-janela removida e view “Extensões” vira “Integrações Agzos” (ADR-0001); Electron 44 + builds Windows/Linux/macOS ([ADR-0002](../decisoes/ADR-0002-electron-e-codigo-nativo.md)); código nativo C#/.NET ou Swift só como helper opcional, não como reescrita.

**Entregue na 1.5:** PR #3, Electron 44 + electron-builder 26, assinatura local macOS, dirty close, encoding/EOL/binário, diálogos internos, explorer/busca, status bar/temas, logs/error boundary/hardening, workflow de build e documentação. Ver [relatório](relatorios/fase-1-5-relatorio.md).

---

## 1. Resumo para decisão

O Agzos Code terminou a Fase 1 com uma base boa: processo principal modular, `contextIsolation`, cofre de segredos, path guard, testes unitários e E2E, CI e documentação disciplinada. O problema não é a fundação — é que **a experiência ainda não é confiável para uso diário** e algumas telas prometem coisas que o código não faz.

A auditoria encontrou **três problemas críticos — dois deles com perda de dados** — e alguns recursos quebrados em fluxos básicos:

1. **Fechar a janela ou sair do app descarta alterações não salvas sem perguntar.**
2. **Arquivos que não são UTF-8 (Latin-1, UTF-16) e arquivos binários são corrompidos ao abrir e salvar.** Testei: `café ação` em Latin-1 virou `caf� a��o`, e os bytes originais foram substituídos por `EF BF BD` ao salvar.
3. **Criar arquivo, criar pasta e renomear usam `window.prompt()`, que o Electron não suporta.** No app rodando, a chamada lança `prompt() is and will not be supported.`

Além disso: arquivos ocultos (`.env`, `.github`) não aparecem no Explorer nem na busca; clicar num resultado de busca não leva à linha; renomear um arquivo aberto deixa aba órfã; os ícones da status bar somem; o tema Monokai não é real; botões do welcome e passos do onboarding não têm efeito; e a janela “Nova Janela” não tem isolamento por janela.

**Recomendação:** incluir uma **Fase 1.5 — Confiança e integridade (2–2,5 semanas)** antes da Fase 2 (IA). A IA vai gerar edições que o usuário salva; construir isso sobre um editor que corrompe encoding e perde alterações ao fechar é caro e desgastante. Os planos das Fases 2–5 continuam válidos, com os ajustes listados adiante.

| Caminho | Fases | Esforço de execução | Observação |
|---|---|---|---|
| **Recomendado** | 1.5 → 2 → 3 → 4 → 5 | ~12–14,5 semanas + 1,5–2 de revisão/teste | v1.0 em meados/fim de fevereiro de 2027 |
| Alternativo | 1.5 só P0 (2 semanas) → 2 → 3 → 4 → 5 | ~12–14 semanas | 1.7–1.8 entram na Fase 4; v1.0 ~1 semana antes |

**O que não muda:** base Electron + Monaco (ADR-0001), sem extensões do VS Code, sem telemetria, uma fase por vez e revisão sênior antes do merge. O que muda é a **ordem**: primeiro confiança, depois IA.

Contra a estimativa original de 9–12 semanas, este plano custa **~2,5–3 semanas a mais** — a Fase 1.5 e os deltas das fases 2–5. É o preço de não construir IA sobre um editor que perde trabalho.

**O que peço aprovar:** a Fase 1.5 e as 8 decisões da [seção 6](#6-decisões-que-preciso-de-você). Se preferir o caminho alternativo (só P0), diga quais itens da 1.5 vão para a Fase 4.

---

## 2. Diagnóstico

### 2.1 O que está sólido (não mexer sem motivo)

- **Segurança de processo:** `contextIsolation: true`, `nodeIntegration: false`, preload mínimo, IPC explícito em [`preload.js`](../../src/main/preload.js).
- **Path guard:** acesso a arquivos restrito às raízes liberadas, com `realpath` e bloqueio de symlink para fora ([`path-guard.js`](../../src/main/lib/path-guard.js)). O bypass de `recentFolders` foi fechado na revisão da Fase 1.
- **Cofre:** API keys e tokens no `safeStorage`, sem `secrets:get`; o renderer nunca lê o valor ([`secrets.js`](../../src/main/lib/secrets.js)).
- **Settings:** defaults, leitura tolerante, escrita atômica e backup de JSON corrompido ([`settings.js`](../../src/main/lib/settings.js)).
- **Testes e CI (no início da 1.5):** 19 testes unitários e 11 E2E, `npm run check` com 0 erros, CI verde no `main` e no PR #3. Ao fim da 1.5: 39 unitários e 16 E2E.
- **Documentação:** PRD, ADR-0001, arquitetura, troubleshooting e guia do executor. É mais disciplina do que a maioria dos projetos internos tem.

### 2.2 Achados que mudam a ordem do roadmap

Severidade: **P0** = perda de dados ou fluxo básico quebrado; **P1** = alto atrito/segurança; **P2** = polimento ou dívida.

| # | Achado | Sev. | Evidência | Corrige em |
|---|---|---|---|---|
| 1 | Fechar janela/`Cmd+Q`/`Cmd+W` descarta alterações sem perguntar | P0 | Não existe handler de `close`/`before-quit` em [`main.js`](../../src/main/main.js); o confirm de dirty só existe no fechamento de aba em [`editor.js`](../../src/renderer/scripts/editor.js) | 1.2 |
| 2 | Encoding não-UTF-8 e binários são corrompidos ao salvar | P0 | [`fs.js:32`](../../src/main/ipc/fs.js#L32) e [`fs.js:39`](../../src/main/ipc/fs.js#L39) forçam UTF-8; teste com Latin-1 e PNG mostrou substituição por `U+FFFD` | 1.3 |
| 3 | `prompt()` não existe no Electron: novo arquivo/pasta/renomear não funcionam | P0 | 5 chamadas ([`app.js:372`](../../src/renderer/scripts/app.js#L372), [`app.js:384`](../../src/renderer/scripts/app.js#L384), [`file-tree.js:164`](../../src/renderer/scripts/file-tree.js#L164), [`file-tree.js:184`](../../src/renderer/scripts/file-tree.js#L184), [`file-tree.js:191`](../../src/renderer/scripts/file-tree.js#L191)); no app rodando: `prompt() is and will not be supported.` | 1.4 |
| 4 | Renomear arquivo aberto deixa aba órfã/duplicada e pode salvar no caminho antigo | P0 | [`file-tree.js:169`](../../src/renderer/scripts/file-tree.js#L169) adiciona a chave nova mas não remove a antiga, não atualiza `file.path` nem `State.activePath` | 1.4 |
| 5 | Arquivos ocultos somem do Explorer e da busca | P1 | [`fs.js:16`](../../src/main/ipc/fs.js#L16) filtra tudo que começa com `.` exceto `.gitignore`; teste: `.env` e `.github` ausentes | 1.5 |
| 6 | Clicar num resultado de busca não pula para a linha | P1 | [`app.js:136`](../../src/renderer/scripts/app.js#L136) expõe só `openFile`/`saveActive`; [`search.js:65`](../../src/renderer/scripts/search.js#L65) chama `getActiveEditor()`, que é `undefined` | 1.5 |
| 7 | Ícones da status bar são apagados ao atualizar o texto | P2 | [`app.js:217`](../../src/renderer/scripts/app.js#L217), [`app.js:235`](../../src/renderer/scripts/app.js#L235), [`app.js:281`](../../src/renderer/scripts/app.js#L281) usam `textContent` no host do ícone; no app, `#status-perf` fica só com o texto “Balanceado” | 1.6 |
| 8 | Monokai não é um tema real | P1 | [`editor.js:291`](../../src/renderer/scripts/editor.js#L291) mapeia qualquer coisa que não seja `agzos-light` para `agzos-dark`; teste: fundo continua `rgb(14, 14, 14)` | 1.6 |
| 9 | Welcome e onboarding têm controles sem efeito | P1 | [`welcome.js:167`](../../src/renderer/scripts/welcome.js#L167) procura `#welcome-open-file`/`#welcome-clone`, que não existem; layout/densidade do onboarding são salvos em `answers` mas nunca aplicados | 1.6 |
| 10 | “Nova Janela” cria janela sem isolamento; menus vão para a última janela | P1 | [`main.js:134`](../../src/main/main.js#L134) chama `createMainWindow()`, mas o menu usa a global `mainWindow` ([`main.js:139`](../../src/main/main.js#L139), [`main.js:145`](../../src/main/main.js#L145), [`main.js:164`](../../src/main/main.js#L164)); `closed` de qualquer janela zera a global | 4.2 |
| 11 | Electron 32 fora de suporte desde 03/03/2025 | P1 (segurança) | [`package.json`](../../package.json) fixa `electron@^32.0.0` (instalado 32.3.3, Chromium 128); [endoflife.date/electron](https://endoflife.date/electron): EOL em 2025-03-03 | 4.0 |
| 12 | Dependências de build vão para o pacote final | P2 | `monaco-editor` (98 MB), `lucide-static` (65 MB) e `xterm` (2,5 MB) estão em `dependencies`; o renderer usa as cópias de `src/renderer/vendor/` (14 MB + 1 MB + 292 KB) | 5.2 |
| 13 | Documentação promete coisas que o código não faz | P2 | README fala em “Fase 0”, “fork do Code-OSS”, “Monokai”, “Open VSX” e “keytar”; ROADMAP diz que a Fase 1 aguarda merge, mas já foi mergeada | 1.8 |

### 2.3 Promessas x realidade

| Tela / doc | O que promete | O que entrega hoje | Encaminhamento |
|---|---|---|---|
| Agzos IA | Chat com providers | Stub com resposta mock; a chave é salva, mas não é usada | Fase 2 (rotular “em breve” até lá) |
| Git | Painel de controle de versão | Placeholder; `↑0 ↓0` fixo na status bar | Fase 3 (remover o mock antes) |
| Extensões | “Open VSX será plugado” | Placeholder | Decisão 4: renomear para Integrações Agzos ou ocultar |
| Temas | Agzos Dark, Light e Monokai | Monokai cai no Dark | 1.6 |
| Status bar | Encoding, EOL, branch | Encoding/EOL fixos; branch é ícone sem texto | 1.3/1.6 e Fase 3 |
| Onboarding | Migrar configurações, escolher layout | Migração é stub; layout/densidade não são aplicados | 1.6 |
| Builds | Instaladores multiplataforma | Scripts locais; sem workflow de release | Fase 5 |

### 2.4 O que verifiquei e está funcionando

- **IntelliSense de TypeScript:** abri `a.ts` com `const x: number = "texto";` e o Monaco gerou o marcador `Type 'string' is not assignable to type 'number'.` Funciona, mesmo sem `MonacoEnvironment` explícito. A Fase 4 T1 deve **medir e oficializar** o uso de workers, não “consertar do zero”.
- **Path guard:** leitura fora da raiz liberada retorna `Acesso negado`; dentro funciona. Coberto por E2E.
- **Cofre:** `ai.legacy` é migrado para `secrets.json` cifrado; o valor não volta ao renderer.
- **Settings:** JSON corrompido vira backup; escrita atômica sem sobrar `.tmp`.
- **CI (no início da 1.5):** `lint` + 19 unitários + 11 E2E verdes (Linux/Xvfb). PR #3 também verde.

---

## 3. Backlog por fases

### Convenções

- **P0:** bloqueia uso diário ou pode perder/corromper trabalho.
- **P1:** alto atrito, segurança ou dívida que encarece as fases seguintes.
- **P2:** polimento; pode ir para pós-v1.0 sem drama.
- **Esforço:** ordem de grandeza em dias de **um** executor, com testes e commit. Não é compromisso; serve para comparar itens.
- **Tipo:** `[novo]` = não está nos planos atuais; `[plano]` = já existe em `docs/plano/execucao/`; `[ajuste]` = muda algo do plano existente.

---

### Fase 1.5 — Confiança e integridade (2–2,5 semanas / 12–13 dias de esforço) — **nova**

**Objetivo:** o editor não perde trabalho, não corrompe arquivo, não mente na interface e não quebra em fluxos básicos. É o gate para a Fase 2.

**Não é objetivo:** terminal com pty, Git, IA, busca com ripgrep, multi-janela completa. Isso fica nas fases seguintes.

| # | Item | Tipo | P | Esf. | Pronto quando |
|---|---|---|---|---|---|
| 1.1 | Revisar e mergear o PR #3 (árvore vertical + temas de ícones) | novo | P0 | 0,5d | Árvore expande na vertical; clique abre arquivo; menu de contexto em arquivo cria irmão no diretório certo; CI verde; teste E2E do PR passa |
| 1.2 | Proteção de alterações não salvas | novo | P0 | 2d | Fechar janela, `Cmd+Q` e `Cmd/Ctrl+W` pedem **Salvar tudo / Descartar / Cancelar**; cancelar mantém a janela; salvar grava todos os dirty; título mostra `●`; E2E cobre os três caminhos |
| 1.3 | Integridade de arquivos: encoding, EOL e binário | novo | P0 | 2,5d | Main lê `Buffer`, detecta BOM/UTF-8/UTF-16LE/BE, valida UTF-8 e detecta binário; arquivo não suportado abre **somente leitura** com opção explícita de conversão; salvar preserva encoding/EOL e grava de forma atômica (tmp+rename, permissões preservadas); nenhum `U+FFFD` é gravado em silêncio; fixtures cobrem UTF-8, BOM, UTF-16, CRLF, LF, Latin-1 e PNG |
| 1.4 | Diálogos internos e operações de arquivo consistentes | novo | P0 | 2d | `prompt()` some; modal interno com validação (vazio, `/`, `..`, nome existente), Enter/Escape e foco; renomear atualiza Map, `path`, `activePath` e aba; excluir fecha a aba; “Revelar no SO” usa `shell.showItemInFolder`; nomes com espaço/acento testados |
| 1.5 | Explorer e busca sem esconder o que importa | novo | P0 | 1,5d | `fs:readDir` devolve tudo; UI mostra `.env`, `.github`, `.vscode`, `.editorconfig` e `.gitignore`; `node_modules`, `.git`, `dist` etc. ficam ocultos por padrão com toggle; busca inclui dotfiles; clique no resultado posiciona linha/coluna e destaca o termo; busca antiga é cancelada |
| 1.6 | Status bar, temas e honestidade da UI | novo | P0 | 1,5d | Ícone e texto ficam em nós separados; encoding/EOL refletem o arquivo (1.3); `↑0 ↓0` fake some; Monokai é um tema real ou sai da UI; checkbox de telemetria some; Extensões/Output/Problemas ficam ocultos ou claramente “em breve”; IA ganha aviso “em breve” até a Fase 2; “Sobre” deixa de dizer “fork do Code-OSS”; botões mortos do welcome são ligados ou removidos |
| 1.7 | Robustez, logs e hardening | novo | P1 | 1,5d | Erro no renderer mostra overlay com “Recarregar” e “Copiar diagnóstico”, não tela preta; `userData/logs/main.log` com rotação; menu Ajuda → “Abrir logs”; splash tem timeout; `sandbox: true` na janela (com preload compatível) ou justificativa registrada; permission handler nega tudo; webviews bloqueados; `fs:delete` não apaga a raiz liberada; nenhum segredo no log |
| 1.8 | Docs, versão e changelog | novo | P1 | 1d | README/PRD/ROADMAP/arquitetura batem com o código; somem “Fase 0”, “fork”, “Open VSX”, “keytar”, “Monokai” falso; versão 0.2.0; `CHANGELOG.md`; template de PR com checklist do relatório |

**Ordem sugerida:** 1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7 → 1.8. O 1.3 é o mais arriscado; se escorregar, 1.4–1.6 não dependem dele (só a status bar de encoding).

**Critério de saída da 1.5:**

- Nenhum caminho conhecido de perda de dados no checklist manual.
- `npm run check` com 0 erros; idealmente 0 warnings.
- E2E novos verdes: dirty-close, encoding, novo/renomear, dotfiles, busca, status bar.
- Teste manual no Mac feito pelo Rodrigo (a lista da Fase 1 continua pendente e entra aqui).
- PR com relatório; sem merge.

**Fora do escopo da 1.5:** reconstruir abas com modelos persistentes, CLI, hot exit, Electron novo, tema Monokai “bonito”, layout do onboarding aplicado. Vai para a Fase 4 (ou 1.6, se você preferir dividir).

---

### Fase 2 — IA nativa (3–3,5 semanas) — **plano existente mantido**

**Plano:** [`fase-2-ia.md`](execucao/fase-2-ia.md) — 11 tarefas (SSE, provider OpenAI-compatible, Anthropic, perfis, IPC com streaming/cancelamento, fake server, wizard, chat, contexto, aplicar com diff, docs).

O plano está bom e detalhado. **Não reescrever.** Deltas propostos:

| # | Delta | Tipo | P | Esf. | Pronto quando |
|---|---|---|---|---|---|
| 2.1 | Aviso de cofre indisponível no wizard | ajuste | P0 | 0,5d | Em Linux sem keyring, o wizard explica que a chave não pode ser salva e bloqueia o “Concluir” com instrução, em vez de falhar no meio |
| 2.2 | Privacidade do histórico de chat | novo | P1 | 1d | “Nova conversa”, “Limpar histórico” e “Exportar” funcionam; opção “não salvar histórico”; conversas antigas por workspace; nenhum segredo em log |
| 2.3 | Resiliência de provider | novo | P1 | 1d | 429 mostra “Tentar de novo”; lista de modelos tem cache e “Atualizar”; timeout de 15 s até o primeiro byte testado; erro de rede não trava a UI |
| 2.4 | Aplicar diff compatível com 1.3 | ajuste | P0 | 0,5d | Aplicar código em arquivo Latin-1/binário/somente-leitura é bloqueado com mensagem clara; aplicar marca dirty e entra no Ctrl+Z sem salvar |
| 2.5 | E2E de segurança e falha | ajuste | P0 | 1d | Fake server com 401/429; HTML com `<img onerror>` não executa; “Parar” mantém parcial com `(interrompida)`; fechar janela durante streaming não lança exceção |
| 2.6 | Custo/contexto visível (opcional) | novo | P2 | 1d | Rodapé do chat mostra modelos, tokens aproximados e “contexto truncado”; pode ir para pós-v1.0 |

**Critério de saída (mantido):** com uma chave Groq gratuita, configurar em menos de 2 min, conversar com streaming, refatorar e aplicar num arquivo real; CI verde; teste manual no Mac.

---

### Fase 3 — Git e GitHub multi-conta (2–2,5 semanas) — **plano existente mantido**

**Plano:** [`fase-3-git-github.md`](execucao/fase-3-git-github.md) — 6 tarefas (runner/parser, operações/IPC, painel/branch, contas/associação, Device Flow opcional, docs).

| # | Delta | Tipo | P | Esf. | Pronto quando |
|---|---|---|---|---|---|
| 3.1 | Limites de diff e binários | novo | P1 | 0,5d | Diff de arquivo > 5 MB ou binário mostra aviso e não trava; rename com espaço/acento aparece certo |
| 3.2 | Polling respeita modo de performance | ajuste | P1 | 0,5d | Economia 60 s, Balanceado 15 s, Alta 5 s (tabela já prevista na Fase 4); sem polling com janela oculta |
| 3.3 | Diagnóstico de Git | ajuste | P1 | 0,5d | `git` ausente, versão < 2.31 e pasta não-repo têm mensagens acionáveis, sem stack trace |
| 3.4 | Pull request pela API (opcional) | novo | P2 | 1,5d | “Criar PR” abre o GitHub com título/corpo preenchidos; se ficar caro, vai para pós-v1.0 |
| 3.5 | Identidade de commit por conta (opcional) | novo | P2 | 0,5d | `user.name`/`user.email` por repositório/conta, sem gravar token em `.git/config` |
| 3.6 | E2E de contas e erros | ajuste | P0 | 1d | 2 contas, associação por repo, token revogado (401/403), push rejeitado (non-fast-forward) com sugestão de Pull |

**Critério de saída (mantido):** commit e push em 2 repositórios de contas diferentes sem configurar credencial à mão; token nunca em `ps`, log ou `settings.json`.

---

### Fase 4 — Editor completo (3–3,5 semanas) — **plano existente + dívida adiada**

**Plano:** [`fase-4-editor.md`](execucao/fase-4-editor.md) — 7 tarefas (IntelliSense/workers, terminal com pty, ripgrep/Quick Open, watcher/sessão, performance, importar VS Code, docs).

| # | Delta | Tipo | P | Esf. | Pronto quando |
|---|---|---|---|---|---|
| 4.0 | Atualizar Electron para 44.x (ADR-0002) | novo | P0 | 1,5d | App, cofre, empacotamento e E2E verdes na versão nova; `safeStorage` validado no Mac; decisão registrada; **fazer antes do node-pty** para não recompilar nativo duas vezes |
| 4.1 | Um modelo Monaco por arquivo, com undo/cursor/scroll preservados | novo | P1 | 1d | Editar A, ir para B, voltar para A e desfazer funciona; cursor e scroll voltam; trocar de aba não recria o modelo; digitação não reconstrói todas as abas a cada tecla |
| 4.2 | Instância única, remover “Nova Janela” e abrir por CLI | novo | P1 | 1d | Segunda execução foca a janela existente; “Nova Janela” some (ou passa a ter roteamento por janela, se a decisão for outra); `agzos .` abre a pasta; “Abrir recente” lista as pastas salvas |
| 4.3 | Hot exit / backup de dirty | novo | P1 | 1d | Fechar/crash com aba dirty oferece restaurar o conteúdo na próxima abertura; backups em `userData/backups` com limite |
| 4.4 | Configurações de editor que faltam | novo | P1 | 1d | Tab size, word wrap, auto-save, “mostrar ocultos”, fonte e tema aplicados e persistidos; “Abrir settings.json” para edição crua |
| 4.5 | Terminal: cwd do workspace, abas e links | ajuste | P1 | 1d | Terminal abre na pasta aberta; “Novo terminal” cria aba; links abrem no browser; `vim`/`htop`/`Ctrl+C`/resize funcionam (pty da T2) |
| 4.6 | Tema Monokai e consistência de temas | ajuste | P2 | 0,5d | Monokai define cores no Monaco e no CSS; trocar tema não deixa resíduo; welcome/onboarding refletem o tema |
| 4.7 | Welcome: abrir arquivo e clonar repo | ajuste | P2 | 0,5d | Botões chamam as ações reais ou somem; “Clonar Repo” só aparece quando a Fase 3 estiver pronta |

**Critério de saída (mantido):** o time usa o Agzos Code uma semana no lugar do VS Code num projeto JS/TS, sem voltar para terminal, busca ou Git.

---

### Fase 5 — Distribuição e v1.0 (2–2,5 semanas) — **plano existente + ajustes**

**Plano:** [`fase-5-distribuicao.md`](execucao/fase-5-distribuicao.md) — 5 tarefas (release por tag, auto-update, privacidade, assinatura opcional, v1.0.0).

| # | Delta | Tipo | P | Esf. | Pronto quando |
|---|---|---|---|---|---|
| 5.1 | Identidade do app no pacote | novo | P1 | 0,5d | `setAppUserModelId` no Windows; painel “Sobre” com versão/commit; ícone da janela no app empacotado; `LICENSE` incluída |
| 5.2 | Pacote enxuto | ajuste | P1 | 0,5d | `npm run pack` gera asar sem as deps de build (monaco/lucide/xterm); tamanho medido e orçado no CI |
| 5.3 | Diagnóstico no app | novo | P1 | 0,5d | “Sobre” mostra versão, Electron, plataforma e botão “Abrir logs”; “Copiar diagnóstico” para suporte |
| 5.4 | Checklist de release e rollback | novo | P1 | 0,5d | `CHANGELOG`, tag, draft, smoke instalado, plano de rollback e aviso de app não assinado no Mac |
| 5.5 | CI de release e artefatos | ajuste | P0 | 1d | `release.yml` em matriz macOS/Windows/Linux; draft com DMG/ZIP, NSIS/portable, AppImage/DEB/RPM e `latest*.yml`; Ubuntu pinado; actions atualizadas |
| 5.6 | Privacidade e dados | ajuste | P1 | 0,5d | Texto fixo “sem telemetria”; “Apagar dados” limpa settings/secrets/chats; checkbox de telemetria já removido na 1.6 |

**Critério de saída (mantido):** tag `v1.0.0` gera draft com os três instaladores; Windows/Linux atualizam de 1.0.0 para 1.0.1; macOS avisa da versão nova; zero segredo no repositório.

---

### Fase 6 — Pós-v1.0 (não agendada)

Ordem sugerida, sem compromisso de data:

1. **Integrações Agzos:** Agzos Key (SSO), Browser (links/preview), Project/Hub (contexto no chat).
2. **LSP para outras linguagens:** `monaco-languageclient` + servidores (Python, Go, PHP).
3. **Agent:** edição multi-arquivo e comandos com aprovação explícita.
4. **Colaboração/Freemium:** billing, créditos, indexação de codebase, times.
5. **Reavaliar ADR-0001** se compatibilidade com extensões virar requisito de negócio.

---

## 4. Sequência, esforço e calendário

### 4.1 Esforço por fase

| Fase | Esforço (execução) | Marco sugerido |
|---|---|---|
| 1.5 — Confiança | 2–2,5 semanas | `v0.2.0` para dogfooding interno |
| 2 — IA | 3–3,5 semanas | `v0.3.0` IA beta |
| 3 — Git/GitHub | 2–2,5 semanas | `v0.4.0` Git integrado |
| 4 — Editor completo | 3–3,5 semanas | `v0.5.0` editor “completo” |
| 5 — Distribuição/v1.0 | 2–2,5 semanas | `v1.0.0` |
| **Total de execução** | **12–14,5 semanas** | — |
| Revisão sênior + teste manual no Mac | +1,5–2 semanas distribuídas | — |

A conta usa o **limite inferior** se os deltas P2 forem para o pós-v1.0 e o **limite superior** se todos os deltas P1 entrarem. O cenário abaixo usa o limite inferior; se a 1.5 usar 2,5 semanas, tudo desloca alguns dias.

### 4.2 Cenário de calendário (se começar em 02/11/2026)

| Período | Fase |
|---|---|
| 02–13/11/2026 | 1.5 — Confiança |
| 16/11–04/12/2026 | 2 — IA |
| 07–18/12/2026 | 3 — Git/GitHub |
| 21/12/2026–01/01/2027 | Recesso / buffer |
| 04–22/01/2027 | 4 — Editor completo |
| 25/01–05/02/2027 | 5 — Distribuição |
| Semana de 08/02/2027 | `v1.0.0` |

Se as fases usarem o limite superior (deltas P1 todos dentro), o fim escorrega para a **semana de 22/02/2027**. É um cenário, não um compromisso. Depende de **um executor**, revisão semanal e teste manual no Mac entre fases. Se a revisão atrasar, o calendário anda junto.

### 4.3 Definição de pronto (global)

- `npm run check`: 0 erros; meta de 0 warnings.
- E2E verde no Linux e no macOS (ou checklist manual documentado, quando o E2E não rodar).
- Nenhum segredo em `settings.json`, log, toast ou mensagem de erro.
- Relatório da fase em `docs/plano/relatorios/` e PR com o relatório no corpo; sem merge automático.
- Documentação atualizada no mesmo PR (README, ROADMAP, arquitetura, troubleshooting).
- Nenhum controle visível sem efeito: ou funciona, ou está claramente marcado como “em breve”, ou não aparece.

---

## 5. Riscos e mitigação

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Upgrade do Electron quebrar `safeStorage`, empacotamento ou E2E | Média | Alto | Fazer num PR isolado (4.0), com ADR e checklist manual no Mac; manter a 32 numa branch de fallback até a 44 passar |
| Detecção de encoding errar e bloquear arquivo legítimo | Média | Alto | Política conservadora: nunca sobrescrever em silêncio; abrir somente leitura e oferecer conversão com backup; fixtures cobrindo BOM/UTF-16/Latin-1/binário |
| `node-pty` não compilar nas 3 plataformas | Alta | Alto | Fase 4 T2 com `electron-builder install-app-deps`, `asarUnpack`, CI por plataforma e fallback para o terminal atual |
| XSS no chat de IA virar execução de comando pelo terminal | Baixa | Crítico | DOMPurify obrigatório, CSP, revisão de segurança na Fase 2, terminal só com ação explícita; teste E2E de `<img onerror>` |
| Assinatura macOS (US$ 99/ano) atrasar a v1.0 | Média | Médio | Decidir na Fase 5; sem certificado, macOS só avisa update; documentar “Abrir mesmo assim” |
| Escopo crescer e a 1.5 virar 4 semanas | Alta | Alto | P0 congelado; P1/P2 vão para a Fase 4; revisão semanal do escopo |
| Conflito do PR #3 com a 1.5 (mesmos arquivos) | Alta | Médio | Mergear o PR #3 **antes** de começar a 1.5 (item 1.1) |
| Um executor + revisão semanal viram gargalo | Média | Alto | WIP = 1 fase; não abrir fase nova antes do merge da anterior; relatório pronto antes do PR |
| Provider de IA mudar endpoint/modelo | Média | Médio | Presets isolados em `presets.js`; teste de conexão; mensagens acionáveis |
| Linux sem keyring | Alta | Médio | Aviso no wizard (2.1), opção de sessão sem persistir, documentação |
| Docs voltarem a divergir | Média | Baixo | Checklist de PR inclui docs; `1.8` e `5.4` como marcos |

---

## 6. Decisões que preciso de você

| # | Decisão | Recomendação | Alternativa |
|---|---|---|---|
| 1 | Aprovar a Fase 1.5 antes da Fase 2? | **Sim.** Os três P0 de confiança (dois de perda de dados) justificam 2–2,5 semanas | Começar a IA agora e corrigir em paralelo (não recomendado com 1 executor) |
| 2 | Escopo da 1.5 | **Completo (2–2,5 semanas):** itens 1.1–1.8 | **Só P0 (2 semanas):** 1.1–1.6; 1.7–1.8 entram na Fase 4 |
| 3 | Multi-janela | **Remover “Nova Janela” agora** e implementar roteamento por janela só se virar necessidade | Implementar multi-janela completo na 1.5 (custa ~3–4 dias e exige guard/settings por janela) |
| 4 | View “Extensões” | **Renomear para “Integrações Agzos”** e manter vazia/“em breve”, coerente com o ADR-0001 | Reabrir o ADR e assumir Open VSX/extensões (muda o produto e o cronograma) |
| 5 | Electron | **Atualizar para 44.x na Fase 4 (item 4.0)**, antes do `node-pty`; registrar ADR-0002. A 44 tem suporte até 03/2027; a 45 (mais nova) até 04/2027 | Ir direto para 45.x (mais novo, menos maduro) ou adiar (mantém Chromium 128 fora de suporte) |
| 6 | PR #3 | **Revisar e mergear já** (item 1.1); ele corrige a árvore horizontal e o clique | Refazer a correção dentro da 1.5 (desperdiça 791 linhas já testadas) |
| 7 | Cadência de versões | **0.2.0 após 1.5; 0.3.0 após 2; 0.4.0 após 3; 0.5.0 após 4; 1.0.0 após 5** | Uma versão só no fim (perde feedback interno) |
| 8 | Validação manual do Mac da Fase 1 | **Fazer antes de começar a Fase 2** (30 min, checklist do relatório da Fase 1) | Deixar para a 1.5 (o checklist já está na 1.5) |

**Se você aprovar tudo:** atualizo `ROADMAP.md`, crio `docs/plano/execucao/fase-1-5-confianca.md` com o passo a passo do executor (mesmo formato das outras fases) e começo pelo item 1.1 (revisão do PR #3).

**Se quiser mudar algo:** diga o número da decisão e a escolha. As fases 2–5 ficam como estão até a 1.5 fechar.

---

## 7. Fora de escopo (parking lot)

Não entram na v1.0 sem uma decisão à parte:

- Suporte a extensões do VS Code/Open VSX (reabre o ADR-0001).
- Debugger/DAP, tasks, settings sync.
- Split view/editor groups, minimapa por linguagem, breadcrumbs avançados.
- Preview de Markdown/imagem, editor de temas visual, i18n.
- Acessibilidade completa (aria-labels, navegação por teclado na árvore/menus, contraste).
- Remote development/SSH, colaboração em tempo real.
- Agent multi-arquivo, indexação de codebase, créditos/billing.
- Homebrew/winget, canais beta, SBOM.
- Telemetria (hoje não existe; se um dia existir, volta como opt-in explícito).

---

## 8. Anexo — como este diagnóstico foi feito

**Comandos e resultados:**

- `npm run check`: `0 errors, 21 warnings`; `19 tests, 19 pass, 0 fail`.
- `npm audit --omit=dev`: `found 0 vulnerabilities`.
- E2E: 11 testes em `test/e2e/` (boot 3, onboarding 5, security 3). **Não rodei a suíte completa neste ambiente** porque o Chromium não inicializa o sandbox aqui (`Failed to initialize sandbox: Operation not permitted`); os testes de comportamento foram feitos com o app rodando via Playwright + `--no-sandbox`. O CI do `main` e do PR #3 está verde.
- Versões: Electron `32.3.3` (EOL 2025-03-03), Monaco `0.50.0` (última 0.57.0), `xterm` `5.3.0` (descontinuado; `@xterm/xterm` 6.0.0), electron-builder `25.1.8` (última 26.18.0).
- Git: `main` local = `origin/main` (`4d086e9`); PR #3 aberto em `fix/tree-navigation-and-icon-themes`, 791 adições, CI verde.

**Probes no app rodando (Electron + Playwright):**

| Probe | Resultado |
|---|---|
| `window.prompt('x')` | lança `prompt() is and will not be supported.` |
| `window.AgzosEditor.getActiveEditor` | `undefined` |
| `fs.readDir` numa pasta com `.env`/`.github` | devolve só arquivos não-ocultos |
| `app.openExternal('file:///...')` | `false` |
| `#status-perf.innerHTML` após o boot | `"Balanceado"` (sem o SVG do ícone) |
| `#status-ai.innerHTML` | `"IA: off"` (sem o SVG) |
| Tema Monokai aplicado | fundo do editor continua `rgb(14, 14, 14)` |
| `#welcome-open-file` / `#welcome-clone` | 0 elementos |
| Abrir `a.ts` com erro de tipo | marcador de erro do Monaco presente (IntelliSense de TS funciona) |
| Editar A, trocar para B e voltar | conteúdo preservado, mas cursor volta para 1,1 e o undo não desfaz |
| Abrir `latin1.txt` e salvar | bytes `233/231/227` viram `EF BF BD` |
| Abrir `img.png` e salvar | bytes `255/254` viram `EF BF BD`; `0D` vira `0A` |

**Limitações:**

- Não medi tempo de startup, memória ou tamanho final do instalador. O item 5.2 inclui a medição; o número de 165 MB é a soma das dependências de build, não o asar final.
- Não rodei o app nas três plataformas; o CI só cobre Linux. A matriz macOS/Windows é item da 5.5.
- As estimativas são ordem de grandeza, não cronograma fechado.

**Links de referência:**

- [ROADMAP atual](ROADMAP.md)
- [Guia do executor](execucao/00-guia-do-executor.md)
- [Plano da Fase 2](execucao/fase-2-ia.md), [Fase 3](execucao/fase-3-git-github.md), [Fase 4](execucao/fase-4-editor.md), [Fase 5](execucao/fase-5-distribuicao.md)
- [Relatório da Fase 1](relatorios/fase-1-relatorio.md)
- [ADR-0001](../decisoes/ADR-0001-base-do-editor.md)
- [Electron EOL](https://endoflife.date/electron)
