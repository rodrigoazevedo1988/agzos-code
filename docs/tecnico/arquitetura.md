# Arquitetura — Agzos Code v0.1

App Electron (sem bundler, sem TypeScript) com Monaco, xterm.js e Lucide servidos de `src/renderer/vendor/`.

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
agzos.app.info() / openExternal(url)
agzos.fs.readDir / readFile / writeFile / mkdir / exists / stat / delete / rename / homeDir
agzos.dialog.openFolder / openFile / saveFile(path?)
agzos.term.create(cols, rows) / write / resize / kill / onData(cb) / onExit(cb)
agzos.settings.load() / save(s)
agzos.onMenu(cb)
```

## Ícones

Fonte única: `logos/SVG/6.svg` (símbolo vermelho).
`npm run build:icons` roda `tools/build-icons.js` dentro do Electron e gera:

- `build/icon-{16..1024}.png`, `build/icon.png` (512), `build/icon.svg`
- `build/icon.ico` (Windows) e `build/icon.icns` (macOS), escritos em Node puro

Depois roda `tools/patch-electron-dev-mac.js` (só macOS), que aplica nome e ícone Agzos no `Electron.app` usado em `npm run dev`.

## Segurança — estado atual

- `contextIsolation: true`, `nodeIntegration: false`
- `sandbox: false` no main window
- CSP com `'unsafe-eval'` (exigido pelo loader AMD do Monaco)
- IPC `fs:*` aceita qualquer caminho, sem restrição à workspace
- API key de IA salva em texto puro no `settings.json`

Pendências estão no [roadmap](../plano/ROADMAP.md), Fase 0.5.
