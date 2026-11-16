# Changelog

## 1.0.0 — 2026-11-16

### Agzos IA agêntico

- Modo **Agente** no chat: a IA lê, busca, cria e edita arquivos, cria/move/apaga pastas e roda comandos dentro da pasta do projeto — corrige bugs, cria sites e projetos, faz melhorias.
- Tool calling nos provedores OpenAI-compatíveis (OpenAI, Groq, OpenRouter, Gemini, Ollama) e Anthropic; modelo sem suporte a ferramentas cai para o chat com aviso.
- Três modos de autonomia: **Perguntar tudo**, **Edição livre** (padrão: edita sozinho, pede OK para comandos e para apagar/mover) e **Automático**. Comandos de risco (apagar raiz, formatar, `git push --force`, `reset --hard`, `curl | sh`…) sempre pedem confirmação; nada fora da pasta do projeto.
- Cartões por ação (ler, editar `+N −M` com diff, comando com saída ao vivo), cartão de aprovação com diff inline (`Enter` permite, `Esc` nega, "Permitir sempre nesta conversa").
- Resumo final com arquivos alterados e **Desfazer tudo** (checkpoint antes de cada alteração).
- Editor recarrega arquivos alterados pelo agente; se você também editou, pergunta qual versão manter.
- Histórico guarda as ações do agente; segredos são redigidos da saída de comandos.

### Git e GitHub

- Painel GIT: branch (trocar/criar, remotas), sincronizar ↓/↑, fetch/pull/push, áreas Preparadas/Alterações/Conflitos com stage/unstage/descartar e diff, commit (`Ctrl+Enter`) e "Commit e Push", histórico com commits não enviados destacados.
- Barra de status com branch e sincronização; badge de alterações; cores de status na árvore de arquivos.
- "Clonar Repo" funcionando (tela inicial e paleta) com barra de progresso.
- Contas GitHub por token (PAT), várias contas, conta por repositório; token só no cofre do sistema, nunca no renderer, na IA ou no `.git/config`.
- Publicar pasta no GitHub (pessoal ou organização, público/privado) e criar Pull Request da branch atual.
- Comandos Git na paleta.

### Correções

- Botão "Abrir Arquivo" da tela inicial não fazia nada.

## 0.7.0 — 2026-11-16

### Terminal multi-sessão

- Vários terminais ao mesmo tempo, cada um com seu shell e processo; lista lateral de sessões (aparece com 2+), com ícone por shell, renomear (duplo clique/F2) e lixeira.
- Escolha de shell no `+ ⌄`: PowerShell 7, Windows PowerShell, Prompt de Comando, Git Bash e WSL no Windows (o que estiver instalado); bash/zsh/fish/sh no Linux/macOS.
- Dividir terminais lado a lado com divisores arrastáveis.
- Barra do painel: shell ativo, novo, perfis, dividir, matar, menu ⋯ (limpar, reiniciar, renomear, mover), maximizar e fechar.
- Atalhos: `Ctrl+Shift+`` ` novo terminal, `Ctrl+Shift+5` dividir, `Ctrl+PageUp/PageDown` alternar. Comandos equivalentes na paleta.
- Shell encerrado fica marcado; `Enter` reinicia na mesma sessão. Fechar o último terminal fecha o painel.
- Cores do terminal seguem o tema do app (escuro, claro, monokai).

### Aba PORTAS

- Lista as portas TCP em escuta (porta, endereço, processo, PID), atualiza a cada 5s enquanto visível, com ações de abrir no navegador e copiar `http://localhost:<porta>`.

## 0.6.1 — 2026-11-16

### Terminal

- Windows: o shell nasce com ambiente limpo montado do registro (como o Windows Terminal), sem herdar variáveis velhas do processo que abriu o Agzos — ex.: `ANTHROPIC_MODEL`/`ANTHROPIC_BASE_URL` já removidas continuavam aparecendo. `AGZOS_TERM_INHERIT_ENV=1` restaura a herança.
- Copiar e colar: `Ctrl+C` copia quando há seleção (sem seleção continua interrompendo), `Ctrl+Shift+C`, `Ctrl+V`, `Ctrl+Shift+V`, `Shift+Insert` e `Cmd+C/V` no macOS; botão direito copia a seleção ou cola.

