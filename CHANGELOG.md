# Changelog — Agzos Code

## [0.2.1] — 2026-10-29

Correções vindas do teste do build Windows 0.2.0 no Windows 11 Pro 26H2
(build 26300.9711). O build testado era anterior ao PR #4; esta versão é o
primeiro build Windows com todas as correções.

### Corrigido

- **Terminal não carregava no Windows** (`Can only have one anonymous define call per script file`): o UMD do xterm conflitava com o loader AMD do Monaco. O `define` global agora é desativado só durante o carregamento de `xterm.js` + `fit.js` e restaurado em seguida.
- **Enter no terminal era ignorado**: sem pty, o shell não traduz `\r`; o `term:write` normaliza `\r\n`/`\r` para `\n`.
- **“Copiar diagnóstico” com clipboard negado**: `copy()` devolvia a promise de `writeText` direto, então a rejeição não caía no fallback. Agora é `try/await` com `catch` → `execCommand` → textarea selecionada, e o texto aparece no diálogo se os dois falharem.
- **Configurações abriam no painel lateral antigo**: agora são página cheia, com engrenagem da topbar, botão da activity bar, `Ctrl+,`/`Cmd+,`, `Esc` e botão voltar.
- **`Ctrl+,` não fazia nada no Windows**: o atalho dependia só do acelerador do menu nativo, instável com `frame:false` + `autoHideMenuBar`. O renderer trata `Ctrl+,`/`Cmd+,` localmente.
- **`settings.json` com BOM era tratado como corrompido**: o arquivo era renomeado para `.corrupt-*` e as configurações voltavam ao padrão (reabrindo welcome/onboarding). O BOM é removido antes do `JSON.parse`, aceitando UTF-8, UTF-16 LE e UTF-16 BE — o que o PowerShell 5.1 grava por padrão.
- **Pacote vinha com arquivos `._*` do macOS** (`._Agzos Code.exe`, `._app.asar`): novo hook `afterPack` multiplataforma (`tools/after-pack.js`) varre a saída e remove `._*`, `.DS_Store`, `.LSOverride` e `.AppleDouble/`; `build.files` também exclui. O workflow Build falha se algo escapar para `dist/`.

### Adicionado

- Testes unitários de BOM (UTF-8/UTF-16 LE/BE, BOM que não esconde JSON inválido), do removedor de lixo do macOS e do contrato do `package.json` de empacotamento.
- Testes E2E da página cheia de Configurações (engrenagem, activity bar, `Ctrl+,`, `Esc`, voltar) e de `settings.json` com BOM de ponta a ponta.
- `AGZOS_NO_GPU=1` nos helpers de E2E para rodar em ambientes sem processo de GPU.

## [0.2.0] — 2026-10-28

Fase 1.5 — Confiança e integridade.

### Adicionado

- Bundles enxutos: Monaco, Lucide e xterm saíram de `dependencies` para `devDependencies`; macOS 322 MB, Linux 298 MB e Windows 388 MB no `--dir`. Linux com `desktopName`/`syncDesktopName` para associação de janela.

- Assinatura local do `.app` no macOS com identidade estável (`Rodrigo Dev Local`), bundle id `com.agzos.code`, via `tools/sign-mac-dev.js`, `tools/sign-mac-app.js` e hook `afterPack`.
- Electron 44.10.0 e electron-builder 26.18.0; builds macOS arm64/x64, Windows x64/arm64 e Linux x64.
- Workflow `.github/workflows/build.yml` para gerar artefatos dos três sistemas.
- Proteção de alterações não salvas: fechar janela/`Cmd+Q`/`Cmd+W` pede **Salvar tudo / Descartar / Cancelar**.
- Leitura de arquivos com detecção de encoding (UTF-8, BOM, UTF-16 LE/BE), EOL e binário; arquivos não reconhecidos abrem somente leitura com opção explícita de reabrir como Windows-1252.
- Escrita atômica (tmp + rename) preservando encoding, EOL e permissões.
- Diálogos internos para novo arquivo/pasta e renomear (substituem `window.prompt`, que o Electron não implementa).
- Explorer mostra `.env`, `.github`, `.vscode` etc.; `node_modules`, `.git`, `dist` ficam ocultos por padrão, com toggle em Configurações.
- Busca em arquivos inclui dotfiles, cancela buscas antigas e leva à linha/coluna do resultado.
- Status bar com encoding/EOL reais, ícones preservados e sem `↑0 ↓0` fake.
- Tema Monokai real no Monaco.
- Logs em `userData/logs/main.log` com rotação e redação de segredos; menu Ajuda → Abrir logs; fallback de erro no renderer.
- `sandbox: true` na janela principal, permission handler negando tudo e bloqueio de webviews.
- Instância única: abrir o app de novo foca a janela existente.
- Tema de ícones do Explorer e correção da árvore vertical (PR #3).

### Corrigido

- Terminal abria com `Can only have one anonymous define call per script file`: o UMD do xterm conflitava com o loader AMD do Monaco. O `define` é desativado só durante o carregamento do xterm/fit e restaurado depois.
- Terminal sem pty ignorava Enter (`\r`): o main normaliza CR para LF no `term:write`.
- “Copiar diagnóstico” falhava com permissão de clipboard negada; agora há fallback por `execCommand` e textarea de diagnóstico.
- Configurações deixaram de abrir na sidebar e viraram página cheia, com voltar/Esc.

- Renomear arquivo aberto deixava aba órfã/duplicada e podia salvar no caminho antigo.
- Novo arquivo/pasta e renomear não funcionavam por causa de `window.prompt`.
- Arquivos Latin-1/UTF-16/binários eram corrompidos ao salvar (U+FFFD e troca de EOL).
- Clique em resultado de busca não posicionava o cursor.
- Ícones de performance/IA da status bar eram apagados ao atualizar o texto.
- Botões mortos do welcome e passo de layout do onboarding sem efeito.
- “Sobre” e README chamavam o projeto de fork do Code-OSS (não é).
- Configuração de view “Extensões”/Open VSX contradizia o ADR-0001.

### Segurança

- Electron 32 (EOL em 03/2025) substituído pelo 44.
- `sandbox: true`, permissões negadas por padrão, webviews bloqueadas.
- `fs:delete` não apaga a raiz da pasta aberta.
- Nenhum segredo em logs, settings ou mensagens de erro.

### Documentação

- ADR-0002 (Electron 44, builds e política de código nativo).
- Plano da Fase 1.5 e backlog aprovado.
- README, arquitetura, troubleshooting e PRD atualizados.

## [0.1.0] — 2026-10-09

- Fase 0: editor Electron + Monaco com branding Agzos, welcome/onboarding, terminal, command palette e builds básicos.
- Fase 1: lint/testes, E2E, IPC modular, settings, cofre de segredos, path guard e CI.
