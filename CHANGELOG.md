# Changelog

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
