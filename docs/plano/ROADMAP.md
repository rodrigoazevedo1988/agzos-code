# Roadmap — Agzos Code

**Atualizado:** 17/11/2026
**Base:** Electron + Monaco próprio, sem fork do VS Code — [ADR-0001](../decisoes/ADR-0001-base-do-editor.md).
**Estado atual:** **v1.1.0 entregue** (17/11/2026): Onda 1 do PRD de módulos nativos (Vassoura de Produção e Cofre .env), Agzos IA com modos/skills, fila, anexos e histórico global, barra de menus, várias janelas isoladas, visualizadores (PDF, Office, mídia, Markdown) e atalho de SSH. Próximo: **1.2.0** (Snippets, Git Slider com histórico local e pasta remota via SSH/SFTP) e **1.3.0** (Sandbox de Componentes).
**Infra:** testes, builds e publicação rodam só na VPS (GitHub Actions removido em 17/11/2026).

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
- [x] Explorer com ícones de arquivo e quatro estilos de ícones selecionáveis

## Fase 1 — Fundação (1–1,5 semana) ✅ · [plano](execucao/fase-1-fundacao.md)

- [x] T1 Lint e testes unitários
- [x] T2 E2E com Playwright e `userData` isolado
- [x] T3 `main.js` dividido em módulos de IPC
- [x] T4 Settings com defaults e tolerância a erro
- [x] T5 Secrets no cofre do SO + migração
- [x] T6 Acesso a arquivos restrito à pasta aberta
- [x] T7 Bugs da Fase 0 (tema do onboarding, boas-vindas do editor, rótulos pt-BR, terminal)
- [x] T8 CI no GitHub Actions (removido em 17/11/2026; checagens rodam na VPS)
- [x] T9 Docs

## Fase 2 — IA (3 semanas) ✅ · [plano](execucao/fase-2-ia.md)

- [x] T1 Parser de SSE
- [x] T2 Provider compatível com OpenAI (OpenAI, Groq, OpenRouter, Gemini, Ollama, custom)
- [x] T3 Provider Anthropic
- [x] T4 Perfis de provider + migração
- [x] T5 IPC de chat com streaming e cancelamento
- [x] T6 Servidor OpenAI falso para E2E
- [x] T7 Wizard de IA
- [x] T8 Painel de chat com streaming e histórico
- [x] T9 Contexto de arquivo, seleção e terminal
- [x] T10 Comandos rápidos e aplicar código com diff
- [x] T11 Docs + relatório

## Fase 3 — Git e GitHub multi-conta (2 semanas) ✅ · [plano](execucao/fase-3-git-github.md)

- [x] T1 Runner de git e parser de status (v1.0.0)
- [x] T2 Operações git e IPC (v1.0.0)
- [x] T3 Painel Git e branch na status bar (v1.0.0)
- [x] T4 Contas GitHub por token (PAT) e associação por repositório (v1.0.0)
- [ ] T5 (opcional) Login GitHub via Device Flow — precisa do Client ID de um OAuth App da Agzos
- [x] T6 Docs (spec em [`superpowers/specs`](../superpowers/specs/2026-11-16-agente-e-git-1.0.0-design.md) e CHANGELOG); relatório de fase não gerado

## Fase 4 — Editor completo (2 semanas) 🚧 · [plano](execucao/fase-4-editor.md)

- [x] T1 IntelliSense TS/JS/JSON/CSS/HTML (workers do Monaco configurados na v0.4.0)
- [x] T2 Terminal com node-pty (v0.5.0) + multi-sessão, perfis de shell, divisão e aba PORTAS (v0.7.0)
- [ ] T3 Busca e Quick Open com ripgrep (Quick Open recursivo existe, ainda sem ripgrep)
- [ ] T4 Recarregar arquivos alterados fora (✅ v1.0.0) + restaurar sessão (pendente)
- [ ] T5 Modos de performance com efeito
- [x] T6 Importar configurações do VS Code / Cursor (entregue na v0.4.0)
- [ ] T7 Docs + relatório

