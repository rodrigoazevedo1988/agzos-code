# Changelog — Agzos Code

## [0.2.2] — 2026-10-31

Correções vindas do teste do build Windows 0.2.1 no Windows 11 Pro 26H2
(build 26300.9711), que passou no checklist. Fecha os detalhes que sobraram.

### Corrigido

- **`cls` não limpava o terminal**: o terminal rodava com `child_process.spawn` e canos, sem pty. Sem um terminal de verdade o PowerShell/bash não emitem a sequência de limpeza (e o PowerShell ignora `Clear-Host` quando a saída é redirecionada), então `cls` só aparecia como erro/ruído. Agora o terminal usa **`node-pty`** (pty real): `cls`/`clear` limpam, o que você digita aparece na tela, há cores, `Tab` e `Ctrl+C`.
- **Eco de digitação ausente**: consequência do mesmo problema — sem pty o shell não ecoa o que é digitado, então só o resultado dos comandos aparecia. Corrigido junto com o pty.
- **`spawn-helper` do node-pty sem bit de execução no pacote**: o tarball do npm entrega o binário como `-rw-r--r--`, mas no macOS ele é passado como `argv[0]` do `posix_spawn`; sem o bit o terminal não abriria em builds macOS. O hook `afterPack` agora marca o binário como executável.
- **`term:resize` era um no-op**: o handler devolvia `true` sem fazer nada. Com pty ele repassa `cols`/`rows` de verdade, então o shell quebra linha no lugar certo.

### Adicionado

- `src/main/lib/terminal-session.js`: sessão de terminal com pty real e **fallback automático para canos** quando o módulo nativo não carrega ou o ambiente bloqueia `/dev/ptmx`. No modo degradado o terminal avisa na primeira linha que está reduzido, em vez de falhar silenciosamente.
- `node-pty` como dependência de runtime (o app deixou de ter zero dependências) com prebuilds N-API para win32-x64/arm64 e darwin-x64/arm64; empacotado fora do `app.asar` via `asarUnpack` e sem `npmRebuild` (os prebuilds são ABI-stable).
- Testes unitários da sessão de terminal (pty e canos, normalização de CR só no modo cano, resize, fallback quando o pty falha) e da permissão do `spawn-helper`.
- Testes E2E do terminal (execução de comando, modo pty/reduzido, `cls` limpando, Enter sem linha duplicada) e do shell: **segunda instância** focando/restaurando a janela existente sem abrir outra, e **“Revelar no Explorer”** por IPC, incluindo o guard que recusa caminho fora da workspace.

### Notas

- Assinatura de código do `.exe` (Windows) e Developer ID + notarização (macOS) seguem pendentes — exigem certificado, previstas para a Fase 5.

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
