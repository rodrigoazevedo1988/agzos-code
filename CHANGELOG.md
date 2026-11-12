# Changelog

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