## Fase 5 — Distribuição e v1.0 (1–1,5 semana) ✅ · [plano](execucao/fase-5-distribuicao.md)

- [x] T1 Release multiplataforma — builds Windows/Linux na VPS (`electron-builder` + wine) e `tools/publish-vps-release.js`, mantendo as 2 últimas releases; macOS depende de host macOS
- [x] T2 Auto-update (multiplataforma Windows/Linux/macOS in-app via mac-ota entregue na v0.4.0)
- [x] T3 Tela de privacidade (categoria Privacidade & Dados nas Configurações; telemetria desligada)
- [ ] T4 Assinatura opcional por secrets + guia de compra dos certificados
- [x] T5 v1.0.0 publicada (16/11/2026); relatório de fase não gerado

---

## Entregas além do plano (v0.5.0 → v1.0.0)

- **v0.6.0** — Agzos IA premium: painel acoplável (esquerda/direita/embaixo), várias conversas por workspace, personalização.
- **v0.6.1** — Ambiente limpo do registro no terminal do Windows; copiar/colar no terminal.
- **v1.0.0** — Modo Agente: ferramentas de arquivo, pasta, busca e comando; 3 modos de autonomia; aprovação com diff; desfazer por checkpoint.

## v1.1 → v1.3 — Módulos nativos (PRD v1.1)

Spec: [`superpowers/specs/2026-11-17-modulos-nativos-1.1.0-design.md`](../superpowers/specs/2026-11-17-modulos-nativos-1.1.0-design.md) · Plano: [`superpowers/plans/2026-11-17-modulos-nativos-1.1.0.md`](../superpowers/plans/2026-11-17-modulos-nativos-1.1.0.md) · Relatórios: `relatorios/v1.1.0-*.md`

- [x] **1.1.0** — Base dos módulos, Vassoura de Produção, Cofre .env; Agzos IA (modos/skills, fila, anexos, histórico, exportar); barra de menus; várias janelas com permissões isoladas; visualizadores; atalho SSH; spike do Sandbox ([resultado](../superpowers/specs/2026-11-17-sandbox-spike.md)).
- [ ] **1.2.0** — Snippets de Agência (JSON no userData), Git Slider + histórico local, pasta remota via SSH/SFTP (`ssh2`, sem servidor no host).
- [ ] **1.3.0** — Sandbox de Componentes (esbuild nativo, iframe sandbox, Tailwind do projeto).

## Pós-v1.0

**Validação (prioridade)**
- [ ] Testar em Windows real, contra o github.com e com modelos de IA reais.
- [ ] Build e teste de macOS.

**Pendências da v1.0**
- [ ] Device Flow do GitHub (Fase 3 T5).
- [ ] ripgrep na busca e restaurar sessão (Fase 4 T3/T4).
- [ ] Assinatura de código Windows/macOS (Fase 5 T4).
- [ ] Cabeçalho da sidebar com botões por view (hoje mostra os do Explorer em Git/IA).
- [ ] Cartão de aprovação do agente sem rolagem com o painel embaixo.
- [ ] Itens "Em breve" da barra de menus e limitações de várias janelas: [BACKLOG](BACKLOG.md).

**Próximas features**
- **Git:** merge/rebase com resolução de conflitos, stash, blame.
- **Agente:** indexação do código, tarefas em segundo plano, uso de tokens/custo, aprovar parte do diff, MCP.
- **IntelliSense de outras linguagens:** `monaco-languageclient` + servidores LSP (Python, Go, PHP).
- **Integrações Agzos:** Agzos Key (SSO), Agzos Browser (links e preview), Agzos Project/Hub (contexto no chat).
- **Freemium:** agentes em background, colaboração, créditos de modelos.

## Fora do escopo atual

- Extensões do VS Code e marketplace Open VSX não são suportados pela arquitetura Electron + Monaco. Para mudar essa decisão, reabrir o [ADR-0001](../decisoes/ADR-0001-base-do-editor.md).
