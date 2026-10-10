# Fase 2 — IA: Plano de Implementação

> **Para o executor:** leia antes o [guia do executor](00-guia-do-executor.md). Pré-requisito: Fase 1 mergeada. Execute tarefa a tarefa, na ordem.

**Objetivo:** wizard de configuração de IA e chat no painel lateral com streaming, contexto do editor/terminal, comandos rápidos e aplicação de código com diff.

**Arquitetura:** toda chamada a API externa acontece no main (`src/main/ai/`), com a chave lida do secret store. O renderer conversa por IPC: inicia um chat com `requestId` e recebe eventos `ai:chunk` / `ai:done` / `ai:error`. Providers implementam uma interface única. O primeiro provider é o compatível com OpenAI, que cobre OpenAI, Groq, OpenRouter, Ollama, Gemini e endpoints custom.

**Stack:** `fetch` nativo do Node 20 (Electron 32), Server-Sent Events, Monaco diff editor, `marked@^14` + `dompurify@^3` (renderização de Markdown).

**Branch:** `feat/fase-2-ia`

## Restrições globais

- A chave nunca sai do main. Erros mostrados ao usuário nunca contêm a chave.
- Timeout de conexão: 15 s até o primeiro byte; sem timeout depois (streaming longo).
- Contexto enviado ao modelo: máx. 20 000 caracteres por arquivo e 4 000 da saída do terminal.
- Dependências novas: `marked@^14`, `dompurify@^3` (copiadas para `vendor/` pelo `setup-vendor.js`).

## Presets de provider

| `preset` | Nome na UI | `baseUrl` | Precisa de chave |
|---|---|---|---|
| `openai` | OpenAI | `https://api.openai.com/v1` | sim |
| `groq` | Groq (grátis) | `https://api.groq.com/openai/v1` | sim |
| `openrouter` | OpenRouter (tem modelos grátis) | `https://openrouter.ai/api/v1` | sim |
| `gemini` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | sim |
| `ollama` | Ollama (local) | `http://localhost:11434/v1` | não |
| `anthropic` | Anthropic | `https://api.anthropic.com/v1` | sim |
| `custom` | Endpoint compatível com OpenAI | informado pelo usuário | opcional |

## Foco de revisão

1. Chave inválida (401/403) → mensagem `Chave inválida ou sem permissão (401)`, sem stack trace e sem a chave.
2. Ollama desligado ou URL errada → `Não foi possível conectar a <baseUrl>` em até 15 s, sem travar a UI.
3. Usuário clica "Parar" no meio da resposta → stream abortado no main, mensagem parcial mantida com marca `(interrompida)`.
4. Resposta com HTML/script no Markdown → renderizado sanitizado (DOMPurify), sem execução.
5. Fechar a janela durante streaming → sem exceção no main (`isDestroyed()` antes de enviar).

---

### Tarefa 1: Parser de SSE

**Arquivos:** Criar `src/main/ai/sse.js`, `test/unit/sse.test.js`

**Interfaces:**
- Produz: `async function* parseSSE(stream: AsyncIterable<Uint8Array|string>) → AsyncGenerator<{ event: string|null, data: string }>`. Junta linhas `data:` de um mesmo evento com `\n`; evento termina em linha vazia; ignora linhas que começam com `:`; aceita `\r\n`.

- [ ] **Passo 1:** testes: `evento simples`; `evento quebrado entre chunks` (`['data: {"a"', ':1}\n\n']` → um evento `{"a":1}`); `CRLF`; `ignora comentário`; `campo event`; `múltiplos eventos num chunk`; `[DONE] é entregue como data` (o consumidor decide).
- [ ] **Passo 2:** FAIL → implementar (use `TextDecoder` com `stream: true`) → PASS.
- [ ] **Passo 3:** commit `feat(ai): parser de server-sent events`.

---

### Tarefa 2: Provider compatível com OpenAI

**Arquivos:** Criar `src/main/ai/providers/openai-compatible.js`, `src/main/ai/errors.js`, `test/unit/openai-compatible.test.js`

