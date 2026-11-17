# Changelog

## 1.2.0 — 2026-11-17

### Pasta remota via SSH

- Abra uma pasta de um servidor pelo botão remoto da barra de status ("Abrir pasta remota via SSH"), na janela atual ou em nova janela. Explorer, editor, visualizadores, busca, Quick Open, terminal, painel Git e agente funcionam no servidor.
- Conexão por alias do `~/.ssh/config` ou `usuario@host:porta`. Autenticação pelo agente SSH (ssh-agent, OpenSSH do Windows, Pageant), chaves (passphrase pedida) ou senha — guardada no cofre do sistema só com "Lembrar".
- Chave do servidor conferida no `known_hosts`: desconhecida pede confirmação com o fingerprint; divergente bloqueia a conexão.
- Queda de conexão mostra "Reconectar" e não perde o que não foi salvo. Push/pull no servidor usam as credenciais do próprio servidor (o token do GitHub não é enviado).
- Histórico local, Linha do tempo, Árvore, Ao Vivo e Formatador também funcionam na pasta remota.

### Snippets de Agência

- Biblioteca com 22 componentes Agzos prontos (hero, CTA, formulários, pricing, prova social, FAQ, rodapé, navbar…) em HTML + Tailwind, com miniaturas.
- Clique insere no cursor; arraste para o editor; em `.jsx/.tsx` o HTML vira JSX. Variáveis da marca (`{{cor_primaria}}`, `{{nome_marca}}`…) em Configurações → Módulos Agzos → Snippets.
- Criar, editar, duplicar, apagar, restaurar originais, importar/exportar e "Salvar seleção como snippet". Ferramentas do agente: `list_snippets`, `insert_snippet`, `save_snippet`.

### Histórico local e Agzos Git Slider

- Cópia de cada arquivo a cada salvamento e antes de alterações do agente, da Vassoura e do Cofre (até 50 por arquivo, 30 dias, 300 MB).
- Linha do tempo do arquivo (`Ctrl+Alt+H`): commits e versões locais juntos, diff, ←/→, "Restaurar esta versão" e "Comparar com a anterior". Ferramenta do agente `file_history`.

### Novos Módulos Agzos

