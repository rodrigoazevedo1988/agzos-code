# Roadmap — Agzos Code

**Atualizado:** 09/10/2026
**Base:** Electron + Monaco próprio, sem fork do VS Code — [ADR-0001](../decisoes/ADR-0001-base-do-editor.md).
**Estado atual:** Fase 0 concluída. Próxima: Fase 1.

Planos detalhados, tarefa a tarefa, para o executor: [`execucao/`](execucao/00-guia-do-executor.md).
Relatórios de cada fase: [`relatorios/`](relatorios/).

## Como cada fase anda

1. Executor (Haiku) implementa a fase numa branch, seguindo o plano.
2. Executor gera o relatório em `relatorios/fase-N-relatorio.md` e abre o PR (sem merge).
3. Rodrigo envia o relatório para revisão do sênior (Opus) e testa no Mac.
4. Ajustes, se houver → merge → próxima fase.

Estimativa total até a v1.0: ~9–12 semanas.

---

## Fase 0 — Protótipo v0.1 ✅

- [x] Editor Electron + Monaco, tema Agzos, sidebar, terminal, command palette
- [x] Welcome e onboarding
- [x] Correção da tela preta e do ícone do macOS em dev (09/10)
- [x] Pasta `docs/` organizada

## Fase 1 — Fundação (1–1,5 semana) · [plano](execucao/fase-1-fundacao.md)

- [ ] T1 Lint e testes unitários
- [ ] T2 E2E com Playwright e `userData` isolado
- [ ] T3 `main.js` dividido em módulos de IPC
- [ ] T4 Settings com defaults e tolerância a erro
- [ ] T5 Secrets no cofre do SO + migração
- [ ] T6 Acesso a arquivos restrito à pasta aberta
- [ ] T7 Bugs da Fase 0 (tema do onboarding, boas-vindas do editor, rótulos pt-BR, terminal)
- [ ] T8 CI no GitHub Actions
- [ ] T9 Docs + relatório

## Fase 2 — IA (3 semanas) · [plano](execucao/fase-2-ia.md)

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

## Fase 3 — Git e GitHub multi-conta (2 semanas) · [plano](execucao/fase-3-git-github.md)

- [ ] T1 Runner de git e parser de status
- [ ] T2 Operações git e IPC
- [ ] T3 Painel Git e branch na status bar
- [ ] T4 Contas GitHub e associação por repositório
- [ ] T5 (opcional) Login GitHub via Device Flow — precisa de OAuth App da Agzos
- [ ] T6 Docs + relatório

## Fase 4 — Editor completo (2 semanas) · [plano](execucao/fase-4-editor.md)

- [ ] T1 IntelliSense TS/JS/JSON/CSS/HTML (workers do Monaco)
- [ ] T2 Terminal com node-pty
- [ ] T3 Busca e Quick Open com ripgrep
- [ ] T4 Recarregar arquivos alterados fora + restaurar sessão
- [ ] T5 Modos de performance com efeito
- [ ] T6 Importar configurações do VS Code / Cursor
- [ ] T7 Docs + relatório

## Fase 5 — Distribuição e v1.0 (1–1,5 semana) · [plano](execucao/fase-5-distribuicao.md)

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
