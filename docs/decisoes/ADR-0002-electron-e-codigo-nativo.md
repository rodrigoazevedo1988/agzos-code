# ADR-0002 — Electron 44, builds multiplataforma e política de código nativo

**Status:** Aceito — 28/10/2026
**Substitui parcialmente:** a versão do Electron fixada na Fase 1 (32.x)
**Relacionado:** [ADR-0001](ADR-0001-base-do-editor.md)

## Contexto

A Fase 1 fechou com `electron@32.3.3` (Chromium 128, Node 20). O Electron 32 está **fora de suporte desde 03/03/2025**; a linha suportada em outubro de 2026 é 43–45. O projeto também precisa de builds reproduzíveis para Windows, Linux e macOS, incluindo macOS assinado para testes locais.

O Rodrigo autorizou usar C#/.NET no Windows ou Swift no macOS para o que for necessário, com liberdade para ajustar as linguagens. Isso não significa reescrever o editor: o ADR-0001 mantém Electron + Monaco como base.

## Decisão

1. **Atualizar para Electron 44.x** (hoje 44.10.0, Chromium 152, Node 24) e `electron-builder` 26.x. A 44 tem suporte até 03/2027; a 45 fica para depois da v1.0, salvo necessidade de segurança.
2. **Ports de build** (não ports de linguagem):
   - macOS: DMG + ZIP, `arm64` e `x64`.
   - Windows: NSIS + portable, `x64` e `arm64`.
   - Linux: AppImage + DEB + RPM, `x64` (arm64 pode ser adicionado quando houver demanda/teste).
3. **Código nativo é exceção, não regra.** O núcleo continua em JavaScript (CommonJS no main, ESM no renderer). C#/.NET ou Swift só entram se uma integração de SO **não tiver equivalente no Electron/Node**, e sempre como:
   - helper opcional (sidecar) com IPC/CLI documentado, nunca requisito para abrir o editor;
   - build e testes no CI da plataforma;
   - fallback funcional quando o helper não estiver presente;
   - ADR próprio antes da implementação.
4. **Assinatura local no macOS:** o app de desenvolvimento é assinado com a identidade `Rodrigo Dev Local` (Keychain), bundle id `com.agzos.code`, via `tools/sign-mac-dev.js`. Isso estabiliza a identidade perante o TCC e evita repetir prompts de Área de Trabalho/Documentos/Downloads a cada rebuild. Em CI ou máquina sem o certificado, o script apenas avisa e segue.
5. **Distribuição macOS** continua exigindo Apple Developer ID + notarização (Fase 5). A assinatura local **não** substitui isso e não torna o app “notarizado”.

## Consequências

- Main process roda em Node 24; revisar APIs depreciadas e o `safeStorage` no macOS/Linux.
- `node-pty` (Fase 4) deve ser compilado contra o ABI do Electron 44; fazer o upgrade **antes** de adicionar módulos nativos.
- O CI precisa de matriz macOS/Windows/Linux para os builds; o CI atual só cobre Linux.
- Nenhum código C#/.NET ou Swift será introduzido na v1.0 sem uma necessidade concreta. Se aparecer, o custo de manutenção (toolchain, assinatura, CI) entra no orçamento da fase.
- O app de dev passa a ter o mesmo bundle id do app empacotado; permissões de pasta concedidas ao app de dev valem para o pacote local (e vice-versa).

## Alternativas consideradas

- **Ficar na 32:** rejeitado por EOL e CVEs do Chromium 128.
- **Ir direto para 45:** adiado; 44 é a linha estável com mais tempo de suporte e menos risco imediato.
- **Reescrever o app em C#/.NET ou Swift:** rejeitado; contradiz o ADR-0001, multiplicaria o custo por três e perderia Monaco/electron-builder.
- **Assinatura ad-hoc (`codesign -s -`)**: rejeitada para dev; a identidade muda a cada build e o TCC volta a perguntar.
