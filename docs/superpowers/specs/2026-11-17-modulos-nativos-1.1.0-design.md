# Agzos Code 1.1.0 — Módulos nativos (Onda 1)

Data: 2026-11-17 · Desenho aprovado pelo usuário em chat.
Origem: PRD "Utilidades Nativas para Desenvolvimento Web/SaaS" v1.1 (17/11/2026).

## Contexto e decisões

O PRD v1.1 pede cinco utilidades nativas (sem marketplace/extensões): Vassoura de Produção, Cofre .env, Snippets, Sandbox de Componentes e Git Slider. Decisões tomadas com o usuário:

- **Entrega em 3 ondas:** 1.1.0 = base F0 + Vassoura + Cofre .env (este documento); 1.2.0 = Snippets + Git Slider/histórico local; 1.3.0 = Sandbox, com spec escrita a partir de um spike feito em paralelo à Onda 1.
- **Snippets em JSON** no `userData` (não SQLite/better-sqlite3: módulo nativo complica o build Windows via wine com `npmRebuild:false`). Vale para a Onda 2.
- **Activity bar:** o botão placeholder "Extensões" vira **Módulos Agzos**, um hub com os módulos.
- **Sandbox (Onda 3):** compila o arquivo + imports do projeto (relativos, aliases do tsconfig, `node_modules` do projeto se houver), com shims para `next/link`/`next/image` e React/Tailwind embutidos.
- **UI continua em JS puro** (o PRD menciona React; o app não usa React e não será introduzido).

Restrições herdadas: `contextIsolation` + `contextBridge`, sem `nodeIntegration`; caminhos validados pelo `path-guard`; desfazer via checkpoints do agente; opções nas Configurações; e2e cobrindo os fluxos.

---

## F0 — Base dos módulos nativos

Precisa estar pronta antes de V e C.

### F0.1 Host de processo utilitário — `src/main/modules/worker-host.js`
- `createWorkerHost({ script, idleMs = 60000 })` → `{ call(method, params, { signal }) → Promise, dispose() }`.
- Cria um `utilityProcess.fork(script)` sob demanda (primeira chamada) e o encerra após `idleMs` sem chamadas pendentes.
- Protocolo por mensagem: `{ id, method, params }` → `{ id, ok, result | error }`; `{ id, cancel: true }` cancela. `AbortSignal` rejeita a promessa com `AbortError` e envia o cancelamento.
- Se o processo morrer, as chamadas pendentes rejeitam com erro claro e a próxima chamada recria o processo.
- Testável sem Electron: o host aceita uma fábrica `fork` injetável (os testes unitários usam `child_process.fork`).

### F0.2 Ferramentas de módulos para o agente
- `createToolbox({ …, extraTools = [] })` passa a aceitar ferramentas extras: `{ definition, kind, prepare(input, ctx) }`.
  - `kind`: `'read' | 'write' | 'command'` — define como o modo de autonomia trata a ferramenta (`read` livre; `write` segue a regra de criar/editar; `command` segue a regra de comando).
  - `ctx` expõe `resolvePath`, `rel`, `checkpoint` (registrar arquivo antes de alterar) e `readTextFile`.
- `src/main/modules/agent-tools.js` agrega as ferramentas de todos os módulos; `session.js` as passa ao `createToolbox`.
- As ferramentas entram no `definitions` enviado ao modelo apenas se o módulo estiver habilitado nas Configurações.

### F0.3 Hub "Módulos Agzos"
- `index.html`: o botão `data-view="extensions"` vira `data-view="modules"` (ícone `blocks`, título "Módulos Agzos (Ctrl+Shift+X)"); `#panel-extensions` vira `#panel-modules`. `Ctrl+Shift+X` abre o hub.
- `src/renderer/scripts/modules-hub.js`: registro `registerModule({ id, label, icon, description, open() })` e lista de cards (ícone, nome, descrição, estado habilitado). Clicar num card chama `open()`, que troca o conteúdo do painel para a view do módulo, com botão "← Módulos" no topo.
- Cards na 1.1.0: Vassoura de Produção, Cofre .env. Snippets, Sandbox e Git Slider aparecem como "Em breve" (desabilitados).