**Interfaces:**
- Consome: `parseSSE` (Tarefa 1).
- Produz:
  - `createOpenAICompatibleProvider({ baseUrl: string, apiKey?: string, fetchImpl = fetch, extraHeaders = {} }) → Provider`
  - `Provider` = `{ listModels(): Promise<string[]>, chat({ model: string, messages: Array<{role:'system'|'user'|'assistant', content:string}>, signal?: AbortSignal }): AsyncGenerator<string>, testConnection(): Promise<{ ok: true, models: number } | { ok: false, error: string }> }`
  - `listModels`: `GET {baseUrl}/models` → `data[].id` ordenado.
  - `chat`: `POST {baseUrl}/chat/completions` com `{ model, messages, stream: true }`; produz `choices[0].delta.content` não vazio; para em `data: [DONE]`.
  - Header `Authorization: Bearer <apiKey>` só se houver chave. OpenRouter: `extraHeaders` com `HTTP-Referer: https://github.com/rodrigoazevedo1988/agzos-code` e `X-Title: Agzos Code`.
  - `src/main/ai/errors.js`: `toUserError(err, { baseUrl }) → string`:
    - HTTP 401/403 → `Chave inválida ou sem permissão (<status>)`
    - HTTP 404 → `Endpoint ou modelo não encontrado (404)`
    - HTTP 429 → `Limite de uso atingido (429). Tente de novo em instantes.`
    - outro HTTP → `Erro do provider (<status>): <message do JSON, máx. 200 chars>`
    - falha de rede/timeout → `Não foi possível conectar a <baseUrl>`
    - `AbortError` → `Interrompido`

- [ ] **Passo 1:** testes com `fetchImpl` falso (retorna `new Response(...)` com `ReadableStream`): `listModels ordena ids`; `chat produz deltas na ordem`; `chat para em [DONE]`; `sem chave não envia Authorization`; `401 vira mensagem amigável`; `erro de rede vira Não foi possível conectar`; `abort interrompe o gerador`; `mensagem de erro nunca contém a chave` (chave `sk-SEGREDO`, varrer todas as mensagens).
- [ ] **Passo 2:** FAIL → implementar → PASS. Timeout de 15 s até a resposta HTTP via `AbortSignal.any([signal, AbortSignal.timeout(15000)])` só no `fetch` (não no consumo do stream).
- [ ] **Passo 3:** commit `feat(ai): provider compatível com OpenAI`.

---

### Tarefa 3: Provider Anthropic

**Arquivos:** Criar `src/main/ai/providers/anthropic.js`, `test/unit/anthropic.test.js`

**Interfaces:**
- Produz: `createAnthropicProvider({ baseUrl, apiKey, fetchImpl = fetch }) → Provider` (mesma interface).
  - Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
  - `listModels`: `GET {baseUrl}/models` → `data[].id`.
  - `chat`: `POST {baseUrl}/messages` com `{ model, max_tokens: 8192, stream: true, system, messages }` — mensagens `role: 'system'` viram o campo `system` (concatenadas). Produz `delta.text` dos eventos `content_block_delta`; para em `message_stop`.
  - Erros via `toUserError`.

- [ ] **Passo 1:** testes: `system vai para o campo system`; `produz texto de content_block_delta`; `ignora ping`; `401 amigável`.
- [ ] **Passo 2:** FAIL → implementar → PASS.
- [ ] **Passo 3:** commit `feat(ai): provider Anthropic`.

---

### Tarefa 4: Perfis de provider e fábrica

**Arquivos:** Criar `src/main/ai/presets.js`, `src/main/ai/profiles.js`, `test/unit/profiles.test.js`

**Interfaces:**
- Produz:
  - `PRESETS` — tabela "Presets de provider" acima: `{ [preset]: { label, baseUrl, needsKey, kind: 'openai'|'anthropic' } }`.
  - Perfil (em `settings.ai.profiles`): `{ id: string, preset: string, label: string, baseUrl: string, model: string|null }`. `id` = `crypto.randomUUID()`.
  - `profiles.js` (funções puras sobre `settings`):
    - `upsertProfile(settings, profile) → settings` (se é o primeiro perfil, vira ativo)
    - `removeProfile(settings, id) → settings` (se era o ativo, ativa o primeiro restante ou `null`)
    - `setActiveProfile(settings, id) → settings`
    - `getActiveProfile(settings) → profile | null`
    - `migrateLegacyAi(settings, store) → { settings, changed }`: se `settings.aiProvider` existe e não há perfis, cria perfil do preset correspondente, move a chave `ai.legacy` → `ai.<id>` e remove `aiProvider`.
  - `createProviderForProfile(profile, store, { fetchImpl } = {}) → Provider`: escolhe pelo `PRESETS[preset].kind`; chave = `store.get('ai.' + profile.id)`.

- [ ] **Passo 1:** testes: `primeiro perfil vira ativo`; `remover o ativo ativa o próximo`; `remover o último deixa null`; `migra aiProvider + ai.legacy`; `fábrica escolhe Anthropic para preset anthropic`.
- [ ] **Passo 2:** FAIL → implementar → PASS. Chamar `migrateLegacyAi` no boot, logo após `migrateLegacySecrets`.
- [ ] **Passo 3:** commit `feat(ai): perfis de provider e migração`.

