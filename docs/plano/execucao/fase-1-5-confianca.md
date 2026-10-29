# Fase 1.5 — Confiança e integridade: Plano de Implementação

> **Para o executor:** leia antes o [guia do executor](00-guia-do-executor.md). Pré-requisito: PR #3 mergeado e [ADR-0002](../../decisoes/ADR-0002-electron-e-codigo-nativo.md) aceito. Branch: `feat/fase-1-5-confianca`.

**Objetivo:** o editor não perde trabalho, não corrompe arquivo, não mente na interface e não quebra em fluxos básicos. É o gate para a Fase 2 (IA).

**Fora de escopo:** IA, Git, terminal com pty, ripgrep, multi-janela completa, tema visual novo.

**Stack:** Electron 44.x, CommonJS no main, ESM no renderer, Playwright + `node --test`.

## Foco de revisão

1. Editar arquivo, tentar fechar a janela e escolher **Cancelar** → nada é perdido; **Descartar** fecha; **Salvar tudo** grava.
2. Abrir `latin1.txt`, UTF-16 e um PNG → nada é salvo com `U+FFFD` por acidente; arquivo não suportado abre somente leitura.
3. Criar arquivo/pasta, renomear e excluir pela UI → funciona; renomear arquivo aberto não deixa aba órfã.
4. `.env` e `.github` aparecem no Explorer e na busca; `node_modules` fica oculto; clique no resultado posiciona a linha.
5. Status bar não apaga mais os ícones; encoding/EOL refletem o arquivo; Monokai é real ou não aparece.
6. Erro no renderer mostra fallback com “Recarregar”, não tela preta; log em `userData/logs/`.

---

## Tarefa 1.1 — Merge do PR #3 e base atualizada

**Status:** concluída em 28/10/2026.

- PR #3 mergeado em squash (`d203eed`): árvore vertical, clique único, menu de contexto no diretório certo, temas de ícones; branch antiga removida.
- Electron 44.10.0 + electron-builder 26.18.0; ADR-0002.
- Assinatura local macOS (`tools/sign-mac-dev.js`, `sign-mac-app.js`, `afterPack`) e bundle id `com.agzos.code`.
- Workflow `.github/workflows/build.yml` para os três sistemas.

---

## Tarefa 1.2 — Proteção de alterações não salvas

**Arquivos:** modificar `src/main/main.js`, `src/main/preload.js`, criar `src/main/ipc/window-state.js`, `src/renderer/scripts/close-guard.js`, `test/e2e/close-guard.spec.js`.

**Interfaces:**
- Main rastreia `dirtyCount` por `webContents.id`, atualizado por `window:dirty(count)`.
- No evento `close` da janela e em `before-quit`, se `dirtyCount > 0`, envia `window:request-close` e espera `window:close-response('save-all'|'discard'|'cancel')`.
- Renderer mostra modal com os três botões; `save-all` chama `saveActive` de cada aba dirty; `cancel` aborta o fechamento.
- `Cmd/Ctrl+W` fecha a aba ativa (não a janela) quando o editor tem foco; sem abas, fecha a janela.
- Título da janela: `● arquivo — Agzos Code` quando dirty.

**Passos:**
1. E2E: abrir arquivo, digitar, `page.close()`/`app.close()` → modal aparece; Cancelar mantém; Descartar fecha; Salvar grava.
2. Implementar; rodar `npm run check` e E2E.
3. Commit `feat: protege alterações não salvas ao fechar`.

---

## Tarefa 1.3 — Integridade de arquivos (encoding, EOL, binário)

**Arquivos:** modificar `src/main/ipc/fs.js`, criar `src/main/lib/file-encoding.js`, `test/unit/file-encoding.test.js`, modificar `src/renderer/scripts/editor.js`, `src/renderer/index.html`, `src/renderer/scripts/app.js`.

