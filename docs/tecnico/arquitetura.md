# Arquitetura — Agzos Code v0.1

App Electron 44 (sem bundler, sem TypeScript) com Monaco, xterm.js e Lucide servidos de `src/renderer/vendor/`.

## Processos

```
main (src/main/main.js)
 ├─ splash window   → src/renderer/splash.html
 ├─ main window     → src/renderer/index.html
 │    preload       → src/main/preload.js  (expõe window.agzos via contextBridge)
 └─ IPC handlers    → fs:*, dialog:*, term:*, settings:*, app:*
```

## Ordem de carregamento do renderer (`index.html`)

1. `vendor/lucide/inline.js` — injeta o sprite de ícones no `<body>`.
2. `scripts/state.js` — script clássico; cria `window.AgzosState`.
3. `scripts/app.js` — módulo ESM; importa os outros módulos e roda `boot()`.

**Importante:** todo módulo faz `const State = window.AgzosState` no topo.
Se `state.js` não carregar antes, `State` fica `undefined` e o boot quebra (sintoma: tela preta). Ver [troubleshooting](troubleshooting.md).

## Módulos do renderer (`src/renderer/scripts/`)

| Arquivo | Papel |
|---|---|
| `state.js` | Estado global (`window.AgzosState`) |
| `app.js` | Boot, atalhos, settings da UI, ações da sidebar |
| `editor.js` | Loader AMD do Monaco, temas, modelos, salvar |
| `tabs.js` | Abas e indicador de alteração |
| `file-tree.js` | Explorer (lazy), menu de contexto |
| `search.js` | Busca textual na workspace |
| `terminal.js` | xterm.js ligado ao `term:*` (spawn sem pty) |
| `command-palette.js` | Command Palette |
| `ai-chat.js` | Stub do chat de IA |
| `welcome.js` | Pop-up de boas-vindas + tela vazia do editor |
| `onboarding.js` | Wizard de onboarding (tema, migração, GitHub, layout) |
| `migrate.js` | Importação de configs de VS Code/Cursor/Sublime/Atom (stub) |
| `lucide.js` | Helper `lucideIcon(name)` |
| `toast.js` | Notificações |

## Fluxo de primeira execução

`boot()` em `app.js`:
- `settings.welcomeSeen` falso → `showWelcome()` (overlay `#welcome-popup.active`).
- welcome visto, onboarding não concluído nem pulado → `startOnboarding()` (`#onboarding-overlay.active`).
- Os overlays só aparecem com a classe `.active` (regra em `styles/app.css`).