---

### Tarefa 5: IPC de IA com streaming e cancelamento

**Arquivos:** Criar `src/main/ai/sessions.js`, `src/main/ipc/ai.js`, `test/unit/sessions.test.js`. Modificar `src/main/main.js`, `src/main/preload.js`

**Interfaces:**
- Produz:
  - `createChatSessions({ getProvider: (profileId?) => Provider, send: (channel, ...args) => void }) → { start(requestId, { profileId?, model?, messages }): void, cancel(requestId): void, cancelAll(): void }`. Envia `ai:chunk(requestId, text)`, `ai:done(requestId)`, `ai:error(requestId, mensagem)`. `send` checa `isDestroyed()` (feito no `ipc/ai.js`).
  - Canais IPC (`ipc/ai.js`):
    - `ai:presets` → `PRESETS`
    - `ai:profiles` → `{ activeProfileId, profiles }`
    - `ai:profile:save(profile, apiKey?)` → salva perfil; se `apiKey` vier, `store.set('ai.' + id, apiKey)`; retorna perfil salvo
    - `ai:profile:remove(id)` (apaga também a chave), `ai:profile:activate(id)`
    - `ai:models(profileId)` → `string[]`
    - `ai:test(profileDraft, apiKey?)` → resultado de `testConnection` (testa **sem salvar**)
    - `ai:detectOllama` → `boolean` (`GET http://localhost:11434/api/tags`, timeout 1500 ms)
    - `ai:chat(requestId, payload)`, `ai:cancel(requestId)`
  - Preload: `agzos.ai.{ presets, profiles, saveProfile, removeProfile, activateProfile, models, test, detectOllama, chat, cancel, onChunk(cb), onDone(cb), onError(cb) }` (os `on*` retornam função de unsubscribe, como `term.onData`).

- [ ] **Passo 1:** testes de `sessions.test.js` com provider falso (gerador com `await` entre chunks): `envia chunks e done`; `cancel aborta e envia error Interrompido`; `erro do provider vira ai:error com texto amigável`; `cancelAll aborta tudo`.
- [ ] **Passo 2:** FAIL → implementar → PASS. `window-all-closed` chama `cancelAll()`.
- [ ] **Passo 3:** commit `feat(ai): IPC de chat com streaming e cancelamento`.

---

### Tarefa 6: Servidor falso para E2E

**Arquivos:** Criar `test/e2e/fake-openai.js`

**Interfaces:**
- Produz: `startFakeOpenAI({ reply = 'Olá do fake', status = 200 } = {}) → Promise<{ baseUrl: string, close(): Promise<void>, requests: Array<{ path, headers, body }> }>`. HTTP em `127.0.0.1` porta aleatória. `GET /v1/models` → `{ data: [{ id: 'fake-1' }, { id: 'fake-2' }] }`. `POST /v1/chat/completions` → SSE com a `reply` em pedaços de 3 caracteres, 20 ms entre eles, depois `[DONE]`. `status != 200` → responde esse status com `{ error: { message: 'erro fake' } }`.

- [ ] **Passo 1:** implementar e validar com um teste rápido em `test/unit/fake-openai.test.js` usando o próprio `createOpenAICompatibleProvider` contra o servidor (`chat` junta `Olá do fake`).
- [ ] **Passo 2:** commit `test: servidor OpenAI falso para e2e`.

---

### Tarefa 7: Wizard de IA

**Arquivos:** Criar `src/renderer/scripts/ai-wizard.js`, `test/e2e/ai-wizard.spec.js`. Modificar `src/renderer/index.html` (overlay `#ai-wizard-overlay`), `src/renderer/styles/app.css` (reusar classes `.onb-*`), `src/renderer/scripts/app.js` (botão em Configurações), `src/renderer/scripts/command-palette.js`, `src/renderer/scripts/onboarding.js` (botão no passo final), `src/renderer/scripts/welcome.js`

**Interfaces:**
- Produz: `openAIWizard({ profileId?: string } = {}) → Promise<boolean>` (resolve `true` se salvou).
- Passos (seguir PRD §6.1):
  1. **Boas-vindas** — o que a IA faz, que a chave fica no cofre do sistema.
  2. **Provider** — cards dos presets; se `detectOllama()` for `true`, card Ollama com selo `Detectado`.
  3. **Chave** — input password (pula se `needsKey: false`); `custom` também pede `baseUrl`; link "Onde pego minha chave?" via `agzos.app.openExternal`.
  4. **Modelo** — `select` populado por `agzos.ai.test(draft, key)` → depois `models`; se falhar, mostra o erro e permite voltar.
  5. **Teste** — botão "Testar conexão"; sucesso ✅ `<N> modelos disponíveis`; erro ❌ com mensagem.
  6. **Contexto** — checkboxes salvos em `settings.ai.context = { file: true, selection: true, terminal: false }`.
  7. **Pronto** — atalhos: `Ctrl+Shift+A` abre o chat; `Ctrl+L` envia seleção ao chat.