## 0.6.0 — 2026-11-16

### Agzos IA — painel premium

- Painel acoplável: esquerda, direita (padrão, coluna redimensionável) ou embaixo (aba ao lado do terminal). Trocar de posição não perde a conversa nem a resposta em andamento; posição e largura ficam salvas.
- `Ctrl+L` abre/fecha o painel (com seleção no editor, envia a seleção); comandos "Agzos IA: Mover para Esquerda/Direita/Embaixo" e "Alternar Painel" na paleta.
- Novo visual: cabeçalho compacto com seletor perfil·modelo, mensagens com avatar Agzos, blocos de código com realce de sintaxe e ações Copiar / Inserir no cursor / Aplicar com diff, cursor de streaming, indicador "Pensando", erro com "Tentar de novo" e estado vazio com sugestões.
- Composer que cresce sozinho com chips de contexto (arquivo atual, seleção com nº de linhas, terminal); `Enter` envia e `Shift+Enter` quebra linha (configurável para `Ctrl+Enter`).
- Modo compacto automático quando o painel está estreito ou baixo.
- Várias conversas por workspace, com histórico, títulos automáticos e exclusão (o histórico antigo é migrado).
- Personalização em Configurações → Agzos IA: posição, tamanho da fonte, densidade, avatar, tecla de envio e contexto padrão.

### Correções

- Terminal no Windows: shells novos (e "Reiniciar") passam a enxergar variáveis de ambiente alteradas ou removidas depois que o app abriu (ex.: remover `ANTHROPIC_API_KEY`), relendo o ambiente do registro como o Windows Terminal faz.
- Salvar configurações (ou mover o painel) podia apagar os perfis de IA salvos ("Perfil de IA não encontrado").

## 0.5.0 — 2026-11-16

### Correções críticas de layout

- Área do editor colapsava (welcome cortado no topo, resto da tela preto) após a introdução do `#workbench-body`: `#editor-area` agora cresce com `flex: 1 1 0`, grid principal usa `minmax(0, 1fr)` e os contêineres usam `overflow: clip` para a página não "subir" ao focar o terminal.
- Workers do Monaco: removido `MonacoEnvironment` que apontava direto para `tsWorker.js`/`jsonWorker.js` (módulos AMD), o que gerava `define is not defined` ao abrir arquivos `.js`, `.json`, `.css` e `.html`.

### Terminal

- Terminal real com PTY via `node-pty` (ConPTY no Windows, forkpty no Linux/macOS): prompt, eco, Backspace, setas, histórico, programas em tela cheia e redimensionamento.
- Fallback em modo pipe com disciplina de linha (eco local, Backspace, Ctrl+C/U/D, colar várias linhas) se o PTY não carregar.
- xterm.js não carregava com o loader AMD do Monaco presente; por isso redimensionar, mover (embaixo/direita) e maximizar não funcionavam. Corrigido, com tamanho guardado por posição.
- Shells encerrados (com a árvore de processos) ao recarregar/fechar a janela; `cwd` e shell validados (allowlist); EPIPE não derruba mais o processo principal.
- `terminal.fontSize` e `terminal.scrollback` agora são aplicados.

### Configurações

- Opções booleanas (minimap, formatOnSave etc.) não eram salvas — corrigido.
- "Restaurar Todas" não apaga mais perfis de IA, contas GitHub, pastas recentes e onboarding.
- Importação do VS Code: parser JSONC correto (URLs, globs, vírgulas finais) e aplicação imediata das configurações importadas, inclusive pela paleta de comandos.
- Campos numéricos validados e limitados ao intervalo permitido.

### Atalhos e Quick Open

- `Ctrl+W` volta a fechar a aba ativa; `Ctrl+K Ctrl+W` (fechar todas) e `Ctrl+K Ctrl+S` (atalhos) implementados.
- Atalhos globais não roubam mais teclas do terminal e de campos de texto.
- Atalhos independentes do layout de teclado (ABNT2, macOS Option): `Ctrl+'` também alterna o terminal.
- Quick Open (`Ctrl+P`) atualiza ao criar/renomear/apagar arquivos e não mistura resultados ao alternar para comandos.
- Auto-save salva o arquivo certo e só quando há alterações.
- "Verificar Atualizações" da paleta de comandos voltou a funcionar.

