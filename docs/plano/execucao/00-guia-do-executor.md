# Guia do executor

Leia antes de qualquer tarefa. Vale para todas as fases.

## Contexto em 5 linhas

- Agzos Code = app Electron 32 + Monaco 0.50 + xterm.js, **sem bundler e sem TypeScript**.
- Main process: CommonJS em `src/main/`. Renderer: ESM em `src/renderer/scripts/`, carregado de `index.html`.
- Renderer não acessa Node. Tudo passa por `window.agzos.*` (`src/main/preload.js`) → `ipcMain.handle` no main.
- Decisão de base: [ADR-0001](../../decisoes/ADR-0001-base-do-editor.md) — **não** fazer fork do VS Code.
- Leia também: [PRD](../../produto/PRD.md), [arquitetura](../../tecnico/arquitetura.md), [troubleshooting](../../tecnico/troubleshooting.md).

## Fluxo de trabalho

1. Uma branch por fase: `feat/fase-N-<nome>` a partir do `main` atualizado.
2. Execute as tarefas **na ordem**. Cada tarefa termina com testes passando e **um commit**.
3. Antes de cada commit: `npm run check` (lint + testes unitários) verde. A partir da Fase 1 Tarefa 2, rode também `npm run test:e2e`.
4. Mensagem de commit: Conventional Commits em português. Ex.: `feat(ai): provider compatível com OpenAI`.
   Final da mensagem: `Co-Authored-By: Claude Haiku <noreply@anthropic.com>` (ou a linha de atribuição que o harness indicar).
5. Ao fim da fase: marque `[x]` em `docs/plano/ROADMAP.md`, **gere o relatório da fase** (seção abaixo), push, abra PR para `main` com o relatório no corpo. **Não faça merge.**
6. O Rodrigo envia o relatório para revisão do sênior (Claude Opus), testa no Mac e só então faz o merge. A fase seguinte só começa após o merge.

## Regras

- **Faça só o que a tarefa pede.** Não refatore código vizinho, não renomeie, não "melhore" estilos.
- **Nomes, assinaturas e caminhos do plano são contrato.** Tarefas seguintes dependem deles. Não mude.
- Textos de interface em **português do Brasil**, com acentos.
- Main process: módulos em `src/main/lib/`, `src/main/ai/`, `src/main/git/` **não** fazem `require('electron')` no topo. Recebem dependências por parâmetro (ex.: `safeStorage`). Assim os testes unitários rodam em Node puro.
- Nunca grave API key ou token em `settings.json`, log, toast ou mensagem de erro. Use o secret store (Fase 1 Tarefa 5).
- Nunca envie a chave para o renderer. Chamadas a APIs externas acontecem no main.
- Dependência nova só se a tarefa citar. Fixe a versão com `^` na major indicada.
- Arquivos de terceiros usados no renderer vão para `src/renderer/vendor/` via `tools/setup-vendor.js` (a CSP só permite `'self'`).

## Relatório obrigatório ao fim de cada implementação

> **OBS:** toda vez que terminar uma fase — ou parar no meio por bloqueio — gere o relatório **antes** de abrir o PR.
> O Rodrigo envia esse relatório para revisão do sênior. Sem relatório, a fase não é considerada concluída.

Arquivo: `docs/plano/relatorios/fase-N-relatorio.md` (bloqueio no meio da fase: `fase-N-relatorio-parcial.md`).
Seja factual. Não escreva "funciona" sem ter rodado o comando; cole a saída.

```markdown
# Relatório — Fase N: <nome>

**Executor:** <modelo>  **Data:** AAAA-MM-DD  **Branch:** <branch>  **PR:** <link>

## Resumo
<2–4 linhas: o que foi entregue e o estado geral>

## Tarefas
| Tarefa | Status | Commit | Observação |
|---|---|---|---|
| 1 — <nome> | ✅ concluída / ⚠️ parcial / ❌ não feita | <hash curto> | <curta> |

## Desvios do plano
<Tudo que foi feito diferente do plano: arquivo, nome, assinatura, dependência, abordagem. Para cada um: o quê, por quê. "Nenhum" se não houve.>

## Verificação
- `npm run check`: <saída final resumida, ex.: "0 errors, 3 warnings; 24 tests passed">
- `npm run test:e2e`: <ex.: "9 passed">
- CI: <link do run + status>
- Teste manual: <o que abriu e clicou, em qual SO>

## Problemas encontrados
<Erros, comportamentos estranhos, testes instáveis, warnings relevantes. Com trecho do erro.>

## Dúvidas para o sênior
<Decisões que você tomou sem o plano cobrir, ou que precisam de confirmação.>

## Arquivos alterados
<saída de `git diff --stat main...HEAD`>
```

## Quando parar e perguntar

Pare e reporte (não improvise) se:
- um passo falhar duas vezes seguidas com o mesmo erro;
- o código real não bater com o que o plano descreve (arquivo, função ou seletor inexistente);
- a tarefa exigir decisão de produto que o plano não fixa;
- for preciso apagar arquivo que o plano não manda apagar.

Gere o `fase-N-relatorio-parcial.md` com: tarefa, passo, comando, saída de erro (trecho decisivo) e o que você já tentou. Commit, push e avise o Rodrigo.

## Comandos

| Comando | Uso |
|---|---|
| `npm install` | Instala deps, gera `vendor/`, aplica branding no Electron.app (macOS) |
| `npm run dev` / `npm run dev:tools` | Abre o app (com DevTools no segundo) |
| `npm run lint` | ESLint |
| `npm run test:unit` | `node --test` em `test/unit/` |
| `npm run test:e2e` | Playwright + Electron em `test/e2e/` |
| `npm run check` | `lint` + `test:unit` |

Linux sem display (VPS/CI): `xvfb-run -a npm run test:e2e`. Como root, o Electron precisa de `--no-sandbox` (o helper de E2E já trata).

## Fases

| Fase | Plano |
|---|---|
| 1 — Fundação | [fase-1-fundacao.md](fase-1-fundacao.md) |
| 2 — IA | [fase-2-ia.md](fase-2-ia.md) |
| 3 — Git e GitHub | [fase-3-git-github.md](fase-3-git-github.md) |
| 4 — Editor completo | [fase-4-editor.md](fase-4-editor.md) |
| 5 — Distribuição | [fase-5-distribuicao.md](fase-5-distribuicao.md) |
