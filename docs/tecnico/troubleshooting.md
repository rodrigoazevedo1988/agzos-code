# Troubleshooting

## Tela preta na abertura, sem pop-up nem onboarding

**Corrigido em 09/10/2026.**

Dois defeitos somados:

1. `index.html` não carregava `scripts/state.js`.
   Todos os módulos leem `window.AgzosState`, que ficava `undefined`.
   O `boot()` quebrava na primeira linha com:
   `Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'settings') (app.js:26)`.
   Nada era inicializado: Monaco, ícones, welcome, onboarding.
2. `#welcome-popup` e `#onboarding-overlay` têm a classe `.overlay` (`display:flex`, fundo `rgba(0,0,0,.55)` + blur), mas nenhuma regra os escondia sem `.active`.
   Os dois overlays vazios cobriam a UI inteira e escureciam tudo.

Correções:
- `index.html`: `<script src="scripts/state.js"></script>` antes do `app.js`.
- `styles/app.css`: `#welcome-popup.overlay:not(.active), #onboarding-overlay.overlay:not(.active) { display: none; }`.

## Ícone do Electron no Dock do macOS em `npm run dev`

**Corrigido em 09/10/2026.**

Causas:
1. `resolveAppIcon()` escolhia `build/icon.icns` primeiro no macOS. `nativeImage` não lê `.icns`, então `app.dock.setIcon()` recebia imagem vazia e o Dock mantinha o ícone do Electron.
2. Antes do `setIcon`, o macOS mostra nome e ícone do bundle `node_modules/electron/dist/Electron.app`. Por isso aparece "Electron" no menu.
3. O ícone antigo era quadrado sem margem, fora do grid do macOS.

Correções:
- `main.js` usa `build/icon-1024.png` no Dock e avisa no console se a imagem vier vazia.
- `tools/patch-electron-dev-mac.js` copia `build/icon.icns` para o `Electron.app` e troca `CFBundleName`/`CFBundleDisplayName` para "Agzos Code". Roda no `postinstall` e no `build:icons`.
- `tools/build-icons.js` gera o ícone no grid do macOS (squircle 824/1024).

Se o ícone antigo persistir:
```bash
npm run build:icons
killall Dock
```

## Depurar o renderer

```bash
npm run dev:tools   # abre DevTools destacado
```

## Rodar em servidor Linux sem display (CI / VPS)

```bash
xvfb-run -a npx electron . --no-sandbox
```
`--no-sandbox` só é necessário rodando como root.