### OTA e release

- macOS: nunca baixa o build arm64 em Mac Intel; instalação com backup (não apaga o app se a troca falhar); não baixa de novo a mesma versão; erro de disco não derruba o app.
- `update.autoDownload` respeitado; aviso "Baixando atualização…" só em verificação manual no macOS.
- Publicação na VPS recusa manifestos `latest*.yml` de outra versão e artefatos sem a versão no nome.

## 0.4.0 — 2026-11-16

### Configurações (Padrão VS Code)

- Redesenho completo do menu de configurações: migrado de painel estreito na sidebar para modal dedicado centralizado no estilo VS Code (`Ctrl+,` ou `Cmd+,`).
- Navegação por categorias: Mais Usadas, Editor, Aparência, Terminal, IA, Git, Atualizações e Privacidade.
- Campo de busca instantânea com suporte ao filtro `@modified` para exibir apenas configurações alteradas.
- Indicador visual em vermelho para itens modificados e botão de redefinição individual (`↺`) para restaurar o valor padrão.
- Alternância instantânea entre visualização visual (formulário) e visualização de código JSON bruto (`{ }`) com validação de sintaxe.
- Importação direta de configurações do VS Code e Cursor (`settings.json`) mapeando preferências de editor, terminal e aparência.

### Editor e Monaco

- Web Workers dedicados do Monaco configurados via `MonacoEnvironment` (`editor.worker`, `ts.worker`, `json.worker`, `css.worker`, `html.worker`), garantindo validação de sintaxe e IntelliSense sem travar o renderer.
- Sincronização em tempo real das preferências no Monaco Editor: `fontSize`, `tabSize`, `wordWrap`, `minimap`, `lineNumbers`, `formatOnSave` e `autoSave` (`off`, `afterDelay`, `onFocusChange`).

### OTA Multiplataforma

- Atualização in-app para todas as plataformas: Windows (NSIS), Linux (AppImage) e macOS.
- Gerenciador nativo de atualização para macOS (`mac-ota.js`): parsing de `latest-mac.yml`, download com streaming de progresso em tempo real, verificação estrita de hash SHA-512, descompactação atômica via `ditto`, remoção de quarentena (`xattr -cr`) e reinício automático.
- Barra de progresso visual de download da atualização incorporada diretamente na categoria "Atualizações" do modal de configurações.
- Validador estrito de referências em manifestos adicionado ao `tools/publish-vps-release.js`, prevenindo publicação na VPS de manifestos com links para arquivos ausentes.
- Workflow GitHub Actions (`.github/workflows/release.yml`) configurado com matriz multiplataforma (`ubuntu-22.04`, `windows-latest`, `macos-14`) para compilação e empacotamento consolidado de releases por tag.

## 0.3.0 — 2026-11-12

### IA

- Wizard de configuração para OpenAI, Anthropic, Groq, OpenRouter, Gemini, Ollama e endpoints customizados.
- Chat com streaming, cancelamento, histórico persistente e Markdown sanitizado.
- Contexto opcional do arquivo, seleção e saída recente do terminal.
- Comandos rápidos para explicar, refatorar, documentar e gerar testes.
- Revisão em diff antes de aplicar código, com suporte a desfazer.
- Chaves mantidas no cofre do sistema e erros redigidos.

### Editor e estabilidade

- Explorer vertical corrigido, atualização externa e preservação de pastas expandidas.
- Quatro estilos de ícones para Explorer e abas.
- Lint sem avisos e cobertura E2E ampliada.

### Atualizações

- OTA próprio via `https://code.rsolutionsbr.com/release/`, sem GitHub Releases.
- Download automático no Windows e Linux com confirmação antes da instalação.
- Aviso e download manual no macOS enquanto o aplicativo não estiver assinado.
- Publicação atômica na VPS, checksums SHA-256 e rollback por release imutável.
