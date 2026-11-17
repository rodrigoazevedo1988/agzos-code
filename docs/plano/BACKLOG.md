# Backlog — Agzos Code

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

- ~~**Guard único entre janelas**~~ e ~~**Configurações compartilhadas**~~: resolvidos na 1.1.0 (guard por janela, `settings:changed` + merge por campo) — ver [relatório](relatorios/v1.1.0-janelas.md).
- **Recentes compartilhados:** `recentFolders` é um só; qualquer janela reabre uma pasta recente (inclusive a aberta em outra janela) pelo fluxo de abrir, como no VS Code. **—**
- **Sair pelo Dock (macOS) / encerramento do SO** não passam pela confirmação de sair (só Cmd+Q, menu e Ctrl+Q). Interceptar `before-quit` sem travar o fechamento da última janela e o `quitAndInstall` do updater. **P**
- **Sair com arquivos não salvos** só avisa e descarta ("Sair sem salvar"); não há "Salvar tudo e sair". **P**
- **macOS:** a barra in-app fica escondida e vale o menu nativo do sistema, que ainda é o enxuto de antes (Nova Janela, Abrir Pasta, Salvar, Configurações, Paleta, Terminal, Sidebar, Ajuda). Gerar o menu nativo a partir de `menu-model.js` (IPC renderer → main com o template). **M**
- **Avisos do updater** vão só para a janela focada (de propósito, para não repetir o diálogo de reinício em cada janela).

## Visualizadores — Em breve

Entrega atual (v1.1.0): imagens comuns, vídeo/áudio nativos do Chromium, PDF embutido, DOCX (docx-preview),
XLSX/XLS/ODS e CSV/TSV em grade virtual, pré-visualização de Markdown e telas de fallback
("Abrir no app padrão" / "Revelar na pasta").

- **PPTX/ODP** — sem lib JS madura; avaliar conversão para PDF via LibreOffice instalado ou só miniatura. **G**
- **DOC/PPT/ODT legados** — conversão via LibreOffice (`soffice --convert-to pdf`) quando instalado. **M**
- **TIFF** — `utif` (MIT, ~30 KB minificado) decodificando para canvas. **P**
- **HEIC/HEIF** — `heic2any`/libheif (WASM, ~1–2 MB) ou conversão nativa do SO. **M**
- **PSD** — `ag-psd` (MIT) para a imagem composta. **M**
- **RAW de câmera (CR2/NEF/ARW/DNG)** — miniatura embutida no arquivo; render completo fora de escopo. **M**
- **MKV/AVI/HEVC sem suporte** — transcodificar sob demanda com ffmpeg do sistema (ou ffmpeg.wasm, ~25 MB). **G**
- **Anotações e formulários em PDF** — o visualizador do Chromium só lê; precisaria de pdf.js com camada de edição. **G**
- **Busca de texto dentro do PDF pela busca do workspace** — extrair texto com pdf.js. **M**
- **Imagens remotas no Markdown** — liberar `img-src https:` atrás de uma configuração (rastreamento por pixel). **P**
- **Scroll sincronizado por linha no Markdown** — mapear linhas do fonte (tokens do marked) em vez de proporção. **P**
- **Mermaid/KaTeX na pré-visualização** — diagramas e fórmulas. **M**
- **Comparar imagens no diff do Git** — lado a lado / sobreposição para PNG/JPG alterados. **M**
- **Hex viewer para binários** — em vez de só "Abrir mesmo assim como texto". **M**
- **CSV acima de 5 MB** — hoje o limite de leitura de texto (5 MB) vale também para a grade; ler em streaming. **P**
- **Planilhas: fórmulas, formatação e células mescladas** — hoje só valores formatados, sem cores/mesclas. **M**
- **DOCX: busca no documento e cópia com formatação** — o render é somente leitura e sem Ctrl+F. **P**
- **Tirar xlsx/docx-preview/jszip do pacote** — o renderer usa só as cópias em `vendor/`; excluir de `build.files` (≈ 11 MB). **P**
- **Soltar pasta do SO abre workspace** — hoje só arquivos são abertos ao arrastar. **P**

## Agzos IA — Em breve

- **Anexos DOCX/XLSX/PPTX (e ODT/ODS).** Hoje são recusados com "ainda não suportado — veja
  o backlog". Ideia: extrair texto no main (docx → XML de `word/document.xml`; xlsx → planilhas
  como CSV) sem dependência pesada, no mesmo limite de 200 KB de texto. Mora em
  `src/main/ai/attachments.js`.
- **PDF digitalizado (OCR).** PDF sem texto extraível é recusado. Precisaria de OCR local.
- **Detecção automática de visão por modelo.** O perfil aceita `vision: true|false|auto`
  (Configurações → Agzos IA); em `auto` o erro do provider vira mensagem clara. Falta uma tabela
  de modelos conhecidos para avisar antes de enviar.
- **Steer no meio de um lote de ferramentas.** "Enviar agora" entra depois de terminar todas
  as chamadas de ferramenta da resposta atual do modelo (ponto seguro), não entre duas delas.
- **Fila persistente.** A fila de mensagens vive só na sessão do painel (some ao trocar de
  pasta ou reiniciar).
- **Renomear/apagar várias conversas de uma vez e exportar todas** no histórico global.
- **Exportar com diffs completos.** O transcript traz o resumo das ações (+/− linhas, exit
  code); os diffs inteiros não são guardados no histórico.
