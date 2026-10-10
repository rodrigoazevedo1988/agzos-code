# Relatório — Fase 1: Fundação

**Executor:** Claude Haiku 5.5  **Data:** 2026-10-10  **Branch:** `feat/fase-1-fundacao`  **PR:** ver corpo do PR

## Resumo
Todas as 9 tarefas da Fase 1 foram entregues. Lint e testes unitários rodam em `npm run check` (0 erros). Os 8 testes E2E passam localmente sob Xvfb e no CI (run `38017510978`, verde). O cofre de segredos foi validado só com cofre falso; o `safeStorage` real ainda precisa de teste manual no macOS.

## Tarefas
| Tarefa | Status | Commit | Observação |
|---|---|---|---|
| 1 — Lint e testes unitários | ✅ concluída | `61cc0b0` | ESLint 9, 22 warnings pré-existentes (não corrigidos) |
| 2 — E2E com Playwright | ✅ concluída | `d5768cb` | Desvios listados abaixo |
| 3 — `main.js` dividido em módulos IPC | ✅ concluída | `7714061` | Canais inalterados |
| 4 — Settings com defaults | ✅ concluída | `3fc6608` | Escrita atômica e backup de JSON corrompido |
| 5 — Secrets no cofre + migração | ✅ concluída | `a069173`, `917e951` | Ver desvios e dúvidas |
| 6 — Acesso restrito à pasta aberta | ✅ concluída | `09697d6` | Path guard com `realpath` |
| 7 — Bugs da Fase 0 | ✅ concluída | `2193a59` | Os 4 bugs do plano + terminal |
| 8 — CI no GitHub Actions | ✅ concluída | `88c543b` | Run verde |
| 9 — Docs e relatório | ✅ concluída | `07b3d10` | |

Commit `19dd84f` contém os planos de execução (`docs/plano/execucao/`), que estavam sem commit em `main`.

## Desvios do plano
- **T2 — `--password-store=basic` removido.** Não resolveu o `safeStorage` (continua `false` no Linux sem keyring). Substituído por cofre falso ativado com `AGZOS_TEST=1` + `AGZOS_TEST_SAFESTORAGE=fake`, aplicado em `main.js`. O cofre falso é inerte fora de `AGZOS_TEST=1`.
- **T2 — `launchApp` espera a janela `renderer/index.html`** (`waitForMainWindow`), não `firstWindow()`. O `firstWindow()` pega a splash, que fecha antes do teste começar.
- **T2 — `expect.poll` no teste de onboarding.** `exitOnboarding()` remove a classe `.active` antes de `settings.save` terminar (save não é aguardado). Não afeta o usuário; só o teste precisa esperar.
- **T2 — `test/e2e/helpers.js` espera o welcome antes de decidir.** O pop-up abre com `setTimeout(400ms)`; sem a espera, o helper pulava o onboarding.
- **T3 — `settings.register()` retorna `{ settingsPath, load, save }`.** O plano não previa retorno; o `main.js` usa `load`/`save` na migração do boot (T5).
- **T5 — `secrets:set` rejeita valor vazio** (`Chave ou valor inválido`). Não estava no plano.
- **T5 — migração mantém o segredo no `settings.json` se o cofre falhar.** O plano não dizia o que fazer nesse caso. Ver dúvida 1.
- **T6 — `workspace:open` em arquivo próprio** (`src/main/ipc/workspace.js`), com `getRecentFolders` vindo do `settingsStore`.
- **T6 — respostas de `fs:readDir` usam o caminho original**, não o `realpath`. Motivo: no macOS `/var` aponta para `/private/var`, e trocar o caminho quebraria as chaves das abas.
- **T6 — `fs:exists`, `fs:stat` e `fs:homeDir` ficaram sem guard**, como o plano previa.
- **T7 — tema pré-selecionado grava em `answers.theme` ao renderizar o passo** (não só ao clicar). Era o motivo do `null` salvo.
- **T7 — `setupEditor` remove só os filhos que não são `#welcome`**, e o welcome é escondido por `syncEditorWelcome()` em `openFile` e `closeTab`.
- **T1 — `eslint.config.js` inclui `globals.browser` para `test/e2e/**`**, porque o código dentro de `page.evaluate` usa `window`. Não estava no plano.
- **`.gitignore`** recebeu `test-results/` e `playwright-report/`.
- **Commit `a069173` foi feito com `npm run check` falhando** (1 erro de lint em `boot.spec.js`). Corrigido em `917e951`. Pode ser melhor fazer squash antes do merge.

