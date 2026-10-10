# PRD — Agzos Code

**Versão:** 0.1 (Draft)
**Data:** 09/10/2026
**Status:** Em definição
**Base prevista:** Fork do Code-OSS (microsoft/vscode) + Electron — ver [ADR-0001](../decisoes/ADR-0001-base-do-editor.md)
**Plataformas:** Windows (x64/arm64), Linux (AppImage/DEB/RPM) e macOS (DMG/ZIP)

> Implementação atual (v0.1): editor Electron + Monaco próprio, não fork do Code-OSS. A decisão de base está em aberto no ADR-0001.

## 1. Visão do Produto

O **Agzos Code** é um editor de código baseado no VS Code. Mantém compatibilidade com extensões do VS Code e adiciona de forma nativa:

- IA conversacional e agent via APIs (incluindo opções gratuitas)
- Integração com o ecossistema Agzos (Browser, Key, Project, Hub e futuros produtos)
- Experiência personalizada para o time interno da Agzos, com caminho para clientes no futuro
- Controle total sobre telemetria e performance

Objetivo: ambiente familiar (quem usa VS Code já sabe usar), com produtividade de IA e integração com ferramentas Agzos sem depender de extensões de terceiros.

## 2. Objetivos

| Objetivo | Descrição | Prioridade |
|----------|-----------|------------|
| Familiaridade | 100% compatível com extensões e atalhos do VS Code | Alta |
| IA nativa fácil | Configuração guiada + chat agent multi-provider | Alta |
| Integração Agzos | Conectar com Browser, Key, Project e outros serviços | Alta |
| Performance | Bom desempenho em máquinas modestas + modo de alta performance | Alta |
| Privacidade | Telemetria mínima e sempre com consentimento explícito | Alta |
| Evolução | Base gratuita com possibilidade de freemium | Média |

## 3. Público-alvo

**Primário (MVP):** time interno da Agzos (devs, leads técnicos e quem trabalha com projetos de clientes).

**Secundário (futuro):** clientes da Agzos com acesso a ferramentas customizadas ou ambientes padronizados.

**Personas:**
- **Dev Agzos** — usa VS Code diariamente, testa várias APIs de IA, precisa de multi-conta GitHub e de integração com ferramentas internas.
- **Lead/Operador** — precisa de ambiente padronizado para o time, com temas e configurações controláveis.

## 4. Diferenciais e Posicionamento

| Aspecto | VS Code / VSCodium | Cursor / Windsurf | Agzos Code |
|---------|---------------------|-------------------|------------|
| Base | Oficial ou limpa | Fork proprietário | Fork do Code-OSS |
| IA | Via extensões | Nativa profunda | Nativa + wizard + APIs livres |
| Extensões | Marketplace Microsoft | Compatível (~90%) | Compatível + nativas Agzos |
| Integrações | Nenhuma específica | Nenhuma | Ecossistema Agzos |
| Telemetria | Presente (configurável) | Presente | Mínima + consentimento |
| Multi-GitHub | Limitado | Limitado | Nativo |
| Temas | Padrão | Padrão + custom | Personalizáveis + identidade Agzos |

**Posicionamento:** "O VS Code do time Agzos — com IA fácil de configurar e integração nativa com nossas ferramentas."

## 5. Escopo do MVP (v1.0)

### Must-have
- Editor funcional com branding Agzos Code
- Modo Dark e Light (tema Agzos em destaque)
- Wizard de configuração de IA (step-by-step)
- Chat Agent nativo via API (sidebar)
- Múltiplos providers (incluindo gratuitos: Groq, OpenRouter free tiers etc.)
- Compatibilidade com extensões do VS Code (Open VSX por padrão + opção Marketplace Microsoft)
- Multi-conta GitHub (switcher de contas)
- Modos de performance (economia / balanceado / alta performance)
- Telemetria com consentimento explícito
- Instaladores para Windows, Linux e macOS
- Auto-update

### Nice-to-have (pós-MVP)
- Agzos Key (SSO)
- Abrir links/arquivos no Agzos Browser
- Sincronização com Agzos Project / Hub
- Editor visual de temas
- Extensões nativas Agzos (pré-instaladas ou recomendadas)

## 6. Features Detalhadas

### 6.1 Wizard de Configuração de IA
Na primeira execução ou em Settings → IA:

1. Boas-vindas e explicação
2. Escolha do provider (OpenAI, Anthropic, Google, Groq, OpenRouter, Ollama local, endpoint custom)
3. API Key (ou detecção de instância local)
4. Modelo padrão
5. Teste de conexão
6. Preferências de contexto (arquivos abertos, seleção, pasta)
7. Conclusão + atalhos

Permite vários providers salvos e troca rápida.

### 6.2 Chat Agent Nativo
- Painel lateral dedicado
- Contexto: arquivo atual, seleção, erros do terminal
- Histórico de conversas
- Streaming
- Comandos rápidos (explicar, refatorar, documentar, gerar testes)
- Aplicar diffs no editor
- Funciona com qualquer API configurada

### 6.3 Multi-conta GitHub
- Várias contas (OAuth ou Personal Access Token)
- Switcher na status bar ou Command Palette
- Associação repositório → conta
- Funciona com operações git e Pull Requests

### 6.4 Temas e Personalização
- Tema Agzos (preto `#0E0E0E`, vermelho `#D10A11`, branco) em destaque
- Suporte a temas VS Code existentes
- Futuro: editor visual de cores e exportação de temas

### 6.5 Performance e Telemetria
- **Modos:** Economia (menos animações e processos em background), Balanceado (padrão), Alta performance (prioriza responsividade)
- **Telemetria:** desligada por padrão. Settings → Privacy com opt-in explícito e explicação do que é coletado.

## 7. Arquitetura Técnica (alvo)

| Camada | Tecnologia |
|--------|------------|
| Base | Code-OSS (microsoft/vscode) — ver ADR-0001 |
| Runtime | Electron |
| Linguagem | TypeScript |
| Editor | Monaco Editor |
| Branding | `product.json` customizado |
| Empacotamento | electron-builder ou build do VS Code + custom |
| Extensões | Open VSX (padrão) + opção Microsoft Marketplace |
| Secrets | Keychain / libsecret / Windows Credential Manager |
| Atualizações | electron-updater |

**`product.json` (no caso de fork Code-OSS):**
- `nameShort` / `nameLong`: "Agzos Code"
- `applicationName`: "agzos-code"
- `dataFolderName`: ".agzos-code"
- Ícones e logos próprios
- Endpoints de telemetria próprios ou vazios
- Gallery de extensões configurável

**Builds:** Windows NSIS + portable; macOS DMG + ZIP (assinado e notarizado); Linux AppImage + DEB + RPM.

## 8. Requisitos Não-Funcionais

- **Performance:** inicialização aceitável em máquinas de 8 GB RAM. Modo economia reduz memória e CPU.
- **Privacidade:** nenhum dado enviado sem consentimento. API keys em cofre seguro.
- **Compatibilidade:** extensões populares do VS Code funcionando (testar top 50).
- **Segurança:** boas práticas de Electron (contextIsolation, sandbox quando possível).
- **Manutenção:** rebase periódico com upstream (se fork).

## 9. Monetização

- **Gratuito:** editor completo + wizard de IA + chat básico + multi-GitHub + temas.
- **Freemium (futuro):** agentes em background, indexação profunda de codebase, colaboração em time, modelos premium com créditos, suporte prioritário.

## 10. Roadmap

Ver [plano/ROADMAP.md](../plano/ROADMAP.md) — versão viva e detalhada.

| Fase | Foco |
|------|------|
| 0 — Setup | Editor + branding + builds básicos |
| 1 — MVP Core | Wizard IA + Chat Agent + Multi-GitHub + Performance/Telemetria |
| 2 — Polimento | Temas + auto-update + testes de extensões |
| 3 — Integrações | Agzos Key, Browser, Project |
| 4 — Freemium | Recursos pagos + billing |

## 11. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Manutenção do fork (upstream) | Alto | Rebase documentado + testes automatizados |
| Compatibilidade de extensões | Médio | Open VSX + testes regulares |
| Performance da IA | Médio | Modos de performance + streaming + cache |
| Licença / branding | Médio | Nunca usar marcas Microsoft; seguir MIT |
| Assinatura de apps (macOS) | Médio | CI com certificados (GitHub Actions + runner Mac) |

## 12. Métricas de Sucesso (MVP)

- Time interno usando diariamente no lugar do VS Code
- Configuração do wizard de IA bem-sucedida em > 90%
- Uso recorrente do chat agent
- Feedback positivo sobre performance e privacidade
- Zero reclamações graves de telemetria não consentida
