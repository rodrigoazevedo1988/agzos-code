# Terminal multi-sessão + aba Portas (0.7.0)

Data: 2026-11-16 · Aprovado pelo usuário em chat.

## Objetivo

Hoje o painel tem um único terminal. Passa a ter várias sessões, escolha de shell, divisão lado a lado e uma aba PORTAS, no padrão de IDE (referência de UX: painel de terminal do VS Code; identidade visual Agzos). Sem CLINE e sem DEBUG CONSOLE (não há depurador).

Critério de sucesso: criar/alternar/dividir/matar terminais sem vazar processos nem listeners; cada sessão com shell próprio; tudo funciona com o painel embaixo, à direita, maximizado e junto da aba AGZOS IA; e2e cobrindo isso.

## Arquitetura

### Main
- `term:create` já aceita `options.shell` (allowlist em `src/main/ipc/term.js`). Novo `term:profiles` → lista de perfis detectados `{ id, label, shell, args?, icon }`:
  - Windows: PowerShell 7 (`pwsh.exe` no PATH ou `%ProgramFiles%\PowerShell\7\pwsh.exe`), Windows PowerShell, Command Prompt, Git Bash (`%ProgramFiles%\Git\bin\bash.exe`), WSL (`wsl.exe`) se existirem.
  - Linux/macOS: `$SHELL`, bash, zsh, fish, sh se existirem.
  - Padrão: pwsh se houver, senão powershell (Windows); `$SHELL` (POSIX). Allowlist estendida para `wsl` e caminhos absolutos detectados pelo próprio main.
- `ports:list` (novo `src/main/ipc/ports.js`): portas TCP em LISTEN com `{ port, address, pid, process }`. Windows: `netstat -ano -p tcp` + `tasklist /fo csv /nh`; Linux: `ss -ltnpH` (fallback `netstat -ltnp`); macOS: `lsof -nP -iTCP -sTCP:LISTEN`. Parsers puros e testados. Timeout 5s, sem shell (`execFile`).

### Renderer
- `terminal.js` vira gerenciador: `sessions: Map<id, { id, termId, xterm, fit, host, profile, title, groupId, exited }>`, `groups: [{ id, sessionIds }]`, `activeGroupId`, `activeSessionId`. Listeners IPC globais únicos (já existe `bindIpcOnce`), roteando `term:data`/`term:exit` por `termId`.
- Cada sessão tem seu `<div class="term-instance">` dentro do grupo; grupo ativo visível, demais `hidden`. Divisão = sessões do mesmo grupo lado a lado (flex row) com divisores arrastáveis.
- Lista lateral de sessões (à direita do conteúdo do painel), visível quando há >1 sessão: ícone do shell, título, indicador de divisão, lixeira no hover, clique ativa, duplo clique renomeia. Largura ~160px, redimensionável não é necessário.
- Barra do painel quando aba TERMINAL ativa: nome do shell ativo · `+` (novo, perfil padrão) · `⌄` (menu de perfis) · dividir · lixeira (mata sessão ativa) · `⋯` (limpar, reiniciar, renomear, mover para direita/baixo) · maximizar · fechar. Remove os botões soltos atuais de limpar/reiniciar (vão para o ⋯).
- Matar a última sessão fecha o painel (como IDEs). Abrir o painel sem sessões cria uma.
- APIs existentes preservadas (usadas por app.js, ai-dock.js, ai-chat/ai-context, settings): `initTerminal`, `toggleTerminal`, `focusTerminal`, `getRecentOutput` (da sessão ativa), `clearTerminal`, `restartTerminal`, `applyTerminalFontSize` (todas as sessões), `selectBottomTab`, `getActiveBottomTab`, `setBottomPanelVisible`, `closeBottomPanel`, `setupTerminalPanel`, `toggleTerminalPosition`, `toggleTerminalMaximize`, `clipboardAction`. `State.term` aponta para a sessão ativa `{ id, term, fitAddon, mode }`.
- Novas: `createTerminal({ profileId, split })`, `killTerminal(id)`, `splitTerminal()`, `focusNextTerminal(dir)`, `renameTerminal(id, title)`.
- Atalhos (keymap.js): `` Ctrl+Shift+` `` novo terminal; `Ctrl+Shift+5` dividir; `Ctrl+PageUp/PageDown` alternar sessão quando foco no terminal. Comandos na paleta: Novo Terminal, Novo Terminal com Perfil…, Dividir Terminal, Matar Terminal.
- Aba PORTAS (`#pane-ports`): tabela porta/endereço/processo/PID, botão atualizar, auto-atualiza a cada 5s só enquanto visível, ações por linha: abrir `http://localhost:<porta>` no navegador (`app.openExternal`), copiar endereço. Estado vazio amigável.

## Erros e bordas
- Shell do perfil inexistente → toast e cai no padrão.
- Sessão cujo processo saiu: mostra "[Processo encerrou…]" e fica na lista até o usuário matar ou pressionar Enter (reinicia).
- Fit de todas as instâncias visíveis em resize do painel/janela/divisor/troca de grupo.
- Renderer recarregado: main já mata sessões do sender.

## Testes
- Unit: parsers de portas (Windows/Linux/macOS), detecção de perfis com fs/PATH stub, estado do gerenciador se extraído em módulo puro.
- E2E (xvfb): criar 3 sessões, cada uma com saída própria (`echo` distinto não vaza entre sessões); alternar pela lista; dividir e ver duas `.xterm` visíveis lado a lado; matar sessão encerra o processo (term:kill) e a lista atualiza; matar a última fecha o painel; perfis listados incluem bash; aba PORTAS mostra uma porta aberta por um servidor de teste; layout/dock/IA continuam verdes.