**Interfaces:**
- `fs:readFile` retorna `{ content, size, mtime, encoding, eol, binary, readOnly }`.
- Detecção: BOM UTF-8/UTF-16LE/BE; UTF-16 sem BOM por heurística de NUL; UTF-8 válido; binário por NUL/controle; senão `unknown`.
- `encoding: 'utf8' | 'utf8-bom' | 'utf16le' | 'utf16be' | 'binary' | 'unknown'`.
- Arquivo `binary`/`unknown` abre somente leitura em Monaco (`readOnly: true`) com aviso e botão “Abrir como texto/UTF-8” (explícito).
- Salvar: mesma codificação/EOL; se não suportado, bloquear e oferecer “Salvar como UTF-8” com backup `.bak`.
- Escrita atômica `arquivo.tmp` + `rename`, preservando modo.
- Status bar mostra encoding/EOL reais.

**Passos:**
1. Testes unitários das fixtures (UTF-8, BOM, UTF-16LE/BE, CRLF, LF, Latin-1, PNG).
2. Implementar main + renderer.
3. E2E: abrir Latin-1 e verificar somente leitura; abrir UTF-8 e salvar preservando CRLF.
4. Commit `feat: integridade de encoding, EOL e binários`.

---

## Tarefa 1.4 — Diálogos internos e operações de arquivo

**Arquivos:** criar `src/renderer/scripts/dialog.js`, modificar `src/renderer/scripts/app.js`, `src/renderer/scripts/file-tree.js`, `src/main/ipc/app-info.js`, `src/main/preload.js`, `test/e2e/file-ops.spec.js`.

**Interfaces:**
- `showInputDialog({ title, label, value, validate }) → Promise<string|null>`; Enter confirma, Esc cancela, foco preso.
- Substituir as 5 chamadas de `prompt()`.
- Renomear: remover chave antiga, atualizar `path`, `State.activePath`, aba; renomear diretório atualiza descendentes.
- Excluir: fechar abas afetadas; confirmar com nome.
- Context menu em arquivo usa `dirname(target)` para novo arquivo/pasta.
- `app:reveal(path)` no main chama `shell.showItemInFolder`, restrito ao path guard.

**Passos:**
1. E2E: novo arquivo, nova pasta, renomear aberto, excluir aberto, revelar.
2. Implementar; rodar check/E2E.
3. Commit `feat: diálogos internos e operações de arquivo consistentes`.

---

## Tarefa 1.5 — Explorer e busca

**Arquivos:** modificar `src/main/ipc/fs.js`, `src/renderer/scripts/file-tree.js`, `src/renderer/scripts/search.js`, `src/renderer/scripts/app.js`, `src/renderer/index.html` (setting), `test/e2e/explorer-search.spec.js`.

**Interfaces:**
- `fs:readDir` devolve todos os entries; a UI decide o que mostrar.
- `settings.showHiddenFiles` (padrão `true` para dotfiles relevantes) e lista de exclusão `node_modules`, `.git`, `dist`, `out`, `build`, `.cache`.
- Busca ignora binários e respeita as mesmas exclusões; inclui dotfiles.
- `window.AgzosEditor.revealLocation(path, line, column)`; busca cancela a anterior com `requestId`.
- Resultado clicado posiciona e destaca o termo.

**Passos:**
1. E2E: `.env`/`.github` visíveis; `node_modules` oculto; busca acha `.env`; clique vai à linha.
2. Implementar; commit `feat: explorer e busca confiáveis`.

---

## Tarefa 1.6 — Status bar, temas e honestidade da UI

**Arquivos:** modificar `src/renderer/index.html`, `src/renderer/scripts/app.js`, `src/renderer/scripts/editor.js`, `src/renderer/scripts/welcome.js`, `src/renderer/scripts/onboarding.js`, `src/renderer/styles/app.css`, `src/main/main.js`.

