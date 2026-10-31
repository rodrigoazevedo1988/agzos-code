# Roadmap — Agzos Code

**Atualizado:** 31/10/2026
**Base:** Electron 44 + Monaco próprio, sem fork do VS Code — [ADR-0001](../decisoes/ADR-0001-base-do-editor.md) e [ADR-0002](../decisoes/ADR-0002-electron-e-codigo-nativo.md).
**Estado atual:** Fase 1.5 mergeada (PR #4) e publicada na `v0.2.2`, com os nove artefatos dos três sistemas no release. O pty real do terminal, previsto para a Fase 4, foi antecipado na 0.2.2. Próxima: Fase 2 — IA.

Backlog aprovado e diagnóstico completo: [`BACKLOG-MELHORIAS.md`](BACKLOG-MELHORIAS.md).
Planos detalhados, tarefa a tarefa, para o executor: [`execucao/`](execucao/00-guia-do-executor.md).
Relatórios de cada fase: [`relatorios/`](relatorios/).

## Como cada fase anda

1. Executor (Haiku) implementa a fase numa branch, seguindo o plano.
2. Executor gera o relatório em `relatorios/fase-N-relatorio.md` e abre o PR (sem merge).
3. Rodrigo envia o relatório para revisão do sênior (Opus) e testa no Mac.
4. Ajustes, se houver → merge → próxima fase.

Estimativa total até a v1.0: **~12–14,5 semanas** de execução + 1,5–2 semanas de revisão/teste.

---

## Fase 0 — Protótipo v0.1 ✅

- [x] Editor Electron + Monaco, tema Agzos, sidebar, terminal, command palette
- [x] Welcome e onboarding
- [x] Correção da tela preta e do ícone do macOS em dev (09/10)
- [x] Pasta `docs/` organizada

## Fase 1 — Fundação (1–1,5 semana) · [plano](execucao/fase-1-fundacao.md)

- [x] T1 Lint e testes unitários
- [x] T2 E2E com Playwright e `userData` isolado
- [x] T3 `main.js` dividido em módulos de IPC
- [x] T4 Settings com defaults e tolerância a erro
- [x] T5 Secrets no cofre do SO + migração
- [x] T6 Acesso a arquivos restrito à pasta aberta
- [x] T7 Bugs da Fase 0 (tema do onboarding, boas-vindas do editor, rótulos pt-BR, terminal)
- [x] T8 CI no GitHub Actions
- [x] T9 Docs

## Fase 1.5 — Confiança e integridade (2–2,5 semanas) · [plano](execucao/fase-1-5-confianca.md)

> Inserida em 28/10/2026, antes da Fase 2. Corrige os P0/P1 de perda de dados e as promessas de UI que não funcionavam.

- [x] T1.1 Base: PR #3, Electron 44 + `electron-builder` 26, assinatura local do `.app` no macOS
- [x] T1.2 Proteção de alterações não salvas ao fechar
- [x] T1.3 Encoding/EOL/binário com escrita atômica
- [x] T1.4 Diálogos internos e operações de arquivo
- [x] T1.5 Explorer e busca (dotfiles, salto para linha)
- [x] T1.6 Status bar, temas e honestidade da UI
- [x] T1.7 Robustez, logs e hardening
- [x] T1.8 Docs, versão 0.2.0 e changelog
- [x] T1.9 Workflow de build Windows/Linux/macOS (matriz)

## Fase 2 — IA (3–3,5 semanas) · [plano](execucao/fase-2-ia.md)

- [ ] T1 Parser de SSE
- [ ] T2 Provider compatível com OpenAI (OpenAI, Groq, OpenRouter, Gemini, Ollama, custom)
- [ ] T3 Provider Anthropic
- [ ] T4 Perfis de provider + migração
- [ ] T5 IPC de chat com streaming e cancelamento
- [ ] T6 Servidor OpenAI falso para E2E
- [ ] T7 Wizard de IA
- [ ] T8 Painel de chat com streaming e histórico
- [ ] T9 Contexto de arquivo, seleção e terminal
- [ ] T10 Comandos rápidos e aplicar código com diff
- [ ] T11 Docs + relatório

## Fase 3 — Git e GitHub multi-conta (2–2,5 semanas) · [plano](execucao/fase-3-git-github.md)

- [ ] T1 Runner de git e parser de status
- [ ] T2 Operações git e IPC
- [ ] T3 Painel Git e branch na status bar
- [ ] T4 Contas GitHub e associação por repositório
- [ ] T5 (opcional) Login GitHub via Device Flow — precisa de OAuth App da Agzos
- [ ] T6 Docs + relatório

## Fase 4 — Editor completo (3–3,5 semanas) · [plano](execucao/fase-4-editor.md)

- [ ] T1 IntelliSense TS/JS/JSON/CSS/HTML (workers do Monaco)
- [x] T2 Terminal com node-pty — **antecipado na 0.2.2** (commit `7c9f602`)
- [ ] T3 Busca e Quick Open com ripgrep
- [ ] T4 Recarregar arquivos alterados fora + restaurar sessão
- [ ] T5 Modos de performance com efeito
- [ ] T6 Importar configurações do VS Code / Cursor
- [ ] T7 Docs + relatório

## Fase 5 — Distribuição e v1.0 (2–2,5 semanas) · [plano](execucao/fase-5-distribuicao.md)

- [ ] T1 Release multiplataforma por tag
- [ ] T2 Auto-update (Windows/Linux; macOS só aviso até ter assinatura)
- [ ] T3 Tela de privacidade
- [ ] T4 Assinatura opcional por secrets + guia de compra dos certificados
- [ ] T5 v1.0.0 + relatório

---

## Pós-v1.0 (planejar após a v1.0)

- **Integrações Agzos:** Agzos Key (SSO), Agzos Browser (links e preview), Agzos Project/Hub (contexto no chat).
- **IntelliSense de outras linguagens:** `monaco-languageclient` + servidores LSP (Python, Go, PHP).
- **Agent:** IA editando vários arquivos e rodando comandos com aprovação.
- **Freemium:** agentes em background, indexação de codebase, colaboração, créditos de modelos.
