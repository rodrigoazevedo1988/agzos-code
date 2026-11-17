<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logos/SVG/2.svg">
    <source media="(prefers-color-scheme: light)" srcset="logos/SVG/1.svg">
    <img alt="Agzos" src="logos/PNG/1.png" width="360">
  </picture>
</p>

<h1 align="center">Agzos Code</h1>

<p align="center">
  <strong>O VS Code do time Agzos</strong> — editor de código com Electron + Monaco, IA nativa, terminal integrado e multiplataforma.
</p>

<p align="center">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-desktop-0E0E0E?logo=electron&logoColor=white">
  <img alt="Monaco" src="https://img.shields.io/badge/Monaco-editor-D10A11">
  <img alt="Plataformas" src="https://img.shields.io/badge/Win%20%7C%20macOS%20%7C%20Linux-0E0E0E">
  <img alt="Licença" src="https://img.shields.io/badge/licen%C3%A7a-MIT-D10A11">
</p>


---

## ✨ O que é

**Agzos Code** é um editor de código desktop construído com [Electron](https://www.electronjs.org/) e [Monaco Editor](https://microsoft.github.io/monaco-editor/), o componente de edição também usado pelo VS Code. A base é um aplicativo próprio, sem fork do Code-OSS e sem suporte à API de extensões do VS Code ([ADR-0001](docs/decisoes/ADR-0001-base-do-editor.md)).

Versão atual: **1.1.0** — editor completo com barra de menus e várias janelas, IA agêntica com modos e skills, Módulos Agzos nativos (Vassoura de Produção e Cofre .env), visualizadores de PDF/Office/mídia, Git/GitHub, SSH, terminal multi-sessão e atualização automática.

**Diferencial intencional:** desenhado para o ecossistema Agzos (IA, ferramentas internas, identidade visual) e com privacidade por padrão (telemetria desligada, segredos no cofre do sistema).

## 🎯 Funcionalidades (v1.1.0)

### Editor
- **Monaco** com IntelliSense de TS/JS/JSON/CSS/HTML (workers), multi-cursor, minimap, bracket pair colorization, formatar (`Alt+Shift+F`), quebra de linha (`Alt+Z`), localizar/substituir, ir para linha.
- **Abas** com indicador de alteração, fechar com clique do meio, `Ctrl+W`, `Ctrl+K Ctrl+W`.
- **Auto-save** e recarga de arquivos alterados fora do editor (pergunta se houver conflito com edição local).
- **Temas:** Agzos Dark, Agzos Light e Monokai. **4 estilos de ícones** de arquivos/pastas.
- **Explorer** com árvore lazy, menu de contexto (criar, renomear, excluir, revelar no SO) e cores de status do Git.
- **Quick Open** (`Ctrl+P`) com busca recursiva, **Buscar em arquivos** (`Ctrl+Shift+F`) e **Command Palette** (`Ctrl+Shift+P`).
- **Configurações** em modal no padrão VS Code, com busca, e importação de configurações do VS Code / Cursor.
- **Barra de menus** em pt-BR (Arquivo, Editar, Seleção, Ver, Ir, Executar, Terminal, Ajuda), com navegação por `Alt`; itens futuros aparecem como "Em breve".
- **Várias janelas** (`Ctrl+Shift+N`), cada uma com sua pasta e permissões isoladas; `Ctrl+Q` pede confirmação.
- **Executar Arquivo Ativo** e **Executar Tarefa** (scripts do `package.json`) no terminal.

### Visualizadores
- Imagens com zoom (png, jpg, gif, webp, avif, bmp, ico, svg), vídeo, áudio e PDF.
- **DOCX**, **XLSX/XLS/ODS** (abas e rolagem virtual) e CSV/TSV em tabela.
- **Markdown** com pré-visualização ao lado (`Ctrl+Shift+V`), atualizando ao digitar.
- Demais formatos: "Abrir no app padrão" e "Revelar na pasta".

### Módulos Agzos (nativos, sem extensões)
- Hub em `Ctrl+Shift+X`.
- **Vassoura de Produção:** remove `console.*`, comentários, imports não usados e código morto, com preview em diff, Desfazer e contador na barra de status.
- **Cofre .env:** valores mascarados, comparação com `.env.example`, detecção de segredos e **bloqueio de commit com segredo**, com hook pre-commit opcional.

### Agzos IA
- **Painel acoplável** à esquerda, direita (padrão) ou embaixo, redimensionável; trocar de posição não perde a conversa nem o streaming.
- **Provedores:** OpenAI, Groq, OpenRouter, Gemini, Ollama, compatível com OpenAI (custom) e Anthropic; wizard de configuração e vários perfis.
- **Chat:** streaming, Markdown, blocos de código com Copiar / Inserir / Aplicar com diff, contexto de arquivo, seleção e terminal, várias conversas por workspace.
- **Modo Agente:** a IA lê, busca, cria e edita arquivos, cria/move/apaga pastas e roda comandos dentro da pasta aberta.
  - Modos de autonomia: **Perguntar tudo**, **Edição livre** (padrão) e **Automático**.
  - Comandos de risco sempre pedem confirmação; nada fora da pasta do projeto.
  - Cartões por ação, aprovação com diff inline e **Desfazer tudo** por checkpoint.
- **Modos com skills:** Agente, Chat, Plan, Debugger de Erros, Criador de Sites e Cyber Security; skills próprias em `.agzos/skills/`.
- **Fila de mensagens** durante a execução, com "Enviar agora" sem cancelar o que está rodando.
- **Anexos:** imagens (visão), arquivos de texto/código e PDF; colar print com `Ctrl+V`.
- **Histórico** de todas as conversas, com busca, e **exportar** em Markdown ou PDF.
- **Personalização:** fonte, densidade, avatar, tecla de envio, contexto padrão.

### Git e GitHub
- Painel GIT: branches (trocar/criar), sincronizar, fetch/pull/push, stage/unstage/descartar, diff, commit e "Commit e Push", histórico.
- Branch e sincronização na barra de status, badge de alterações.
- Clonar repositório com progresso.
- Contas GitHub por token (PAT), várias contas, conta por repositório; token só no cofre do sistema.
- Publicar pasta no GitHub e criar Pull Request.

### Terminal
- **PTY real** (`node-pty`: ConPTY no Windows, forkpty no Linux/macOS), com fallback em modo pipe.
- **Várias sessões**, escolha de shell (PowerShell 7, Windows PowerShell, CMD, Git Bash, WSL; bash/zsh/fish/sh), dividir lado a lado, renomear, reiniciar.
- Painel embaixo ou à direita, redimensionável e maximizável.
- Copiar/colar (`Ctrl+C` com seleção, `Ctrl+Shift+C/V`, `Ctrl+V`, botão direito).
- Windows: ambiente limpo lido do registro a cada shell (como o Windows Terminal); `AGZOS_TERM_INHERIT_ENV=1` volta a herdar.
- **Aba PORTAS:** portas TCP em escuta com processo e PID, abrir no navegador.
- **SSH:** botão remoto na barra de status conecta a hosts do `~/.ssh/config` num terminal SSH (pasta remota completa na 1.2.0).

### Distribuição
- Instaladores Windows (NSIS + portátil), Linux (AppImage, DEB, RPM) e macOS (DMG/ZIP, requer host macOS).
- **Atualização automática (OTA)** a partir de `https://code.rsolutionsbr.com/release/` em Windows, Linux e macOS.

## 🧠 Roadmap

| Fase | Status | Foco |
|------|--------|------|
| **0 — Protótipo** | ✅ | Editor Electron + Monaco e identidade Agzos |
| **1 — Fundação** | ✅ | Testes, segurança, modularização e CI |
| **2 — IA** | ✅ | Providers, streaming, wizard e painel de chat |
| **3 — Git e GitHub** | ✅ | Git integrado e contas GitHub (Device Flow pendente) |
| **4 — Editor completo** | 🚧 | IntelliSense, terminal PTY e recarga feitos; ripgrep e restaurar sessão pendentes |
| **5 — Distribuição e v1.0** | ✅ | Releases e atualização automática (assinatura pendente) |
| **Pós-v1.0** | ⏳ | Agente avançado, LSP de outras linguagens, integrações Agzos |

Detalhes em [docs/plano/ROADMAP.md](docs/plano/ROADMAP.md) e no [CHANGELOG](CHANGELOG.md).

## 🚀 Quick start

### Downloads — v1.1.0

- [Windows — instalador](https://code.rsolutionsbr.com/release/Agzos%20Code%20Setup%201.1.0.exe)
- [Windows — portátil](https://code.rsolutionsbr.com/release/Agzos%20Code%201.1.0.exe)
- [Linux — AppImage](https://code.rsolutionsbr.com/release/Agzos%20Code-1.1.0.AppImage)
- [Linux — .deb](https://code.rsolutionsbr.com/release/agzos-code_1.1.0_amd64.deb)
- [Linux — .rpm](https://code.rsolutionsbr.com/release/agzos-code-1.1.0.x86_64.rpm)

Builds de macOS dependem de um host macOS e não acompanham esta release. Enquanto o app não estiver assinado/notarizado, o macOS informa novas versões para download manual.

### Pré-requisitos
- Node.js 20.x ou 22.x
- npm 10+
- Git no PATH (para o painel Git)

### Instalação
```bash
git clone https://github.com/rodrigoazevedo1988/agzos-code.git
cd agzos-code
npm install
```

O `postinstall` roda `tools/setup-vendor.js`, que copia Monaco, xterm e Lucide para `src/renderer/vendor/` (necessário por causa da CSP restritiva do renderer).

### Rodar em dev
```bash
npm run dev         # abre o app
npm run dev:tools   # abre o app com DevTools
```

### Testes
```bash
npm run check                    # eslint + testes unitários (node --test)
xvfb-run -a npx playwright test  # E2E no Linux sem display
```

### Buildar instalador
```bash
npm run dist:linux    # AppImage + DEB + RPM
npm run dist:win      # NSIS + portátil (no Linux, via wine)
npm run dist:mac      # DMG + ZIP (precisa de host macOS)
```

Saída em `dist/`. Publicação na VPS: `node tools/publish-vps-release.js` (mantém só as 2 releases mais recentes).

### Regenerar ícones
```bash
npm run build:icons
```

## ⌨️ Atalhos

| Atalho | Ação |
|--------|------|
| `Ctrl+N` / `Ctrl+Shift+N` | Novo arquivo de texto / Nova janela |
| `Ctrl+O` | Abrir pasta |
| `Ctrl+Q` | Sair (pede confirmação) |
| `Ctrl+Shift+V` | Pré-visualização de Markdown ao lado |
| `Ctrl+Shift+B` | Executar tarefa de build |
| `Ctrl+P` | Quick Open |
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+Shift+F` | Buscar nos arquivos |
| `Ctrl+S` | Salvar |
| `Ctrl+W` / `Ctrl+K Ctrl+W` | Fechar aba / fechar todas |
| `Ctrl+F` / `Ctrl+H` / `Ctrl+G` | Localizar / substituir / ir para linha |
| `Alt+Shift+F` | Formatar documento |
| `Alt+Z` | Quebra de linha |
| `Ctrl+B` | Alternar sidebar |
| `Ctrl+,` | Configurações |
| `Ctrl+K Ctrl+S` | Atalhos de teclado |
| `` Ctrl+` `` | Alternar terminal |
| ``Ctrl+Shift+` `` | Novo terminal |
| `Ctrl+Shift+5` | Dividir terminal |
| `Ctrl+PageUp/PageDown` | Sessão de terminal anterior/seguinte |
| `Ctrl+L` | Agzos IA: abrir/fechar (com seleção, envia a seleção) |
| `Ctrl+Shift+A` | Focar Agzos IA |
| `Ctrl+Shift+E/F/G/X` | Explorer / Buscar / Git / Módulos Agzos |
| `Ctrl+Enter` (painel Git) | Commit |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom |

## 🏗️ Arquitetura

```
src/
├── main/                     # Processo principal (Node)
│   ├── main.js               # Janela, menu, registro de IPC
│   ├── preload.js            # contextBridge → window.agzos.*
│   ├── updater.js            # OTA (electron-updater + mac-ota)
│   ├── ipc/                  # fs, dialog, settings, secrets, workspace, term, ports, ai, agent, git, github, chat-history
│   ├── ai/                   # Providers (OpenAI-compat, Anthropic), SSE, perfis, tool calls
│   ├── agent/                # Laço do agente, ferramentas, risco, checkpoints, execução de comandos
│   ├── git/                  # Runner do git (execFile, sem shell), status, operações
│   ├── github/               # Contas e API do GitHub
│   └── lib/                  # path-guard, secrets (safeStorage), settings, win-env, import-vscode
└── renderer/                 # UI (sem Node; só window.agzos)
    ├── index.html
    ├── styles/               # app.css, ai-panel.css, terminal.css, git.css
    └── scripts/              # editor, tabs, file-tree, terminal(+sessions), ai-chat, ai-dock,
                              # agent-ui, git-panel, settings-modal, command-palette, keymap…
tools/                        # setup-vendor, build-icons, publish-vps-release
test/unit, test/e2e           # node --test e Playwright (com servidores falsos de IA e GitHub)
docs/                         # PRD, ADRs, plano, specs
```

Principais namespaces expostos ao renderer: `agzos.fs`, `agzos.dialog`, `agzos.settings`, `agzos.term`, `agzos.ports`, `agzos.ai`, `agzos.agent`, `agzos.git`, `agzos.github`, `agzos.app`.

### Segurança

- `contextIsolation: true`, `nodeIntegration: false`, CSP restritiva, navegação externa bloqueada.
- Acesso a arquivos restrito à pasta aberta (`path-guard`), inclusive para o agente.
- Chaves de IA e tokens GitHub no cofre do sistema (`safeStorage`); nunca chegam ao renderer nem ao modelo.
- Comandos git com argumentos em array, sem shell; shells do terminal em allowlist.

## 🎨 Tema

| Token | Valor | Uso |
|-------|-------|-----|
| `--accent` | `#D10A11` | Vermelho Agzos (abas ativas, cursor, botões primários) |
| `--bg` | `#0E0E0E` | Fundo principal |
| `--fg` | `#E8E8E8` | Texto principal |

Customizar: edite as variáveis em `src/renderer/styles/app.css` ou crie um bloco `body.theme-<nome>`.

## 🤝 Como contribuir

1. Branch a partir de `main` (`git checkout -b feat/minha-feature`)
2. `npm run dev` para iterar
3. `npm run check` e `xvfb-run -a npx playwright test`
4. PR descrevendo o que mudou e por quê

## 📄 Licença

MIT — veja [LICENSE](LICENSE).

Baseado no trabalho de [Microsoft Corporation](https://github.com/microsoft/monaco-editor) (Monaco Editor) e [Sourcegraph](https://github.com/sourcegraph/vscode) (Concourse), ambos sob MIT.

---

**Agzos Code** — feito com 🖤 e 🔴 pelo time Agzos.

## 🎨 Identidade visual

Os logos oficiais da Agzos ficam em [`logos/`](logos/), em **SVG**, **PNG** e **PDF**:

| Arquivo | Versão | Uso indicado |
|---|---|---|
| `1` | Logo completo, preto com "s" vermelho | Fundos claros |
| `2` | Logo completo, branco com "s" vermelho | Fundos escuros |
| `3` | Logo completo, preto | Impressão monocromática em fundo claro |
| `4` | Logo completo, branco | Monocromático em fundo escuro |
| `5` | Símbolo, branco | Ícones e avatares em fundo escuro |
| `6` | Símbolo, vermelho (#D10A11) | Destaque, favicon, splash |
| `7` | Símbolo, preto | Ícones em fundo claro |

Paleta: preto `#0E0E0E` e vermelho `#D10A11`.