- Pontos de entrada: Configurações → botão `Configurar IA` (substitui os campos antigos Provider/API Key); Command Palette `IA: Configurar provider`; passo final do onboarding → botão `Configurar IA agora`; status bar `#status-ai` clicável.

- [ ] **Passo 1:** E2E: `configura endpoint custom pelo wizard` → `startFakeOpenAI`; abrir wizard via `page.evaluate`; escolher `custom`; preencher `baseUrl` = `<fake>/v1` e chave `sk-teste`; modelo `fake-1`; testar → texto `2 modelos disponíveis`; concluir; `readSettings().ai.profiles.length === 1`; `settings.json` não contém `sk-teste`; `#status-ai` contém `fake-1`.
- [ ] **Passo 2:** E2E: `chave inválida mostra erro amigável` → fake com `status: 401` → texto `Chave inválida ou sem permissão (401)`.
- [ ] **Passo 3:** FAIL → implementar → PASS.
- [ ] **Passo 4:** commit `feat(ai): wizard de configuração`.

---

### Tarefa 8: Painel de chat com streaming

**Arquivos:** Criar `src/renderer/scripts/markdown.js`, `src/main/ipc/chat-history.js`, `test/e2e/ai-chat.spec.js`. Reescrever `src/renderer/scripts/ai-chat.js`. Modificar `tools/setup-vendor.js` (copiar `marked` e `dompurify` para `vendor/`), `src/renderer/index.html` (scripts vendor + estrutura do `#panel-ai`), `src/renderer/styles/app.css`, `src/main/preload.js`

**Interfaces:**
- Produz:
  - `markdown.js`: `renderMarkdown(text: string) → string` (HTML sanitizado com DOMPurify; blocos de código ganham botões `Copiar` e `Aplicar` via atributo `data-code-index`).
  - `ai-chat.js`: `setupAI()` (mesmo nome de hoje), `sendToChat(text: string, opts?: { includeSelection?: boolean }) → void`, `focusChat() → void`.
  - Histórico: `chat:history:load(workspaceRoot|null) → Message[]`, `chat:history:save(workspaceRoot|null, messages)`; arquivo `<userData>/chats/<sha1(workspaceRoot ou 'global')>.json`; máx. 200 mensagens.
- UI do `#panel-ai`: seletor de perfil/modelo no topo; lista de mensagens; textarea (Enter envia, Shift+Enter quebra linha); botão Enviar que vira **Parar** durante streaming; botão `Nova conversa`. Sem perfil configurado: estado vazio com botão `Configurar IA` (abre wizard).
- Streaming: acumula texto e re-renderiza Markdown no máx. a cada 50 ms. Interrompida: anexa ` _(interrompida)_`.

- [ ] **Passo 1:** E2E com fake: `responde com streaming` (texto final `Olá do fake`); `parar interrompe` (fake com reply longa; clicar Parar; aparece `(interrompida)`); `html no markdown é sanitizado` (reply `<img src=x onerror="window.__xss=1">` → `window.__xss` indefinido); `histórico persiste após reiniciar`.
- [ ] **Passo 2:** FAIL → implementar → PASS.
- [ ] **Passo 3:** commit `feat(ai): painel de chat com streaming e histórico`.

---

### Tarefa 9: Contexto do editor e do terminal

**Arquivos:** Criar `src/renderer/scripts/ai-context.js`, `test/unit/ai-context.test.js`. Modificar `src/renderer/scripts/terminal.js`, `src/renderer/scripts/ai-chat.js`

**Interfaces:**
- Produz:
  - `terminal.js`: `getRecentOutput(maxChars = 4000) → string` (buffer circular do texto recebido, sem sequências ANSI).
  - `ai-context.js` (puro, sem DOM — testável com `node --test`):
    `buildContextMessage({ file?: { path, language, content }, selection?: { text, startLine, endLine }, terminal?: string }, { maxFileChars = 20000, maxTerminalChars = 4000 } = {}) → string | null`.
    Formato: seções `### Arquivo: <path> (<language>)` + bloco de código; `### Seleção (linhas X–Y)`; `### Saída recente do terminal`. Conteúdo maior que o limite: corta e adiciona `… (truncado)`. Tudo vazio → `null`.