### F0.4 Configurações
- Nova categoria `modules` ("Módulos Agzos", ícone `blocks`) no `settings-modal.js`, com subseções por módulo.
- Chaves em `settings.modules` com defaults e normalização em `src/main/lib/settings.js` (valor inválido volta ao padrão, campo a campo), seguindo o padrão de `aiPanel`/`aiAgent`:

```js
modules: {
  broom: {
    enabled: true,
    rules: { console: true, comments: true, unusedImports: true, deadCode: true },
    keepConsole: ['error', 'warn'],
    keepComments: ['jsdoc', 'directives', 'license'],
    statusBar: true,
  },
  envVault: {
    enabled: true,
    blockCommits: true,
    extraPatterns: [],          // [{ name, regex }]
    allowlist: [],              // valores/hashes de valores que nunca bloqueiam
    revealTimeoutSec: 10,
  },
}
```

### F0.5 Medição de RAM — `tools/measure-ram.js`
- Abre o app via Playwright (mesmo `launchApp` do e2e), espera ociosidade, soma `app.getAppMetrics()` (workingSetSize) e imprime JSON `{ idleMB, withModulesMB, deltaMB }` depois de rodar a Vassoura no workspace de fixture e abrir o Cofre.
- Um e2e chama o script e **registra** o resultado no relatório; o limite (< 50 MB para a Vassoura) é verificado e reportado, mas não reprova a suíte (ruído entre máquinas).

---

## V — Vassoura de Produção

### Motor — `src/main/modules/broom/`
- `analyze.js` (roda dentro do worker do F0.1): `analyze(text, { lang, rules, keepConsole, keepComments }) → { edits: [{ start, end, rule, line, preview }] }`.
  - Parse com `ts.createSourceFile(name, text, ScriptTarget.Latest, true, ScriptKind)` — **sem** `Program`/type checker. `typescript` passa a ser dependência de runtime (`dependencies`), carregada só dentro do worker.
  - Linguagens: `.ts .tsx .js .jsx .mjs .cjs`. Outros arquivos: `edits: []`.
  - As edições são **intervalos de remoção sobre o texto original**; o texto nunca é re-impresso. Ao remover uma instrução/linha inteira, a remoção inclui o recuo e a quebra de linha da linha, para não deixar linhas em branco órfãs.
- **Regras:**
  - `console`: `ExpressionStatement` cuja expressão é chamada a `console.<método>` (inclusive `console.log?.()`), exceto métodos em `keepConsole`. Chamada de console usada como valor (ex.: `a && console.log(x)`, argumento, retorno de arrow sem bloco) **não** é removida.
  - `comments`: comentários obtidos por `ts.getLeadingCommentRanges`/`getTrailingCommentRanges` percorrendo os tokens. Mantidos: `/** … */` (jsdoc), diretivas (`// @ts-…`, `eslint-…`, `prettier-ignore`, `/// <reference`, `# sourceMappingURL`, `@jsx…`, `webpackChunkName`), licença (`/*! … */` e comentários com `@license`/`@preserve`) e shebang `#!`. Comentários dentro de JSX (`{/* … */}`) são removidos junto com as chaves.
  - `unusedImports`: para cada `ImportDeclaration`, conta referências sintáticas de cada nome importado no restante do arquivo (identificadores, inclusive em tipos e JSX `<Nome>`); propriedades de objeto (`a.Nome`) e chaves de objeto não contam como uso. Remove só os especificadores não usados; se todos saírem, remove a declaração. Nunca remove `import 'x'` (efeito colateral) nem `import React` em arquivos JSX/TSX quando houver JSX (runtime clássico).
  - `deadCode`: instruções depois de `return`/`throw`/`break`/`continue` no mesmo bloco (exceto declarações `function`, que sofrem hoisting); blocos `if (false)`/`if (0)` (sem `else`: remove tudo; com `else`: mantém só o conteúdo do `else`) — só literais, sem avaliar expressões.
