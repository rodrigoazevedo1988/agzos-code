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

## macOS pede permissão de Área de Trabalho/Documentos/Downloads toda hora

**Causa:** o app de dev era ad-hoc e com bundle id `com.github.Electron` (`Electron.app` do npm). Cada rebuild parecia um app diferente para o TCC.

**Correção (28/10/2026):**
- `tools/sign-mac-dev.js` fixa `CFBundleIdentifier = com.agzos.code`, adiciona as descrições de uso e assina o `Electron.app` de dev com a identidade `Rodrigo Dev Local`.
- `tools/sign-mac-app.js` e o hook `afterPack` fazem o mesmo no `.app` empacotado.
- Roda no `postinstall` e no `build:icons`; para reassinar:
```bash
npm run sign:mac        # app de dev
npm run sign:mac:dist   # app empacotado
```
- Confira a identidade e a assinatura:
```bash
security find-identity -v -p codesigning
codesign -dv --verbose=4 node_modules/electron/dist/Electron.app | grep -E 'Identifier|Authority'
```
- Se a permissão antiga ficou presa, redefina só o que precisa (isto apaga a concessão anterior):
```bash
tccutil reset SystemPolicyDesktopFolder com.agzos.code
tccutil reset SystemPolicyDocumentsFolder com.agzos.code
tccutil reset SystemPolicyDownloadsFolder com.agzos.code
```
- Sem o certificado (CI/outra máquina), o script avisa e segue sem assinar. Para usar outro nome: `AGZOS_MAC_SIGN_IDENTITY="Meu Certificado" npm run sign:mac`.
- **Limite:** assinatura local com certificado self-signed **não** é notarizada e não substitui Developer ID. Em outra máquina, o Gatekeeper ainda pode pedir “Abrir mesmo assim”. Distribuição é Fase 5.

## App empacotado não abre no macOS

1. Confira a assinatura: `codesign --verify --deep --strict "dist/mac-arm64/Agzos Code.app"`.
2. Se o Gatekeeper bloquear por não ser notarizado, use Ajustes do Sistema → Privacidade e Segurança → “Abrir mesmo assim” (só para builds locais).
3. Em CI, o build sai sem assinatura; isso é esperado até a Fase 5.

## Depurar o renderer

```bash
npm run dev:tools   # abre DevTools destacado
```

## Rodar em servidor Linux sem display (CI / VPS)

```bash
xvfb-run -a npx electron . --no-sandbox
```
`--no-sandbox` só é necessário rodando como root.

## Terminal: `Can only have one anonymous define call per script file`

**Corrigido em 29/10/2026.**

O xterm.js e o addon de fit são UMD e chamam `define([], factory)` quando encontram o AMD loader do Monaco. Como o xterm era carregado depois do Monaco, o loader quebrava ao abrir o terminal.

Correção em `src/renderer/scripts/terminal.js`:
- guarda o `window.define` do Monaco;
- coloca `window.define = undefined` só durante o carregamento de `xterm.js` e `fit.js`;
- restaura o `define` ao terminar (inclusive em erro);
- aguarda o CSS e os dois scripts antes de resolver a promise.

O terminal também normaliza `\r` para `\n` no `term:write`, porque sem pty o shell não traduz o Enter do xterm. Teste: `npm run test:e2e -- test/e2e/terminal.spec.js`.

## “Copiar diagnóstico” falha com `Write permission denied`

**Corrigido em 29/10/2026.**

O app nega permissões por padrão (`setPermissionRequestHandler`), inclusive clipboard. O botão do error boundary agora:
1. tenta `navigator.clipboard.writeText`;
2. em caso de falha, usa `document.execCommand('copy')`;
3. se o fallback também falhar, mostra uma textarea com o diagnóstico selecionado para copiar manualmente.

Nenhuma dessas falhas gera `unhandledrejection` ou novo overlay.

## Configurações

A página de Configurações abre em tela cheia, fora da sidebar: `Cmd/Ctrl+,`, botão de engrenagem na topbar ou botão de configurações na activity bar. Volta pelo botão `←` ou `Esc`.