**Entregas:**
- `#status-perf`/`#status-ai` com `<span class="status-icon">` + `<span class="status-label">`; nunca `textContent` no host.
- Encoding/EOL reais (1.3); `↑0 ↓0` fake removido até a Fase 3.
- Monokai: `defineTheme` real + CSS; ou remover a opção.
- Checkbox de telemetria removido; texto “sem telemetria”.
- View “Extensões” renomeada para “Integrações Agzos” (placeholder honesto) conforme ADR-0001.
- Output/Problemas ocultos até ter conteúdo real.
- IA com aviso “em breve” até a Fase 2.
- Welcome: botões Abrir Arquivo/Clonar Repo ligados ou removidos; onboarding de layout/densidade aplicado ou removido.
- “Sobre” sem “fork do Code-OSS”.
- Tema aplicado ao body de forma consistente (settings, palette, onboarding).

**Passos:**
1. E2E smoke de status/tema; teste unitário de `themeIdToMonaco`.
2. Implementar; commit `feat: status bar, temas e UI honesta`.

---

## Tarefa 1.7 — Robustez, logs e hardening

**Arquivos:** criar `src/main/lib/logger.js`, `src/main/ipc/logs.js`, modificar `src/main/main.js`, `src/main/preload.js`, `src/renderer/scripts/app.js`; `test/unit/logger.test.js`.

**Entregas:**
- `window.onerror`/`unhandledrejection` → overlay “Recarregar” + “Copiar diagnóstico”.
- Log em `userData/logs/main.log`, rotação 5×1 MB; menu Ajuda → “Abrir logs”; nunca logar segredo.
- Splash com timeout; se a janela principal não carregar, fecha a splash e mostra erro.
- `sandbox: true` se o preload continuar funcionando (senão registrar justificativa); `setPermissionRequestHandler` nega tudo; bloquear webviews; `fs:delete` não apaga raiz liberada.
- `app.requestSingleInstanceLock()`; segunda execução foca a existente.

**Passos:**
1. Testes unitários do logger e do guard de delete.
2. E2E: erro forçado no renderer mostra fallback; segunda instância foca.
3. Commit `feat: robustez, logs e hardening`.

---

## Tarefa 1.8 — Docs, versão e changelog

**Status:** concluída em 28/10/2026.

**Arquivos:** `README.md`, `docs/produto/PRD.md`, `docs/plano/ROADMAP.md`, `docs/tecnico/arquitetura.md`, `docs/tecnico/troubleshooting.md`, `package.json`, `CHANGELOG.md`, `.github/PULL_REQUEST_TEMPLATE.md`.

**Entregas:**
- Remover “Fase 0”, “fork do Code-OSS”, “Open VSX”, “keytar”, “Monokai” falso.
- Documentar Electron 44, assinatura local (`npm run sign:mac`), bundle id e limites (não notarizado).
- Versão `0.2.0`; changelog; template de PR com checklist.
- Relatório `docs/plano/relatorios/fase-1-5-relatorio.md`.

**Passos:**
1. Atualizar docs; rodar `npm run check`.
2. Commit `docs: fase 1.5 — confiança e integridade`.
3. Relatório + PR; sem merge.

---

## Tarefa 1.9 — Workflow de build

**Status:** concluída em 28/10/2026.

- `.github/workflows/build.yml` (workflow_dispatch + tags) com matriz macOS/Windows/Linux, `npm ci`, `npm run dist:*` e upload de artefatos.
- macOS local: DMG/ZIP arm64+x64 com assinatura local; Windows/Linux validados no CI.

## Critério de saída

- Nenhum caminho conhecido de perda de dados no checklist manual.
- `npm run check` com 0 erros (meta: 0 warnings).
- E2E novos verdes: dirty-close, encoding, file-ops, explorer-search, status/tema, fallback.
- Build macOS assinado localmente; builds Windows/Linux configurados e workflow de matriz.
- Teste manual no Mac do Rodrigo; PR com relatório.
