/**
 * Histórico local e Git Slider (renderer).
 *
 * - Após cada salvamento (`agzos:file-saved`), pede ao main para guardar a versão
 *   salva no histórico local (window.agzos.history.recordSave).
 */

const api = () => window.agzos?.history;

export function setupTimeline() {
  window.addEventListener('agzos:file-saved', (e) => {
    const p = e.detail?.path;
    if (!p) return;
    Promise.resolve(api()?.recordSave(p)).catch((err) => console.warn('[histórico] recordSave', err?.message));
  });
}
