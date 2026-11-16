# Publicação OTA na VPS

Este runbook prepara releases imutáveis do Agzos Code em `/var/www/agzos-code-releases` e move o symlink `current` para uma versão completa. O endereço público previsto é `https://code.rsolutionsbr.com/release/`. A publicação é local à VPS: o script não faz upload, não apaga releases anteriores e recusa sobrescrever uma versão existente.

## Estado atual do projeto

O `package.json` usa o provider `generic`, o processo principal inicializa `electron-updater` e o feed padrão é `https://code.rsolutionsbr.com/release`. A partir da versão `0.4.0`:
- **Windows (NSIS)** e **Linux (AppImage)** realizam download in-app via `electron-updater` com progresso exibido na UI e confirmação antes da instalação.
- **macOS** realiza atualização in-app automatizada via `mac-ota.js` (baixa o zip do release, valida checksum SHA-512, descompacta com `ditto`, remove quarentena `xattr -cr`, substitui o `.app` atomicamente e reinicia).
- A URL do feed pode ser substituída pela variável de ambiente `AGZOS_UPDATE_URL`.

Os manifestos (`latest.yml`, `latest-linux.yml` e `latest-mac.yml`) devem referenciar arquivos presentes na mesma release. O script `tools/publish-vps-release.js` valida estritamente todas as referências de arquivos contidas nos manifestos antes de permitir a publicação. O vhost específico e o certificado Let's Encrypt de `code.rsolutionsbr.com` foram ativados em 12/11/2026.

## Preparar a rota pública

Não altere a configuração ativa do Nginx até criar e revisar o vhost separado de `code.rsolutionsbr.com` e o certificado TLS correspondente. A rota deverá servir `/var/www/agzos-code-releases/current/` em `/release/`, permitir leitura dos symlinks para `releases/<versão>`, desativar listagem de diretório e evitar cache longo dos manifestos `latest*.yml`. Os instaladores são imutáveis e podem receber cache longo.

Exemplo de mapeamento para incorporar ao vhost novo (não executar como alteração isolada):

```nginx
location = /release {
    return 301 /release/;
}

location ^~ /release/ {
    alias /var/www/agzos-code-releases/current/;
    autoindex off;
    add_header X-Content-Type-Options nosniff always;
    add_header Cache-Control "no-cache" always;
}
```

O Nginx precisa ter permissão de travessia nos diretórios pais e leitura nos arquivos. Depois de instalar o vhost separado, valide a configuração com `nginx -t`, recarregue o serviço conforme o procedimento da VPS e confira que o certificado responde para `code.rsolutionsbr.com`.

## Gerar e reunir os artefatos

1. Gere artefatos de release para cada sistema operacional e arquitetura suportada. A versão do `package.json` deve ser a versão que será publicada.
2. Reúna em um diretório plano os instaladores, arquivos `.blockmap` associados e todos os `latest*.yml` gerados para essa mesma versão. Não misture versões nem edite manifestos depois do build.
3. Confirme que a lista inclui os metadados esperados para as plataformas que terão auto-update. Builds por matriz CI podem gerar os artefatos em runners diferentes; transfira-os para a VPS por um canal autenticado antes de executar o script.

O electron-builder no Linux gera os alvos Linux. Builds Windows podem ser tentados a partir do Linux com Wine, mas dependem do ambiente, dos alvos e de módulos nativos; para releases repetíveis, use runner Windows. Builds macOS não devem ser feitos nesta VPS Linux: assinatura macOS requer macOS e a documentação do electron-builder não recomenda esperar que uma máquina produza todas as plataformas. Use runner macOS para DMG/ZIP e qualquer assinatura/notarização. Consulte [Multi Platform Build do electron-builder](https://www.electron.build/v26/docs/features/multi-platform-build/).

## Publicar uma versão

Execute na VPS, como usuário autorizado a escrever no destino, apontando `--source` para o diretório plano preparado acima:

```bash
cd /var/www/agzos-code
node tools/publish-vps-release.js \
  --source /caminho/seguro/artefatos-release \
  --destination /var/www/agzos-code-releases \
  --version 0.1.0
```

Se `--version` for omitida, o script usa `package.json`. Ele verifica a versão SemVer, recusa symlinks e diretórios no lugar de artefatos, exige ao menos um `latest*.yml` e um instalador reconhecido, calcula SHA-256, grava `SHA256SUMS` e `release-manifest.json`, instala a pasta completa em `releases/<versão>` e atualiza `current` com `rename` atômico. O lock `.publish.lock` impede publicações concorrentes. Releases existentes não são sobrescritas; um lock remanescente após interrupção deve ser investigado antes de qualquer remoção manual.

O diretório de destino deve ser um diretório real, não um symlink. A troca atômica exige que `current` (se existir) seja symlink para uma versão dentro de `releases/`. Faça rollback apontando `current` para uma release anterior somente após confirmar a integridade e compatibilidade dela; não apague versões antigas como parte da publicação.

## Verificar

```bash
readlink /var/www/agzos-code-releases/current
sha256sum -c /var/www/agzos-code-releases/current/SHA256SUMS
curl -fsSI https://code.rsolutionsbr.com/release/latest-linux.yml
```

Confira também os manifestos e instaladores específicos de cada plataforma pelo endpoint HTTPS. O SHA-256 registrado ajuda a detectar cópia incompleta ou corrupção acidental; não substitui assinatura de código, HTTPS nem a validação de integridade usada pelo updater. Não anuncie a versão até que os arquivos e manifestos estejam acessíveis pelo domínio público.

## Limites operacionais

- A publicação atômica muda somente `current`; leitores veem a release anterior ou a nova release completa.
- Releases antigas ficam em `releases/` para permitir rollback e não são removidas pelo script.
- O script só copia arquivos no mesmo host. Ele não instala o vhost, não configura DNS/TLS, não executa builds nem publica um release remoto.
- O primeiro instalador de cada plataforma precisa ser instalado manualmente; as versões posteriores podem usar o OTA.
