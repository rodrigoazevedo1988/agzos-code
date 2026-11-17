# Backlog — Agzos Code

Itens pedidos ou identificados que ainda não entraram em uma versão. Cada item diz o
porquê e onde a mudança provavelmente mora.

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