- Arquivo com erro de sintaxe (`parseDiagnostics`) → `{ edits: [], error }`; nunca altera.
- `apply.js`: aplica as edições em ordem decrescente de `start`; função pura testada.
- Cache de análise por `path+mtime+size+hash das regras` em memória no main (LRU de 200 arquivos), invalidado ao salvar (`agzos:file-saved`) e por mudança de regras.

### IPC — `src/main/ipc/broom.js`, preload `window.agzos.broom`
- `analyzeFile(path)` → `{ count, byRule: { console, comments, unusedImports, deadCode }, edits, error? }`.
- `cleanFile(path, { editIds? })` → aplica (todas ou as escolhidas), cria checkpoint, devolve `{ checkpointId, removed }`.
- `scanWorkspace(requestId)` → progresso por evento `broom:event` `{ type: 'progress', done, total, path }` e `{ type: 'done', files: [{ path, count, byRule }] }`; ignora `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage` e arquivos > 1 MB; máx. 5000 arquivos.
- `cleanWorkspace(requestId, paths)` → aplica nos arquivos escolhidos com um único checkpoint; `{ checkpointId, files, removed }`.
- `cancel(requestId)`; `undo(checkpointId)` (reaproveita `createCheckpointStore`, diretório `userData/broom-checkpoints/`, máx. 20).
- Todo caminho passa pelo `path-guard` do workspace.

### Interface — `src/renderer/scripts/broom.js` + `styles/modules.css`
- **Comandos da paleta:** "Agzos: Limpar Código de Produção (arquivo atual)", "Agzos: Limpar Código de Produção (workspace)", "Agzos: Desfazer última limpeza".
- **Status bar:** item `🧹 N` para o arquivo ativo (oculto se 0 ou linguagem não suportada, ou `statusBar: false`); clique abre o preview do arquivo.
- **Preview de arquivo:** `diff-view.js` com o original e o resultado, botão "Limpar" (aplica) — se o arquivo estiver sujo no editor, pede para salvar antes.
- **View no hub (Vassoura):** botão "Analisar workspace" com barra de progresso e Cancelar; lista de arquivos com `−N` e chips por regra; checkbox por arquivo; clique abre o diff; "Limpar selecionados"; depois de aplicar, toast com "Desfazer".
- **Menu de contexto:** Explorer (arquivo ou pasta → "Limpar código de produção") e editor.
- **Badge no Explorer:** contador discreto ao lado de arquivos já analisados (abertos, ou presentes no último scan); recalcula ao salvar. Não analisa a árvore inteira por conta própria.
- Arquivos abertos e alterados pela limpeza recarregam pelo mesmo caminho de `file_changed` do agente.

### Ferramenta do agente
- `clean_code({ path, rules? })`, `kind: 'write'`: analisa e aplica em um arquivo (ou pasta, até 200 arquivos), registra no checkpoint da conversa e devolve `{ files, removed, byRule }`. Preview de aprovação mostra o diff, como `edit_file`.

### Testes
- Unit (`test/unit/broom-*.test.js`), com fixtures:
  - `"console.log(1)"` dentro de string e template; `` `${console.log(x)}` `` intacto; `console.log` como valor intacto; `console.error` mantido por padrão.
  - JSX com `{/* comentário */}` removido; `// @ts-ignore`, `/*! license */`, `/** doc */` e shebang mantidos; `"// não é comentário"` em string intacto; URL `http://` em string intacta.
  - imports: default/named/namespace/type-only; uso só em tipo conta; uso em JSX conta; `a.Nome` não conta; efeito colateral mantido; remoção parcial de especificadores.
  - dead code após `return`; `function` hoisted mantida; `if (false) {…} else {…}`.
  - arquivo com erro de sintaxe → sem edições; aplicar é idempotente (segunda análise → 0 edições) e o resultado faz parse sem erros.
- Unit do `worker-host` (cria sob demanda, idle encerra, cancelamento, processo morto rejeita pendentes e recria).
- E2E: abrir arquivo com lixo → status bar mostra contagem → preview → limpar → conteúdo esperado → "Desfazer" restaura; scan do workspace lista arquivos e respeita Cancelar; agente fake chama `clean_code`.

