/**
 * Arrastar arquivos do SO para a janela: abre cada um pelo mesmo roteamento do
 * editor (texto, imagem, PDF…). Também impede o padrão do Chromium de navegar
 * a janela para file:// ao soltar um arquivo.
 */

import { toast } from '../toast.js';

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

export function setupFileDrop(openFile) {
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, true);
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const files = [...(e.dataTransfer.files || [])];
    let skipped = 0;
    for (const f of files) {
      const res = await window.agzos.fs.allowDropped(f);
      if (res?.path) await openFile(res.path);
      else skipped++;
    }
    if (skipped) toast(skipped === 1 ? 'Pastas não são abertas por arrastar; use Abrir Pasta.' : `${skipped} itens ignorados (pastas).`, 'info');
  }, true);
}
