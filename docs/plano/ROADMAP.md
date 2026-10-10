# Roadmap e plano de evolução — Agzos Code

**Atualizado:** 09/10/2026
**Estado atual:** fim da Fase 0, entrando na Fase 0.5 (estabilização).

Cada fase tem critério de saída. Não avançar sem cumprir o critério.

---

## Fase 0 — Setup + Branding ✅ (com correções em 09/10)

Entregue: editor Electron + Monaco, tema Agzos, sidebar, terminal, command palette, welcome, onboarding, builds via electron-builder.

Correções de 09/10/2026 (ver [troubleshooting](../tecnico/troubleshooting.md)):
- [x] Tela preta na abertura (`state.js` não carregado + overlays sem `.active` visíveis)
- [x] Ícone do Electron no Dock do macOS em dev
- [x] Pipeline de ícones sem dependências externas (`npm run build:icons`)
- [x] Pasta `docs/` organizada (PRD, ADR, arquitetura, troubleshooting, roadmap)

---

## Fase 0.5 — Estabilização (1 semana)

Objetivo: base confiável antes de construir features.

### Decisão
- [ ] Decidir [ADR-0001](../decisoes/ADR-0001-base-do-editor.md): manter Monaco próprio ou migrar para fork Code-OSS. **Bloqueia o desenho da Fase 1.**

### Qualidade
- [ ] ESLint + Prettier + script `npm run check`
- [ ] Smoke test E2E com Playwright (`_electron`): app abre, welcome aparece, onboarding conclui, editor abre arquivo
- [ ] GitHub Actions: lint + smoke test (Linux/xvfb) a cada PR
- [ ] GitHub Actions: `electron-builder` nas 3 plataformas (artefatos não assinados)

### Bugs observados
- [ ] Onboarding salva `answers.theme = null` quando o usuário aceita o tema pré-selecionado
- [ ] Confirmar que as respostas do onboarding (tema, layout, densidade) são aplicadas à UI
- [ ] Tela de boas-vindas do editor (`#welcome`) não aparece; o Monaco mostra um modelo vazio
- [ ] Status bar mostra `balanced` em inglês
- [ ] README: `npm run dev` não abre DevTools (é `npm run dev:tools`); citar `settings.js` inexistente

### Segurança (pré-requisito para guardar API keys)
- [ ] API key: sair do `settings.json` e usar `safeStorage` do Electron (Keychain / DPAPI / libsecret)
- [ ] IPC `fs:*`: validar caminhos (dentro da workspace ou de diálogo aprovado pelo usuário)
- [ ] Avaliar `sandbox: true` movendo `fs` todo para o main (preload já só usa `ipcRenderer`)
- [ ] `term:create`: checar `evt.sender.isDestroyed()` antes de enviar dados

**Critério de saída:** CI verde nas 3 plataformas, smoke test passando, ADR-0001 decidido.

---

## Fase 1 — MVP Core (3–5 semanas)

A ordem abaixo vale para as duas opções do ADR. Na opção C (fork Code-OSS), cada item vira extensão built-in `extensions/agzos-*`.

### 1.1 Camada de IA (semana 1)
- [ ] Módulo `ai/` no main process, em TypeScript, sem dependência de UI
- [ ] Interface única de provider: `listModels()`, `chat(messages, { stream })`, `testConnection()`
- [ ] Providers: OpenAI-compatible (OpenAI, Groq, OpenRouter, Ollama, custom), Anthropic, Google
- [ ] Streaming via IPC (`ai:chunk`, `ai:done`, `ai:error`) com cancelamento
- [ ] Chaves via `safeStorage`; renderer nunca recebe a chave

### 1.2 Wizard de IA (semana 2)
- [ ] 7 passos do PRD §6.1, reaproveitando o componente de onboarding
- [ ] Teste de conexão real; detecção automática de Ollama em `localhost:11434`
- [ ] Vários providers salvos + troca rápida pela status bar

### 1.3 Chat Agent (semanas 2–3)
- [ ] Painel lateral com streaming e Markdown com highlight
- [ ] Contexto: arquivo atual, seleção, saída do terminal
- [ ] Comandos rápidos: explicar, refatorar, documentar, gerar testes
- [ ] Aplicar diff no editor com preview (diff editor do Monaco)
- [ ] Histórico de conversas persistido por workspace

### 1.4 Multi-conta GitHub (semana 4)
- [ ] Contas por PAT primeiro; OAuth Device Flow depois
- [ ] Switcher na status bar e na Command Palette
- [ ] Associação repositório → conta (pelo `remote.origin.url`)
- [ ] Git real: status, diff, commit, push, pull, branch (substitui o painel stub)

### 1.5 Performance e telemetria (semana 5)
- [ ] Modos de performance com efeito medido (minimap, workers, animações, polling)
- [ ] Settings → Privacidade: consentimento explícito e lista do que é coletado
- [ ] Terminal com `node-pty` (prompt, cores, programas interativos)

**Critério de saída:** time interno usa por 1 semana com IA configurada pelo wizard; nenhum bug bloqueante aberto.

---

## Fase 2 — Polimento (1–2 semanas)

- [ ] Auto-update com `electron-updater` + GitHub Releases
- [ ] Assinatura e notarização macOS; assinatura Windows
- [ ] Temas extras: Agzos High Contrast; importação de temas VS Code (JSON)
- [ ] Monaco workers por linguagem (TS, JSON, CSS, HTML) — se seguir opção A
- [ ] Teste das 50 extensões mais usadas do Open VSX — se seguir opção C
- [ ] Migração real de configs do VS Code/Cursor (`migrate.js`)

**Critério de saída:** instaladores assinados publicados; update automático validado de v1.0.0 → v1.0.1.

---

## Fase 3 — Integrações Agzos (pós-MVP)

- [ ] Agzos Key: SSO no lugar de login local
- [ ] Agzos Browser: abrir links e preview de páginas
- [ ] Agzos Project / Hub: tarefas e contexto de projeto no chat

## Fase 4 — Freemium (futuro)

- [ ] Agentes em background
- [ ] Indexação de codebase (embeddings locais)
- [ ] Colaboração em time
- [ ] Créditos de modelos premium + billing

---

## Próximos 5 passos concretos

1. Decidir o ADR-0001 (reunião curta com o time).
2. Adicionar ESLint + Playwright smoke test + workflow do GitHub Actions.
3. Mover a API key para `safeStorage` e validar caminhos no IPC `fs:*`.
4. Corrigir os bugs do onboarding listados na Fase 0.5.
5. Começar a camada de IA (1.1) com o provider OpenAI-compatible, que cobre Groq, OpenRouter e Ollama.
