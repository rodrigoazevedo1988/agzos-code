# Relatório — Fase 1.5: Confiança e integridade

**Executor:** DeepSeek Harness (agente)  **Data:** 28/10/2026  **Branch:** `feat/fase-1-5-confianca`  **PR:** [#4](https://github.com/rodrigoazevedo1988/agzos-code/pull/4) (aberto, CI verde)

## Resumo

Fase 1.5 entregue em código e testes: PR #3 mergeado, Electron 44 com builds para os três sistemas, assinatura local do macOS, proteção de dirty ao fechar, encoding/EOL/binário, diálogos internos, Explorer/busca, status bar/temas honestos, logs/error boundary e hardening. `npm run check` está com 0 erros e 0 warnings; 39 testes unitários e 17 E2E passam localmente. Falta o teste manual no Mac do Rodrigo e o merge.

## Tarefas

| Tarefa | Status | Commit | Observação |
|---|---|---|---|
| 1.1 Base: PR #3, Electron 44, assinatura macOS | ✅ | 2a82b9b | PR #3 squash `d203eed`; Electron 44.10.0; builder 26.18.0 |
| 1.2 Proteção de dirty ao fechar | ✅ | 1217363 | Salvar tudo / Descartar / Cancelar; `Cmd+W` fecha aba; E2E cobre |
| 1.3 Encoding/EOL/binário + escrita atômica | ✅ | 1217363 | Latin-1/UTF-16/binário; banner de somente leitura; E2E cobre |
| 1.4 Diálogos internos e operações de arquivo | ✅ | 1217363 | Substitui `prompt`; renomear/excluir/novo/revelar; E2E cobre |
| 1.5 Explorer e busca | ✅ | 1217363 | Dotfiles visíveis; `node_modules` oculto; busca leva à linha; E2E cobre |
| 1.6 Status bar, temas e honestidade da UI | ✅ | 1217363 | Ícones preservados; encoding/EOL reais; Monokai real; sem telemetria; Integrações Agzos |
| 1.7 Robustez, logs e hardening | ✅ | 1217363 | `sandbox: true`, permission handler, webviews bloqueadas, logs com rotação, error boundary, instância única |
| 1.8 Docs, versão 0.2.0 e changelog | ✅ | 9c8eb0b | README, PRD, ROADMAP, arquitetura, troubleshooting, CHANGELOG, ADR-0002 |
| 1.9 Workflow de build 3 SO | ✅ | 2a82b9b | `.github/workflows/build.yml`; bundles `--dir` de Linux/Windows validados; instaladores no CI |

## Desvios do plano

- **Onboarding:** o passo de layout/densidade foi **removido** em vez de aplicado. Ele não tinha efeito e aplicar sidebar/terminal à direita exigiria CSS e estado que não cabiam na 1.5. Fica para a Fase 4, se o time quiser.
- **Migração de editor:** continua apenas detectando configurações; a importação real (JSONC, tema, keybindings) é a Fase 4. A UI agora diz isso, em vez de “importadas (stub)”.
- **Assinatura local:** usa certificado self-signed `Rodrigo Dev Local`, não Developer ID. O `.app` de dev e o empacotado ficam assinados e com bundle id `com.agzos.code`; não é notarizado e o Gatekeeper ainda pode pedir “Abrir mesmo assim” em outra máquina.
- **DMG/ZIP locais:** o `electron-builder --dir` gera o `.app` assinado; a criação de DMG/ZIP foi interrompida depois de >15 min sem saída no ambiente do agente. O workflow de build cobre os artefatos no CI. O `.app` empacotado foi aberto e validado (inclusive depois da redução do pacote).
- **E2E local:** o helper ganhou `AGZOS_NO_SANDBOX=1` para rodar no ambiente do agente (o Chromium não inicia sandbox aqui). O CI mantém a regra antiga (`--no-sandbox` só em Linux root).
- **Electron/`sandbox`:** a janela principal passou de `sandbox: false` para `sandbox: true`; o preload só usa `contextBridge`/`ipcRenderer`, então não houve regressão.
- **Menu:** “Nova Janela” foi removida (decisão aprovada). Entraram “Fechar Aba” (`Cmd+W`), “Fechar Janela” (`Cmd+Shift+W`) e “Abrir logs”.
- **Extensões:** view renomeada para “Integrações Agzos”; Open VSX removido da UI e dos docs, conforme ADR-0001.

## Verificação

- `npm run check`: **0 errors, 0 warnings; 39 tests, 39 pass, 0 fail**.
- `npm run test:e2e` (macOS, `AGZOS_NO_SANDBOX=1`): **17 passed**. Inclui dirty-close, encoding Latin-1, dotfiles/busca, novo/renomear e proteção de raiz do `fs:delete`.
- `npm audit --omit=dev`: `found 0 vulnerabilities`.
- `codesign -dv` no app de dev e no empacotado: `Identifier=com.agzos.code`, `Authority=Rodrigo Dev Local`; `codesign --verify --deep --strict` válido.
- App empacotado `0.2.0` abriu via Playwright (`Agzos Code.app`).
- Electron 44.10.0; electron-builder 26.18.0; Monaco 0.50.0; `xterm` 5.3.0 (troca para `@xterm/xterm` na Fase 4).
- CI GitHub Actions: PR #4 verde (run 40806449448); workflow de build novo aguarda execução a partir da branch padrão.
- Bundles `--dir` com Electron 44: macOS 322 MB, Linux 298 MB, Windows 388 MB. As deps de build (Monaco/Lucide/xterm) foram movidas para `devDependencies`; o renderer usa as cópias de `src/renderer/vendor/`.

## Problemas encontrados

- **DMG/ZIP local:** `electron-builder --mac dmg zip --arm64` ficou >15 min sem saída e foi cancelado. O `.app` foi gerado e assinado. Rodar o workflow `Build` ou repetir localmente com `CSC_IDENTITY_AUTO_DISCOVERY=true`.
- **TCC:** a assinatura estável deve parar de pedir permissão de pasta a cada rebuild, mas isso só se confirma no teste manual no Mac; se o macOS já tiver gravado a permissão antiga, pode ser preciso `tccutil reset`.
- **Gatekeeper:** `spctl --assess` rejeita self-signed; esperado. Não é notarizado.
- **`safeStorage` real:** os E2E usam cofre falso; a validação no Keychain real continua manual.

## Dúvidas para o sênior

1. A assinatura local `Rodrigo Dev Local` é suficiente para o dia a dia até a Fase 5, ou vale comprar Developer ID agora para testar notarização?
2. Remover o passo de layout do onboarding é aceitável, ou o time quer sidebar/terminal à direita na Fase 4?
3. “Output” e “Problemas” ficaram ocultos até ter conteúdo real. Ok manter assim até a Fase 4/5?

## Checklist manual do Rodrigo (Mac)

1. `npm run dev` e confirmar que o app abre com nome/ícone Agzos e sem pedir permissão de pasta repetidamente.
2. Editar um arquivo e fechar a janela: **Cancelar** mantém, **Descartar** fecha, **Salvar tudo** grava.
3. Abrir um Latin-1: banner somente leitura; “Abrir como Windows-1252”; editar e salvar sem corromper.
4. Criar arquivo/pasta, renomear um arquivo aberto, excluir e “Revelar no SO”.
5. Confirmar `.env`/`.github` no Explorer, busca e salto para a linha.
6. `npm run pack`; abrir `dist/mac-arm64/Agzos Code.app` e confirmar a assinatura em `codesign -dv`.
7. Se possível, instalar o `.app` em outra pasta e ver se o TCC não repete.

## Arquivos alterados

```
commits 2a82b9b, 1217363 e 9c8eb0b: package.json, package-lock.json, .gitignore,
.github/workflows/build.yml, build/entitlements.mac.plist,
tools/sign-mac-dev.js, tools/sign-mac-app.js, tools/after-pack-mac.js,
src/main/main.js, src/main/preload.js, src/main/ipc/{app-info,fs,logs}.js,
src/main/lib/{file-encoding,logger,path-guard}.js,
src/renderer/index.html, src/renderer/styles/app.css,
src/renderer/scripts/{app,ai-chat,close-guard,dialog,editor,error-boundary,file-tree,migrate,onboarding,search,state,welcome}.js,
test/unit/{file-encoding,logger}.test.js, test/e2e/{integrity,security,onboarding,helpers}.js,
docs/README.md, docs/decisoes/ADR-0002-electron-e-codigo-nativo.md,
docs/plano/{BACKLOG-MELHORIAS,ROADMAP}.md,
docs/plano/execucao/fase-1-5-confianca.md,
docs/plano/relatorios/fase-1-5-relatorio.md,
docs/produto/PRD.md, docs/tecnico/{arquitetura,troubleshooting}.md,
README.md, CHANGELOG.md
```