Settings ficam em `<userData>/settings.json`:
- macOS: `~/Library/Application Support/agzos-code/`
- Linux: `~/.config/agzos-code/`
- Windows: `%APPDATA%\agzos-code\`

Para rever o fluxo: apague o `settings.json` ou use Configurações → "Refazer Onboarding".

## API do preload (`window.agzos`)

```ts
agzos.app.info() / openExternal(url) / reveal(path) / log(level, msg)
agzos.fs.readDir / readFile(path, opts?) / writeFile(path, content, opts?) / mkdir / exists / stat / delete / rename / homeDir
agzos.dialog.openFolder / openFile / saveFile(path?)
agzos.term.create(cols, rows) / write / resize / kill / onData(cb) / onExit(cb)
agzos.settings.load() / save(s)
agzos.windowState.setDirty(n) / respondClose(action) / onRequestClose(cb)
agzos.logs.open()
agzos.onMenu(cb)
```

## Ícones

Fonte única: `logos/SVG/6.svg` (símbolo vermelho).
`npm run build:icons` roda `tools/build-icons.js` dentro do Electron e gera:

- `build/icon-{16..1024}.png`, `build/icon.png` (512), `build/icon.svg`
- `build/icon.ico` (Windows) e `build/icon.icns` (macOS), escritos em Node puro

Depois roda `tools/patch-electron-dev-mac.js` (só macOS), que aplica nome e ícone Agzos no `Electron.app` usado em `npm run dev`.

## Main process — módulos

| Arquivo | Papel |
|---|---|
| `src/main/main.js` | Ciclo de vida, janelas, menu, registro dos módulos IPC, migrações no boot |
| `src/main/preload.js` | `window.agzos.*` via `contextBridge` |
| `src/main/ipc/fs.js` | `fs:*` — passa pelo path guard |
| `src/main/ipc/dialog.js` | `dialog:*` — libera no guard o caminho escolhido |
| `src/main/ipc/workspace.js` | `workspace:open` — libera a pasta se foi escolhida ou está em `recentFolders` |
| `src/main/ipc/term.js` | `term:*` — shell via `spawn` (sem pty) |
| `src/main/ipc/settings.js` | `settings:*` — `settings.json` em `userData` |
| `src/main/ipc/secrets.js` | `secrets:set/delete/has` — **sem get**: valor nunca sai do main |
| `src/main/ipc/app-info.js` | `app:info`, `app:openExternal`, `app:reveal` |
| `src/main/ipc/logs.js` | `logs:open` e `log:write` (renderer → main) |
| `src/main/lib/logger.js` | Log em arquivo com rotação e redação de segredos (sem Electron) |
| `src/main/lib/file-encoding.js` | Detecção/conversão de encoding, EOL e binário (sem Electron) |
| `src/main/lib/settings.js` | Defaults, leitura tolerante, escrita atômica, `migrateLegacySecrets` (sem Electron) |
| `src/main/lib/secrets.js` | Cofre sobre `safeStorage`; arquivo `secrets.json` cifrado (sem Electron) |
| `src/main/lib/path-guard.js` | Raízes liberadas, `realpath`, prefixo seguro (sem Electron) |

Módulos em `lib/` recebem dependências por parâmetro, então os testes unitários rodam em Node puro.

## Segredos

- API keys e tokens ficam em `secrets.json` (`userData`), cifrados com `safeStorage` (Keychain / DPAPI / libsecret).
- O renderer só grava (`agzos.secrets.set`), apaga e verifica existência (`has`). Não há leitura pelo IPC.
- Chaves em uso: `ai.legacy` (campo de API key), `github.onboarding` (token do onboarding). Na Fase 2 viram `ai.<profileId>` e `github.<accountId>`.
- Migração no boot: `aiApiKey` e `onboardingAnswers.github.token` de versões antigas do `settings.json` vão para o cofre e saem do arquivo. Se o cofre falhar, o valor fica no `settings.json` e o erro vai para o console.
- `safeStorage.isEncryptionAvailable()` é `false` em Linux sem keyring. Nesse caso `set` falha com `Cofre do sistema indisponível`.

## Acesso a arquivos (path guard)

- `fs:readDir`, `readFile`, `writeFile`, `mkdir`, `delete` e `rename` só funcionam dentro de raízes liberadas.
- Raízes: pasta escolhida em `dialog:openFolder` (ou `workspace:open` para pastas já conhecidas) e arquivo escolhido em `dialog:openFile`/`saveFile`.
- Comparação usa `realpath`: symlink para fora da raiz é bloqueado. Caminho inexistente (arquivo novo) é resolvido pelo pai.
- `fs:exists`, `fs:stat` e `fs:homeDir` não passam pelo guard (só leitura de metadados).
- `fs:readFile` devolve `{ content, encoding, eol, binary, readOnly, bom }`; `fs:writeFile` recebe `{ encoding, eol, bom }` e grava em tmp + rename preservando modo.
- `fs:delete` recusa apagar a raiz liberada.
- Em `AGZOS_TEST=1`, `global.__agzosAllowRoot(p)` libera uma raiz para os testes E2E.

## Assinatura e builds

- **Electron 44.x** (`electron-builder` 26.x), conforme [ADR-0002](../decisoes/ADR-0002-electron-e-codigo-nativo.md). O Node do main é o 24 embutido no Electron.
- **macOS dev:** `tools/sign-mac-dev.js` fixa `CFBundleIdentifier = com.agzos.code`, adiciona descrições de uso de pastas e assina o `Electron.app` com `Rodrigo Dev Local` (ou `AGZOS_MAC_SIGN_IDENTITY`). Roda no `postinstall` e no `build:icons`.
- **macOS empacotado:** `build.afterPack` chama `tools/after-pack-mac.js`, que assina o `.app` em `dist/` com a mesma identidade local. O electron-builder também tenta assinar; sem identidade (CI), ambos pulam.
- **Artefatos:** macOS DMG/ZIP arm64+x64; Windows NSIS/portable x64+arm64; Linux AppImage/DEB/RPM x64. O workflow `.github/workflows/build.yml` monta a matriz dos três sistemas.
- **Limite:** assinatura local self-signed não é notarizada. Developer ID + notarização continuam na Fase 5.
- **Código nativo:** C#/.NET e Swift são permitidos apenas como helper opcional para integração de SO sem equivalente no Electron, com ADR e fallback — nunca como reescrita do app ([ADR-0002](../decisoes/ADR-0002-electron-e-codigo-nativo.md)).

## Testes

- `npm run test:unit` — `node --test` em `test/unit/`, sobre `src/main/lib/` (39 testes na v0.2).
- `npm run test:e2e` — Playwright (`_electron`) em `test/e2e/` (20 testes na v0.2). Cada teste usa um `userData` temporário (`AGZOS_USER_DATA`).
  - `AGZOS_TEST=1` ativa ganchos de teste.
  - `AGZOS_TEST_SAFESTORAGE=fake` troca o `safeStorage` por um cofre falso, porque o CI Linux não tem keyring. Validar o cofre real é tarefa manual no macOS.
- `npm run check` — lint + unitários. É o que o CI roda antes do E2E.

## Segurança — estado atual

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- CSP com `'unsafe-eval'` (exigido pelo loader AMD do Monaco)
- Acesso a arquivos restrito às raízes liberadas; chaves no cofre do SO
- `setPermissionRequestHandler` nega tudo; `will-attach-webview` bloqueado; `will-navigate` externo abre no browser
- Instância única (`requestSingleInstanceLock`); dirty close confirmado via IPC
- Logs em `userData/logs/main.log` com rotação e redação de segredos
- Pendências: ver [roadmap](../plano/ROADMAP.md) (Fase 2 em diante)
