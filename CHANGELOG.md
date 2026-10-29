# Changelog — Agzos Code

## [0.2.0] — 2026-10-28

Fase 1.5 — Confiança e integridade.

### Adicionado

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
