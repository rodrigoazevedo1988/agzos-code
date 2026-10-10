# ADR-0001 — Base do editor: Electron + Monaco próprio vs. fork do Code-OSS

**Status:** Aceito — opção A (09/10/2026)
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

## Decisão

**Opção A — manter Electron + Monaco próprio**, decidida em 09/10/2026.

A recomendação técnica inicial era a opção C (fork Code-OSS). O time escolheu a opção A pelo peso do fork:
build de 30–60 min por plataforma, máquina de 16 GB+ e rebase mensal com upstream.

Decisões complementares (09/10/2026):
- Chat de IA: painel próprio Agzos.
- Primeiro provider: compatível com OpenAI (cobre OpenAI, Groq, OpenRouter, Ollama, Gemini e endpoints custom).
- Assinatura de código: sem certificados por enquanto.

## Consequências

- **Extensões do VS Code não serão suportadas.** O PRD foi ajustado: o objetivo "Familiaridade" passa a ser atalhos, layout e temas no estilo VS Code.
- Recursos que o VS Code traz prontos são implementados por nós, em escopo mínimo: Git, terminal com pty, busca com ripgrep, IntelliSense via workers do Monaco (TS/JS/JSON/CSS/HTML).
- Outras linguagens (Python, Go etc.) ficam sem IntelliSense até uma fase futura com `monaco-languageclient` + LSP.
- Build continua com `electron-builder`, em minutos.
- Se no futuro a compatibilidade com extensões virar requisito, reabrir este ADR.