---

## C — Cofre .env

### Motor — `src/main/modules/envvault/`
- `parse.js`: parser dotenv que preserva posição: `export`, aspas simples/duplas/crase, valores multilinha entre aspas duplas, `#` comentário (inclusive no fim da linha fora de aspas), linhas vazias. Saída `[{ key, value, line, quoted }]` + `serialize(entries, original)` que edita só a linha alterada.
- `compare.js`: dado `.env.example` (ou `.env.sample`/`.env.template`) e cada `.env*`, devolve `missing` (no example, não no arquivo), `extra` (no arquivo, não no example) e `empty`.
- `detect.js`: `detectSecrets(text, { extraPatterns, allowlist }) → [{ line, column, rule, preview }]` (o `preview` mascara o valor: 4 primeiros caracteres + `…`).
  - Padrões embutidos: AWS access key (`AKIA|ASIA[0-9A-Z]{16}`) e secret em atribuição `aws_secret…`, Stripe (`sk_live_`, `rk_live_`, `sk_test_`), OpenAI (`sk-proj-`, `sk-…` de 40+), Anthropic (`sk-ant-`), GitHub (`ghp_`, `gho_`, `ghs_`, `ghu_`, `github_pat_`), Google API key (`AIza…`), Slack (`xox[baprs]-`), Supabase/JWT (`eyJ…\.eyJ…\.…` com `service_role` ou chave longa), chaves privadas (`-----BEGIN … PRIVATE KEY-----`), URLs com credenciais (`scheme://user:pass@`).
  - Atribuição genérica: chave com `SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY` e valor de alta entropia (Shannon ≥ 3.5, comprimento ≥ 16) fora de placeholders (`xxx`, `changeme`, `your-…`, `<…>`, `${…}`).
  - Falsos positivos evitados: hashes em lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` ignorados), `integrity: sha512-…`, UUIDs isolados.
- Valores **nunca** são logados nem enviados ao modelo.

### Bloqueio de commit
- `ipc/git.js` `git:commit`: com `modules.envVault.enabled && blockCommits`, antes de commitar roda `git diff --cached -U0 --no-color --no-ext-diff` e passa só as linhas adicionadas (`+`) pelo `detectSecrets`. Também bloqueia arquivo `.env`/`.env.*` (exceto `*.example|*.sample|*.template`) que esteja staged.
- Achados → erro `{ kind: 'secrets_detected', findings: [{ file, line, rule, preview }] }` sem commitar.
- `git:commit` aceita `options.ignoreSecretsOnce: true` → commita e grava uma linha em `userData/envvault-overrides.log` (`data · repo · arquivos · regras`, sem valores).
- Painel Git: diálogo "Commit bloqueado: possíveis segredos" listando arquivo:linha:regra (clique abre o arquivo na linha), botões **Cancelar** (padrão), **Remover do stage** (unstage dos arquivos apontados) e **Ignorar uma vez**. "Commit e Push" segue o mesmo fluxo.
- **Agente:** em `run_command`, se o comando bate `\bgit\b[^;|&]*\bcommit\b`, o `prepare` roda a mesma varredura do staged; havendo achados, o comando vira de risco (sempre pede OK, motivo "commit com possíveis segredos").
- **Hook opcional:** botão "Instalar proteção pre-commit" na view do Cofre: grava `.git/hooks/pre-commit` (só se não existir; senão mostra instrução) com um script sh que chama `git diff --cached` + padrões principais via `grep -E`, para commits feitos no terminal. Remover = botão "Remover proteção" (apaga só se for o arquivo gerado, identificado por marcador).

### IPC — `src/main/ipc/envvault.js`, preload `window.agzos.envVault`
- `list()` → arquivos `.env*` da raiz do workspace (e de subpastas até profundidade 3, ignorando `node_modules`), cada um `{ path, entries: [{ key, masked, line, flags: { secret, empty, missing, extra } }], compare }`. **Sem valores.**
- `reveal(path, key)` → `{ value }` (uma chamada por clique; o renderer limpa da tela após `revealTimeoutSec`).
- `setValue(path, key, value)`, `addKey(path, key, value)`, `removeKey(path, key)` — edição pontual com checkpoint.
- `generateExample(path)` → cria/atualiza `.env.example` com as chaves e valores vazios (mantém comentários).
- `copy(path, key)` → copia o valor para a área de transferência no main (o valor não passa pelo renderer).
- `scanStaged()` → achados do staged (usado pela view e pelo diálogo).
- `installHook()` / `removeHook()` / `hookStatus()`.

### Interface — `src/renderer/scripts/envvault.js`
- View no hub "Cofre .env": um cartão por arquivo (`.env`, `.env.local`, `.env.development`, `.env.production`…), linhas chave/valor com valor `••••••••`; revelar com **clique longo (500 ms)** ou `Alt` pressionado sobre a linha; esconde após `revealTimeoutSec`; ícones copiar/editar/remover.
- Selos por linha: `segredo` (vermelho), `vazia`, `faltando no example`, `não está no example`. Topo: resumo (N segredos, N faltando) e botões "Gerar .env.example", "Verificar staged", "Instalar proteção pre-commit".
- Aviso quando `.env` não está no `.gitignore`, com botão "Adicionar ao .gitignore".
- Abrir um `.env` no editor continua possível (é texto normal); a máscara vale para a view do Cofre.

### Ferramenta do agente
- `env_check({})`, `kind: 'read'`: devolve `{ files: [{ path, keys, missing, extra, empty, secrets: [{ key, rule }] }], stagedFindings }` — **nunca valores**.

### Testes
- Unit: parser (aspas, multilinha, `export`, comentário no fim, serialize preserva o resto), compare, detector (cada padrão positivo; placeholders, UUID, sha512 de lockfile e `process.env.X` negativos; mascaramento do preview), varredura de diff `-U0`.
- Unit do bloqueio no `git:commit` com repositório temporário: segredo staged bloqueia; `ignoreSecretsOnce` commita e grava log sem valor; `.env` staged bloqueia; `.env.example` passa.
- Unit da regra do agente (`git commit` com staged sujo vira risco).
- E2E: view lista `.env` com valores mascarados (o valor não aparece no DOM antes de revelar); revelar e esconder; gerar `.env.example`; commit com segredo mostra o diálogo e não cria commit; "Ignorar uma vez" cria.

---

## Spike do Sandbox (paralelo, descartável)

Pasta `spikes/sandbox/` (fora do `src/`, não vai para o build e é apagada ao fim). Responder, com números medidos nesta VPS:
1. `esbuild-wasm` compila um componente React médio (≈ 300 linhas + 5 imports locais) em < 500 ms a frio e a quente?
2. Resolução de aliases do `tsconfig.json` (`paths`) e de `node_modules` do projeto via plugin de resolução.
3. Shims mínimos de `next/link`, `next/image`, `next/router`/`next/navigation`.
4. Qual build do Tailwind roda offline no iframe (v3 standalone/JIT no browser vs v4 `@tailwindcss/browser`) lendo o `tailwind.config` do projeto, e o custo.
5. RAM do processo isolado (`WebContentsView` com `partition` própria vs iframe sandbox no renderer).
Saída: `docs/superpowers/specs/2026-11-17-sandbox-spike.md` com recomendação. Nenhum código do spike entra em `src/`.

---

## Fora do escopo da 1.1.0
- Snippets, Git Slider/histórico local e Sandbox (ondas 2 e 3).
- Type checker na Vassoura (imports usados só via `declare global`/augmentations podem ser falsos "não usados" — mitigado pelo preview).
- Varredura de segredos no histórico do git (só staged).
- Criptografar arquivos `.env` em disco.

## Entrega
- Versão `1.1.0`, CHANGELOG, README (funcionalidades), ROADMAP (Onda 1 concluída).
- `npm run check` e e2e verdes; medição de RAM no relatório.
- Build Linux + Windows na VPS, publicação no OTA mantendo 2 releases.
