# Fase 5 — Distribuição e v1.0: Plano de Implementação

> **Para o executor:** leia antes o [guia do executor](00-guia-do-executor.md). Pré-requisito: Fase 4 mergeada.

**Objetivo:** instaladores das 3 plataformas publicados no GitHub Releases por tag, atualização automática onde é possível sem certificado, tela de privacidade e caminho pronto para assinatura.

**Arquitetura:** workflow `release.yml` disparado por tag `v*` roda `electron-builder --publish always` em matriz macOS/Windows/Linux. `electron-updater` lê o GitHub Releases.

**Stack:** `electron-builder@^25`, `electron-updater@^6`.

**Branch:** `feat/fase-5-distribuicao`

## Restrições globais

- **macOS sem assinatura não aceita auto-update** (Squirrel.Mac exige app assinado). Até haver Apple Developer ID: no macOS, só avisar que existe versão nova, com botão para abrir a página do release.
- Windows sem assinatura: auto-update funciona, mas o SmartScreen avisa na instalação. Documentar no README.
- Nenhum segredo no repositório. Certificados só como GitHub Secrets.

## Foco de revisão

1. Sem internet no boot → checagem de update falha em silêncio (só log), sem toast de erro.
2. Update baixado no Windows/Linux → pergunta `Reiniciar agora` / `Depois`; nunca reinicia sozinho com arquivo não salvo.
3. Tag sem versão correspondente no `package.json` → workflow falha cedo com mensagem clara.
4. Build macOS gera `arm64` e `x64` (Intel ainda existe no time?).
5. AppImage abre em Ubuntu 22.04 sem dependência extra.

---

### Tarefa 1: Workflow de release

**Arquivos:** Criar `.github/workflows/release.yml`, `tools/check-version.js`. Modificar `package.json` (`build.publish`, `build.mac.target` com `arch: [arm64, x64]`)

**Interfaces:**
- `build.publish`: `[{ provider: 'github', owner: 'rodrigoazevedo1988', repo: 'agzos-code', releaseType: 'draft' }]`.
- `tools/check-version.js <tag>`: falha se `tag !== 'v' + package.version`.
- Matriz: `macos-14` → `--mac`, `windows-latest` → `--win`, `ubuntu-22.04` → `--linux`. `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `permissions: contents: write`.
- Release sai como **draft**; Rodrigo revisa e publica.

- [ ] **Passo 1:** implementar; testar com tag `v0.2.0-rc.1` num fork/branch (`package.json` com a mesma versão).
- [ ] **Passo 2:** conferir no draft: `.dmg` e `.zip` (mac arm64 e x64), `.exe` NSIS e portable, `.AppImage`, `.deb`, `.rpm`, `latest*.yml`.
- [ ] **Passo 3:** commit `ci: release multiplataforma por tag`.

---

### Tarefa 2: Auto-update

**Arquivos:** Criar `src/main/updater.js`, `test/unit/updater.test.js`. Modificar `src/main/main.js`, `src/main/preload.js`, menu Ajuda (`Verificar atualizações…`), `src/renderer/scripts/app.js`

**Interfaces:**
- `createUpdater({ autoUpdater, platform, isPackaged, notify }) → { check({ manual: boolean }): Promise<void> }`.
  - Não empacotado → não faz nada.
  - `darwin` → só `checkForUpdates` e, havendo versão nova, `notify('update:available-manual', { version, url })`.
  - Demais → `autoDownload: true`; ao `update-downloaded`, `notify('update:ready', { version })`.
  - Erro de rede: só `console.warn` em checagem automática; toast em checagem manual.
- Checagem 10 s após o boot e a cada 6 h.
- Renderer: toast com botões `Reiniciar agora` / `Depois` (ou `Ver versão` no macOS). `Reiniciar agora` com abas alteradas → confirmar antes.

- [ ] **Passo 1:** testes com `autoUpdater` falso (EventEmitter): ramos darwin, win32, não empacotado, erro silencioso.
- [ ] **Passo 2:** FAIL → implementar → PASS.
- [ ] **Passo 3:** teste real: instalar `v0.2.0-rc.1` no Windows ou Linux, publicar `v0.2.0-rc.2`, ver o update. Registrar no relatório.
- [ ] **Passo 4:** commit `feat: atualização automática`.

---

### Tarefa 3: Privacidade

**Arquivos:** Modificar `src/renderer/index.html` (Configurações → seção Privacidade), `src/renderer/scripts/app.js`, `docs/produto/PRD.md` (seção 6.5 com o texto final)

- Texto fixo: `O Agzos Code não coleta telemetria. Suas chaves de API e tokens ficam no cofre do sistema. Conversas com IA vão direto do seu computador para o provider que você escolheu.`
- Remover o checkbox `Telemetria` (não há telemetria para ligar). Se um dia houver, volta como opt-in.
- Botão `Apagar dados do Agzos Code` → confirma, apaga `settings.json`, `secrets.json`, `chats/` e reinicia.

- [ ] Implementar + E2E do botão (diretório `userData` fica vazio após confirmar). Commit `feat: tela de privacidade`.

---

### Tarefa 4: Preparar assinatura (sem certificados ainda)

**Arquivos:** Criar `docs/tecnico/assinatura.md`. Modificar `.github/workflows/release.yml`

- Workflow lê, se existirem, os secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (macOS) e `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` (Windows). Sem secrets → build sem assinatura, como hoje.
- `build.mac`: `hardenedRuntime: true`, `notarize: true` só quando `APPLE_TEAM_ID` existir (via `-c.mac.notarize=…` no comando).
- `assinatura.md`: passo a passo para o Rodrigo comprar Apple Developer ID (US$ 99/ano) e certificado Windows (Azure Trusted Signing ou OV), e quais secrets cadastrar.

- [ ] Implementar + doc. Commit `ci: assinatura opcional por secrets`.

---

### Tarefa 5: Release v1.0.0 e relatório

- [ ] `package.json` → `1.0.0`; `CHANGELOG.md` com as Fases 1–5.
- [ ] Atualizar `README.md` (download, aviso de app não assinado no macOS: Ajustes do Sistema → Privacidade e Segurança → `Abrir mesmo assim`), `ROADMAP.md`.
- [ ] Relatório `docs/plano/relatorios/fase-5-relatorio.md`, PR. **Não criar a tag `v1.0.0`**: o Rodrigo cria após o merge.

## Critério de saída

Tag `v1.0.0` gera draft com os 3 instaladores; Windows/Linux atualizam sozinhos de `1.0.0` para `1.0.1`; macOS avisa da versão nova.