- Chips no chat (`Arquivo`, `Seleção`, `Terminal`) ligam/desligam cada fonte; padrão vem de `settings.ai.context`. A mensagem de contexto vai como `role: 'system'` antes da pergunta e **não** aparece no histórico visível.

- [ ] **Passo 1:** testes unitários: `null sem contexto`; `trunca arquivo grande`; `inclui seleção com linhas`; `remove nada do conteúdo dentro do limite`.
- [ ] **Passo 2:** FAIL → implementar → PASS.
- [ ] **Passo 3:** E2E: abrir arquivo com `const segredo = 42`, perguntar no chat; `fake.requests.at(-1).body` contém `const segredo = 42`.
- [ ] **Passo 4:** commit `feat(ai): contexto de arquivo, seleção e terminal`.

---

### Tarefa 10: Comandos rápidos e aplicar código

**Arquivos:** Criar `src/renderer/scripts/diff-view.js`, `src/renderer/scripts/ai-apply.js`, `test/e2e/ai-apply.spec.js`. Modificar `src/renderer/scripts/editor.js`, `src/renderer/scripts/command-palette.js`, `src/renderer/scripts/ai-chat.js`, `src/renderer/scripts/app.js` (atalhos), `src/renderer/index.html`

**Interfaces:**
- Produz:
  - Ações do Monaco (`editor.addAction`, menu de contexto, grupo `agzos-ai`): `Agzos IA: Explicar`, `Refatorar`, `Documentar`, `Gerar testes`. Cada uma chama `sendToChat(<prompt fixo abaixo>, { includeSelection: true })` e guarda o **alvo** (`{ path, range }` da seleção, ou arquivo inteiro sem seleção).
    - Explicar: `Explique o código selecionado de forma objetiva.`
    - Refatorar: `Refatore o código selecionado mantendo o comportamento. Responda só com o código final em um bloco.`
    - Documentar: `Adicione comentários de documentação ao código selecionado. Responda só com o código final em um bloco.`
    - Gerar testes: `Escreva testes para o código selecionado.`
  - Atalhos: `Ctrl/Cmd+Shift+A` abre/foca o chat; `Ctrl/Cmd+L` envia a seleção ao chat.
  - `diff-view.js` (genérico, reusado na Fase 3): `showDiff({ title: string, original: string, modified: string, language: string, readOnly = false, applyLabel = 'Aplicar' }) → Promise<boolean>` — overlay com `monaco.editor.createDiffEditor`. `readOnly: true` mostra só `Fechar` e resolve `false`. Senão, botões `<applyLabel>` (resolve `true`) e `Descartar` (resolve `false`).
  - `ai-apply.js`: `showApplyDiff({ path: string, range: monaco.IRange|null, newText: string }) → Promise<boolean>` — usa `showDiff` (original = trecho atual, modified = proposta). Se aceito, aplica com `model.pushEditOperations` (fica no Ctrl+Z) e marca a aba como alterada; **não** salva em disco.
  - Botão `Aplicar` dos blocos de código: alvo = último alvo guardado se houver; senão, seleção atual; senão, arquivo inteiro do editor ativo.

- [ ] **Passo 1:** E2E: arquivo `a.js` com `function soma(a,b){return a+b}`; selecionar tudo; executar `Refatorar` via `page.evaluate` na ação do Monaco; fake responde bloco ```` ```js\nconst soma = (a, b) => a + b;\n``` ````; clicar `Aplicar` no bloco; diff aparece; clicar `Aplicar` no overlay; conteúdo do modelo = `const soma = (a, b) => a + b;`; aba com indicador de alterado.
- [ ] **Passo 2:** FAIL → implementar → PASS.
- [ ] **Passo 3:** commit `feat(ai): comandos rápidos e aplicar código com diff`.

---

### Tarefa 11: Documentação e relatório

- [ ] **Passo 1:** atualizar `docs/tecnico/arquitetura.md` (seção IA: fluxo main↔renderer, presets, onde ficam chaves e histórico), `README.md` (como configurar IA), `docs/plano/ROADMAP.md`.
- [ ] **Passo 2:** commit `docs: fase 2 — IA`.
- [ ] **Passo 3:** relatório `docs/plano/relatorios/fase-2-relatorio.md`, commit, push, PR `Fase 2 — IA` com o relatório no corpo. **Não fazer merge.**

## Critério de saída

Com uma chave Groq gratuita: wizard configura em menos de 2 min, chat responde com streaming, "Refatorar" + "Aplicar" funcionam num arquivo real. CI verde. Rodrigo testou no Mac.
