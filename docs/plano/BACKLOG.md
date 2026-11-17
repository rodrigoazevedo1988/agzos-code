# Backlog

Itens conhecidos que ainda não têm fase. Tamanho: **P** (até 1 dia), **M** (2–4 dias), **G** (1 semana ou mais).

## Barra de menus — itens Em breve

Itens que aparecem na barra de menus (v1.1.0) desabilitados, com o selo "Em breve". Fonte: `src/renderer/scripts/menu-model.js` (`comingSoon: true`). Ao implementar um item, troque `soon(...)` por um item com `run` e tire a linha daqui.

### Arquivo
| Item | O que falta | Tamanho |
|---|---|---|
| Adicionar Pasta ao Workspace… | Workspace com várias raízes: árvore com várias pastas, guard/quick open/busca/git por raiz. | G |
| Salvar Workspace Como… | Formato de arquivo de workspace (`.agzos-workspace`) com as pastas e configurações; abrir esse arquivo. Depende do item acima. | M |

### Editar
| Item | O que falta | Tamanho |
|---|---|---|
| Substituir nos Arquivos | Campo "substituir" no painel de busca, prévia por arquivo e gravação em lote (com desfazer). | M |
| Expandir Abreviação Emmet | Integrar `emmet-monaco-es` (ou equivalente) para HTML/CSS/JSX e ligar Tab. | P |

### Ver
| Item | O que falta | Tamanho |
|---|---|---|
| Abrir Visualização… | Picker com todas as views (sidebar, painel, IA) como no `Ctrl+Q` do VS Code. | P |
| Layout do Editor › | Dividir o editor (vários Monaco lado a lado / grupos de abas). | G |
| Executar e Depurar | View de depuração; depende do depurador (ver Executar). | G |
| Navegador | Integração com o Agzos Browser (preview de páginas/links). | G |
| Console de Depuração | Aba no painel inferior ligada ao depurador. | M |

### Ir
| Item | O que falta | Tamanho |
|---|---|---|
| Voltar / Avançar | Pilha de navegação (arquivo + posição) alimentada por troca de aba, Ir para Definição e buscas. | M |
| Último Local de Edição | Guardar a última posição editada por arquivo; usa a mesma pilha de navegação. | P |
| Ir para Símbolo no Workspace… | Índice de símbolos do projeto (LSP ou ctags/ripgrep). | G |
| Próxima / Alteração Anterior | Decorações de diff do git no gutter do editor e navegação entre blocos. | M |

### Executar (depuração)
| Item | O que falta | Tamanho |
|---|---|---|
| Iniciar Depuração / Executar Sem Depuração / Parar / Reiniciar | Cliente DAP (Debug Adapter Protocol) no main + adaptador Node (`js-debug`) para começar. | G |
| Abrir Configurações de Depuração / Adicionar Configuração… | Suporte a `launch.json` (ler, validar, gerar modelo). Depende do cliente DAP. | M |
| Depuração Parcial / Intervir / Sair da Função / Continuar | Comandos de step do DAP + barra de depuração. Depende do cliente DAP. | M |
| Pontos de interrupção (alternar, novo, habilitar/desabilitar/remover todos) | Glifos no gutter do Monaco, persistência por arquivo e envio ao adaptador. | M |
| Instalar Depuradores Adicionais… | Catálogo de adaptadores DAP baixáveis (Python, Go, PHP). Depende do cliente DAP. | G |

### Terminal
| Item | O que falta | Tamanho |
|---|---|---|
| Nova Janela de Terminal | Janela própria só com o painel de terminal (BrowserWindow dedicada). | M |
| Mostrar / Reiniciar / Encerrar Tarefas em Execução | Registro das tarefas iniciadas por Executar Tarefa (id do terminal, estado) e ações sobre elas. | P |
| Configurar Tarefas… | Suporte a `.vscode/tasks.json` (ou `.agzos/tasks.json`) além dos scripts do `package.json`. | M |

## Barra de menus — limitações conhecidas

- **Guard único entre janelas:** o path guard do main libera a união das pastas abertas em todas as janelas; uma janela poderia ler a pasta aberta em outra (ambas foram escolhidas pelo usuário). Separar o guard por `webContents.id` exige passar o remetente para todos os handlers `fs:*`/`git:*`/módulos. **M**
- **Configurações compartilhadas:** `settings.json` é um só; mudar tema/fonte numa janela grava para todas, mas as outras só aplicam ao reiniciar (não há broadcast de settings), e uma janela com cópia velha pode sobrescrever ao salvar. Resolver com um evento `settings:changed` do main para todas as janelas. **P**
- **macOS:** a barra in-app fica escondida e vale o menu nativo do sistema, que ainda é o enxuto de antes (Nova Janela, Abrir Pasta, Salvar, Configurações, Paleta, Terminal, Sidebar, Ajuda). Gerar o menu nativo a partir de `menu-model.js` (IPC renderer → main com o template). **M**
- **Avisos do updater** vão só para a janela focada (de propósito, para não repetir o diálogo de reinício em cada janela).
