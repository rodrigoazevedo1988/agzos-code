# Backlog — Agzos Code

Itens conhecidos e ainda não agendados. Tamanho: **P** (até 1 dia), **M** (2–4 dias), **G** (1 semana ou mais).

## Visualizadores — Em breve

Entrega atual (v1.1.0): imagens comuns, vídeo/áudio nativos do Chromium, PDF embutido, CSV/TSV em tabela,
pré-visualização de Markdown e telas de fallback ("Abrir no app padrão" / "Revelar na pasta").

- **DOCX renderizado** — `docx-preview` (Apache-2.0) ou `mammoth` (BSD-2) para ler .docx na aba. **M**
- **XLSX/XLS/ODS renderizados** — SheetJS Community (Apache-2.0, via cdn.sheetjs.com; a versão do npm tem CVEs) com abas de planilha. **M**
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
- **CSV grande com rolagem virtual** — hoje mostra até 5000 linhas e limite de 5 MB de leitura. **P**
- **Soltar pasta do SO abre workspace** — hoje só arquivos são abertos ao arrastar. **P**
