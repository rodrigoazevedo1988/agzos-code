# ADR-0001 — Base do editor: Electron + Monaco próprio vs. fork do Code-OSS

**Status:** Proposto (decidir antes de iniciar a Fase 1)
**Data:** 09/10/2026

## Contexto

O PRD define o Agzos Code como fork do Code-OSS, com "100% de compatibilidade com extensões do VS Code".
A v0.1 foi feita como app Electron próprio usando só o Monaco (o componente de edição do VS Code).

Monaco não é o VS Code. Ele não tem extension host, API `vscode.*`, LSP client, debugger (DAP), SCM, tasks, settings sync nem workbench.
Extensões do VS Code **não rodam** no app atual. Para rodar, seria preciso reimplementar boa parte do workbench.

## Opções

### A. Manter Electron + Monaco próprio
- ✅ Build simples (`electron-builder`), código pequeno e controlado.
- ✅ Já existe e roda.
- ❌ Compatibilidade com extensões ≈ 0%. Cada feature do VS Code (git, debug, LSP, terminal com pty, busca rápida) precisa ser reescrita.
- ❌ Contradiz o objetivo nº 1 do PRD ("Familiaridade").

### B. Fork do Code-OSS (modelo VSCodium)
- ✅ Extensões, LSP, debug, git, terminal, settings: tudo pronto.
- ✅ Features Agzos viram contribuições nativas (`src/vs/workbench/contrib/agzos/*`) ou extensões built-in.
- ✅ VSCodium já resolve branding, `product.json`, Open VSX e pipeline de build para as 3 plataformas — dá para partir dos scripts dele.
- ❌ Build pesado (máquina com 16 GB+, ~30–60 min no CI por plataforma).
- ❌ Rebase periódico com upstream.

### C. Híbrido: fork Code-OSS + features Agzos como extensões built-in
- Igual a B, mas o máximo possível de código Agzos fica em extensões (`extensions/agzos-*`) usando a API pública.
- ✅ Rebase com upstream fica muito mais barato (menos patches no core).
- ✅ O código de UI atual (onboarding, welcome, tema) pode ser portado como webview de extensão.

## Recomendação

**Opção C.** O must-have do MVP inclui compatibilidade com extensões, chat com aplicação de diffs e multi-GitHub — tudo isso já existe como API no VS Code.
Continuar investindo no app Monaco próprio gera trabalho que será descartado na migração.

Até a decisão, a v0.x atual segue como protótipo de UX (onboarding, welcome, tema, identidade) e laboratório da camada de IA.
A camada de IA deve ser escrita em TypeScript, independente de UI, para ser reaproveitada em qualquer opção.

## Consequências

- Fase 1 começa com um spike de 1 semana: build do Code-OSS/VSCodium com branding Agzos nas 3 plataformas.
- Se o spike falhar (custo de build/CI inviável), registrar nova decisão e seguir com A, removendo do PRD a promessa de compatibilidade com extensões.
