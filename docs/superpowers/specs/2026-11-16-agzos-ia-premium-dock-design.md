# Agzos IA — painel premium acoplável (0.6.0)

Data: 2026-11-16 · Etapa 1 de 2 (etapa 2 = modo agente, 0.7.0, spec própria)

## Objetivo

O painel Agzos IA deixa de ser um formulário na sidebar esquerda e vira um painel de agente premium (padrão de layout dos painéis de agente de IDEs, com identidade Agzos preto/vermelho — sem copiar marca ou visual de terceiros), acoplável à **esquerda**, **direita** ou **embaixo**, com personalização.

Critério de sucesso: o painel funciona igual nas 3 posições, com redimensionamento; trocar de posição não perde a conversa nem um streaming em andamento; posição e tamanho persistem entre reinícios; visual coeso e polido nos temas agzos-dark, agzos-light e monokai.

## Arquitetura

### Unidade 1 — Dock (`src/renderer/scripts/ai-dock.js`, novo)

- Um único elemento `<section id="ai-panel">` contém todo o chat. O dock **move esse elemento** (appendChild) para o host da posição escolhida; nada é recriado.
- Hosts:
  - `left`: dentro da sidebar, ativado pelo botão da activity bar `data-view="ai"` (comportamento atual).
  - `right`: nova coluna `#right-dock` à direita do `#workbench-body`, com divisor arrastável (`col-resize`), largura padrão 380px, min 280px, máx 60vw.
  - `bottom`: nova aba `AGZOS IA` no `#bottom-panel` (ao lado de TERMINAL/OUTPUT/PROBLEMAS), pane `#pane-ai`.
- API exportada e em `window.AgzosAiDock`: `getPosition()`, `setPosition(pos)`, `show()`, `hide()`, `toggle()`, `isVisible()`.
- Persistência: `State.settings.aiPanel = { position: 'right', width: 380, visible: true }` salvo via o fluxo de settings existente.
- Atalhos: `Ctrl+L` alterna visibilidade/foca a caixa de mensagem; comando de paleta "Agzos IA: Mover para Esquerda/Direita/Embaixo".
- Reutiliza o padrão de divisor já existente no terminal (`setupResizer` em terminal.js) sem acoplar os dois.
- Posição padrão na 0.6.0: `right`.

### Unidade 2 — Chat premium (`ai-chat.js` + `styles/ai-panel.css`, novo)

- `ai-chat.js` renderiza toda a marcação dentro de `#ai-panel` (o HTML estático do painel antigo em index.html é removido). Não depende da posição; usa container queries/`ResizeObserver` para modo compacto quando estreito ou baixo.
- Cabeçalho compacto: título "Agzos IA", seletor único perfil·modelo (pill com dropdown), botões: nova conversa, histórico, menu ⋯ (mover para esquerda/direita/embaixo, configurações de IA, fechar).
- Mensagens: usuário em bolha discreta alinhada; assistente em texto corrido com avatar Agzos (opcional); Markdown sanitizado existente; blocos de código com cabeçalho (linguagem + copiar / inserir no editor / aplicar com diff — reaproveita ai-apply.js/diff-view.js); streaming com cursor animado e indicador "pensando"; erro inline com "tentar de novo".
- Estado vazio: logo, frase curta e 4 sugestões clicáveis (Explicar arquivo, Encontrar bugs, Gerar testes, Documentar).
- Composer: textarea auto-crescente (1–10 linhas), chips de contexto dentro da caixa (Arquivo atual com nome, Seleção com nº de linhas, Terminal), botão enviar/parar (ícone), dica de atalho. `Enter` envia e `Shift+Enter` quebra linha (configurável para `Ctrl+Enter`).
- Histórico: múltiplas conversas por workspace (lista com título gerado da 1ª mensagem, data, apagar). Main: `chat-history.js` passa a guardar `{ conversations: [{id,title,updatedAt,messages}] , activeId }`, migrando o formato antigo (array de mensagens) para uma conversa. Limites: 50 conversas, 200 mensagens cada.
- Sem perfil configurado: estado vazio com botão "Configurar IA" (wizard existente).

### Unidade 3 — Personalização (Configurações → Agzos IA)

Chaves em `State.settings.aiPanel` (aplicação ao vivo):
- `position`: left | right | bottom
- `fontSize`: 11–18 (padrão 13)
- `density`: compact | comfortable
- `showAvatars`: bool
- `sendKey`: enter | ctrlEnter
- `defaultContext`: { file, selection, terminal }
- `width` (right/left) e altura usa a do painel inferior.

## Erros e casos de borda

- Trocar de posição durante streaming: o streaming continua (DOM é movido, não recriado).
- Posição `bottom` com painel inferior fechado: `show()` abre o painel inferior na aba AGZOS IA.
- Terminal e IA embaixo ao mesmo tempo: abas do mesmo painel; o terminal continua com seus botões (mover/maximizar) e a IA ganha os seus.
- Settings inválidos caem no padrão.

## Testes

- Unit: migração do histórico antigo → conversas; normalização de settings `aiPanel`; título de conversa.
- E2E (xvfb): mover para left/right/bottom mantém mensagens e `#ai-input` focável; divisor da direita muda a largura; posição persiste após reiniciar; `Ctrl+L` alterna; envio com `Enter`/`Shift+Enter`; screenshots nas 3 posições e nos 3 temas.
- Suítes existentes (`npm run check`, e2e) continuam verdes.