- **Erros na Linha:** erros e avisos no fim da linha.
- **Erros Claros:** mensagens do TypeScript formatadas no hover e no painel Problemas (que agora lista os problemas do arquivo).
- **Marca-texto:** comentários coloridos por marcador (`!`, `?`, `TODO`, `FIXME`, `*`, `//`).
- **Formatador:** formatação estilo Prettier, "Formatar ao salvar" por linguagem; lê `.prettierrc` JSON/YAML e nunca executa código do projeto.
- **Árvore:** árvore de pastas em texto para README (respeita `.gitignore`), copiar, inserir ou criar `ARVORE.md`; ferramenta `project_tree`.
- **Snap:** imagem PNG bonita do código (tema, fundo, moldura, números de linha, marca d'água).
- **Ao Vivo:** servidor local (127.0.0.1) que recarrega o navegador ao salvar; aparece na aba PORTAS.

### Agzos IA

- **Compactar conversa:** `/compactar`, menu ⋯ ou paleta; automático quando a conversa passa do limite (≈ 60 mil tokens, configurável). Durante execuções longas, saídas antigas de ferramentas viram resumo.
- **Limite de passos do agente** configurável (25 a 500, padrão 100) e botão **Continuar** quando o limite é atingido.

### Correções e melhorias

- Título da janela mostra `projeto › arquivo — Agzos Code`.
- Explorer: a pasta relê o disco ao abrir e a árvore observa mudanças (arquivos criados por outros programas, como downloads, aparecem sozinhos); pastas linkadas (symlink, junction, OneDrive) expandem; erro ao abrir pasta aparece em aviso.
- Histórico: dois salvamentos seguidos não guardam versão vazia.
- Explorer mostra arquivos ocultos (`.gitignore`, `.env`, `.github`, `.vscode`…); só `.git`, `.DS_Store` e afins ficam ocultos, lista editável em Configurações → "Arquivos: Ocultar no Explorer".
- Árvore: Copiar/Inserir/Criar usam sempre as opções atuais.

### Segurança (revisão independente da 1.2.0)

- Pasta remota: chave do servidor de outro tipo que a registrada bloqueia a conexão (antes aparecia como "host desconhecido"); hosts no `known_hosts` comparados sem diferenciar maiúsculas.
- Pasta remota: links simbólicos no servidor não saem da pasta aberta (leitura, escrita, listagem, agente e Ao Vivo).
- Pasta remota: o tempo limite da conexão pausa enquanto você confere o fingerprint ou digita a senha; 2FA (keyboard-interactive) pergunta cada código em vez de enviar a senha; sem conexões duplicadas na reconexão.
- `.gitignore`, `.prettierrc` e globs da busca do agente com padrões maliciosos não congelam mais o app (matcher sem backtracking).
- Git Slider não lê versão de outro arquivo nem aceita nomes de arquivo como pathspec especial do git.
- Ao Vivo não serve `.env`/`.git` através de links simbólicos.
- Observador de arquivos no Linux só vigia as pastas abertas na árvore (não esgota o limite do sistema em projetos grandes).

### Limitações conhecidas

- Pasta remota: servidor precisa ser POSIX (Linux/macOS); no agente remoto não há `clean_code`, ferramentas do Cofre nem dos Snippets; hook pre-commit do Cofre e skills de projeto não funcionam; links simbólicos no servidor não são resolvidos.
- Não testado em Windows real nem macOS.

## 1.1.0 — 2026-11-17

### Módulos Agzos (utilidades nativas, sem extensões)

- O botão Extensões virou **Módulos Agzos** (`Ctrl+Shift+X`): hub com Vassoura de Produção e Cofre .env; Snippets, Sandbox e Git Slider aparecem como "Em breve".
- **Vassoura de Produção:** remove `console.*` (mantém `console.error`/`warn` por padrão), comentários (mantém JSDoc, diretivas e licença), imports não usados e código morto simples, sem tocar em strings e templates. Arquivo com erro de sintaxe nunca é alterado.
  - Preview em diff, limpeza do workspace com progresso e cancelar, Desfazer, contador 🧹 na barra de status, badges no Explorer e menu de contexto.
  - Ferramenta `clean_code` para o agente. A análise roda num processo separado que encerra sozinho após 20 s ocioso.
- **Cofre .env:** lista os `.env*` com valores mascarados (revelar com clique longo ou `Alt`), compara com o `.env.example`, aponta segredos (AWS, Stripe, OpenAI, Anthropic, GitHub, Google, Slack, JWT, chaves privadas, URLs com senha) e gera o `.env.example`.
  - **Bloqueia commit com segredo** no painel Git e no `git commit` do agente; "Ignorar uma vez" fica registrado num log sem o valor. Hook pre-commit opcional para commits feitos no terminal.
  - Editar, adicionar e remover chaves com Desfazer. Ferramenta `env_check` para o agente, que nunca recebe valores.
- Configurações → Módulos Agzos.

### Agzos IA

- **Fila de mensagens:** enquanto o agente trabalha, o que você envia entra na fila e sai sozinho no fim; "Enviar agora" injeta a mensagem na execução em andamento sem cancelar.
- **Anexos:** clipe, colar print (`Ctrl+V`) e arrastar arquivos. Imagens vão como visão; texto/código como conteúdo; PDF com texto extraído.
- **Modos com skills:** Agente, Chat, Plan (só leitura, com "Executar plano"), Debugger de Erros, Criador de Sites e Cyber Security (auditoria defensiva). Cada modo é uma skill em Markdown que funciona com qualquer provedor; skills próprias em `.agzos/skills/` do projeto ou na pasta do usuário.
- **Histórico** de todas as conversas, de todas as pastas, com busca, renomear, apagar e exportar.
- **Exportar conversa** em Markdown ou PDF, com as ações do agente e segredos redigidos.
- Correção: "Nova conversa" e histórico ficavam sem resposta depois de uma resposta interrompida.
- Provider sobrecarregado (429/502/503/504/529, comum no Gemini do AI Studio): tenta de novo sozinho 2 vezes e mostra a mensagem do provider, em vez de "Erro do provider (503):" vazio.

### Barra de menus e janelas

- **Barra de menus** em pt-BR (Arquivo, Editar, Seleção, Ver, Ir, Executar, Terminal, Ajuda), discreta, com navegação por teclado (`Alt`). O que ainda não existe aparece como "Em breve" (lista no [BACKLOG](docs/plano/BACKLOG.md)).
  - Novo Arquivo de Texto, Abrir Recente, Salvar Todos, Reverter Arquivo, Fechar Pasta, Executar Arquivo Ativo, Executar Tarefa (scripts do `package.json`), Executar Texto Selecionado e ações de seleção/navegação do editor.
- **Várias janelas** (`Ctrl+Shift+N`), cada uma com sua pasta e **permissões isoladas como no VS Code**: uma janela não acessa arquivos da pasta aberta em outra. Configurações sincronizadas entre janelas.
- **Sair** (`Ctrl+Q`) pede confirmação, com "Não perguntar novamente".

### Visualizadores de arquivos

- Imagens (png, jpg, gif, webp, avif, bmp, ico, svg) com zoom; vídeo e áudio; PDF; **DOCX**; **XLSX/XLS/ODS** com abas e rolagem virtual; CSV/TSV em tabela; pré-visualização de **Markdown** ao lado (`Ctrl+Shift+V`), atualizando ao digitar.
- Formatos sem pré-visualização (heic, tiff, psd, pptx…) e binários mostram "Abrir no app padrão" e "Revelar na pasta".
- Arquivos servidos por um protocolo próprio restrito à pasta da janela.

### SSH

- Botão remoto na barra de status: conecta a hosts do `~/.ssh/config` num terminal SSH, adiciona hosts e abre o arquivo de configuração. A pasta remota completa (SSH/SFTP) vem na 1.2.0.

### Explorer

- Cabeçalho com Novo Arquivo, Nova Pasta, Atualizar e Recolher Pastas, só na view do Explorer.

### Terminal

- Windows: usa o ConPTY empacotado (o mesmo do Windows Terminal); corrige a barra de espaço que sumia no PowerShell 7. `AGZOS_CONPTY_DLL=0` volta ao do sistema.
- Recolher nomes na lista de sessões (só ícones), com o estado salvo.

### Segurança (revisão independente da 1.1.0)

- Skills de `.agzos/skills` do projeto ficam num grupo próprio, não substituem as do app e só rodam depois que você confia nelas (vale para aquele conteúdo; se mudar, pede de novo).
- Segredos redigidos na saída das ferramentas do agente; `read_file` e `search` mascaram os valores de `.env`.
- Links só abrem fora do app com `http`, `https` ou `mailto` (inclusive clique do meio no preview de Markdown).
- "Executar Arquivo Ativo" e "Executar Tarefa" usam aspas seguras por shell e recusam nomes perigosos.
- Desfazer (agente, Vassoura, Cofre) só vale na janela que fez a alteração; cópias de segurança em disco com permissão 0700/0600.
- A Vassoura nunca remove declarações içadas (`var`, `function`, tipos), fábricas de JSX (`h`, `jsx`, `@jsx`, `jsxFactory`) nem `console.*` com efeito nos argumentos.

### Interno

- Testes, builds e publicação rodam só na VPS (workflows do GitHub Actions removidos).
- `tools/measure-ram.js` mede a RAM em repouso e com os módulos ativos.

### Limitações conhecidas

- Testado em Linux; falta validação em Windows real e macOS (hook pre-commit, SSH e PDF incluídos).
- Durante a análise do workspace, a Vassoura usa cerca de 150 MB a mais (o compilador TypeScript), liberados quando o processo encerra.
- Sair pelo Dock do macOS ou pelo logout do sistema não pergunta.

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

### Release

- Publicação na VPS mantém só as 2 releases mais recentes (`--keep`, padrão 2) e remove as antigas após trocar `current`.

### Limitações conhecidas

- Testado com servidores falsos (OpenAI/Anthropic/GitHub) e em Linux; falta validação em Windows real, no github.com e com modelos reais.
- Login "Entrar com GitHub" (Device Flow) depende de um OAuth App da Agzos; por enquanto só token (PAT).
- Sem interface de merge/rebase; conflitos aparecem na lista, mas são resolvidos no editor ou terminal.
- Cabeçalho da sidebar mostra botões do Explorer também nas views Git e IA.
- macOS não é buildado nesta release (depende de host macOS).

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