## Verificação
- `npm run check`: `0 errors, 21 warnings`; `19 tests, 19 pass, 0 fail`
- `npm run test:e2e` (Xvfb, local): `8 passed`
- CI: run `38017510978` (https://github.com/rodrigoazevedo1988/agzos-code/actions/runs/38017510978): `success`
- Teste manual: **não feito**. Só Linux (Xvfb), sem macOS.

## Problemas encontrados
- **Tela de welcome em testes:** `isVisible()` antes do pop-up abrir devolve `false`, e o helper pulava o onboarding sem erro. Corrigido com espera explícita.
- **`safeStorage.isEncryptionAvailable()` → `false`** no Linux sem keyring, mesmo com `--password-store=basic`. Nesse caso `secrets:set` falha com `Cofre do sistema indisponível`, e a migração mantém a chave no `settings.json`.
- **Status bar:** `refreshStatusPerf` usa `textContent`, o que apaga o ícone Lucide inserido no `hydrateLucideIcons`. Já era assim na v0.1; não corrigido.
- **Lint — 21 warnings** de variáveis não usadas (`app.js`, `welcome.js`, `terminal.js`, `main.js`, `ipc/term.js` etc.). Não corrigidos (fora do escopo).
- **CI:** a action `actions/checkout@v4` e `setup-node@v4` rodam em Node 20 (deprecated). O label `ubuntu-latest` migra para Ubuntu 26 em 19/10/2026. Sem impacto imediato.

## Dúvidas para o sênior
1. **Migração com cofre indisponível:** `aiApiKey` fica em texto no `settings.json` até o usuário ter um cofre. Opções: (a) manter como está e avisar via toast; (b) apagar e pedir para o usuário digitar de novo. Escolhi (a) para não perder a chave.
2. **`workspace:open` e `recentFolders`:** `recentFolders` vem do `settings.json`, que o renderer pode editar. Se o renderer for comprometido, pode liberar qualquer pasta. Aceitável para a Fase 1 ou devo validar contra o `settings.json` lido pelo main?
3. **Cofre no Linux sem keyring:** hoje o app mostra erro ao salvar chave. Vale avisar no onboarding (passo GitHub/IA) ou só na Fase 2?
4. **Validação manual no Mac (pedido ao Rodrigo):**
   - Abrir Configurações, colar uma API key de teste e reiniciar: `secrets.json` deve existir em `~/Library/Application Support/agzos-code/` e não conter o texto da chave.
   - Confirmar que o campo mostra `•••• salva no cofre` depois do reinício.
   - Abrir uma pasta, editar e salvar arquivo, e confirmar que `fs` funciona dentro da pasta.
   - Tentar abrir `/etc/hosts` pelo console de DevTools (`window.agzos.fs.readFile('/etc/hosts')`) e confirmar `Acesso negado`.

## Arquivos alterados
```
$ git diff --stat main...HEAD | tail -1
 48 files changed, 3194 insertions(+), 412 deletions(-)
```
Principais: `src/main/main.js`, `src/main/ipc/*.js` (novos), `src/main/lib/*.js` (novos), `src/main/preload.js`, `src/renderer/scripts/{app,onboarding,editor,file-tree,command-palette,labels}.js`, `src/renderer/index.html`, `src/renderer/styles/app.css`, `test/unit/*.test.js`, `test/e2e/*.spec.js`, `test/e2e/helpers.js`, `eslint.config.js`, `playwright.config.js`, `.github/workflows/ci.yml`, `docs/`.

---

## Revisão do sênior (Claude Opus 5.5, 2026-10-10)

**Veredito:** aprovado com 2 correções feitas pelo sênior na própria branch (commit de revisão).

### Corrigido na revisão
1. **Bypass do path guard (segurança).** O renderer podia gravar `recentFolders: ['/']` via `settings:save` e depois chamar `workspace:open('/')`, liberando o disco inteiro. Agora `recentFolders` é controlado só pelo main:
   - `settings:save` mantém o `recentFolders` do disco e ignora o valor do renderer;
   - `workspace:open` adiciona a pasta às recentes quando libera;
   - `file-tree.js` não grava mais `recentFolders`.
   Testes novos em `security.spec.js`: bypass bloqueado; pasta aberta reabre após reiniciar.
2. **E2E instável.** `launchApp` considerava o app pronto ao ver `#topbar` (HTML estático), antes do `boot()` expor `window.AgzosEditor`. Testes que chamam `openFile` falhavam de forma intermitente. O helper agora espera `window.AgzosEditor`. Resultado: 3 execuções seguidas com 11/11.

Também adicionado: teste de regressão "welcome do editor volta ao fechar a última aba" (o comportamento já estava certo).

### Respostas às dúvidas
1. **Migração com cofre indisponível:** manter a opção (a). Na Fase 2, o wizard de IA deve avisar quando `secrets.isAvailable()` for falso.
2. **`workspace:open` e `recentFolders`:** era um bypass real. Corrigido (item 1 acima).
3. **Cofre no Linux sem keyring:** avisar na Fase 2, no wizard de IA. Sem mudança agora.
4. **Validação manual no Mac:** continua pendente com o Rodrigo (checklist acima).

### Observações menores (sem ação)
- O relatório cita `refreshStatusPerf`; a função real é `applySettingsToUI` (`app.js`).
- Merge feito com squash, porque o commit `a069173` quebrava o lint no meio do histórico.
