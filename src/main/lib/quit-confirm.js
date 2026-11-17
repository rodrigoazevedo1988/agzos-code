/**
 * Confirmação ao sair (Ctrl+Q / Arquivo › Sair). Sem dependência do Electron.
 *
 * - Sem arquivos não salvos: pergunta "Sair do Agzos Code?" (Sair / Cancelar, padrão
 *   Cancelar) com "Não perguntar novamente", só se window.confirmBeforeQuit !== false.
 * - Com arquivos não salvos (em qualquer janela): uma pergunta só, sempre, avisando
 *   quantos se perdem (Sair sem salvar / Cancelar), sem checkbox.
 *
 * deps: { dialog, parent, getSettings, disableConfirm, countDirty }. Devolve true = sair.
 */

async function confirmQuit({ dialog, parent, getSettings, disableConfirm, countDirty }) {
  let dirty = 0;
  try { dirty = Number(await countDirty()) || 0; } catch { dirty = 0; }
  const ask = getSettings()?.window?.confirmBeforeQuit !== false;
  if (!dirty && !ask) return true;

  const opts = {
    type: 'question',
    title: 'Sair',
    message: 'Sair do Agzos Code?',
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  if (dirty) {
    opts.type = 'warning';
    opts.buttons = ['Sair sem salvar', 'Cancelar'];
    opts.detail = dirty === 1
      ? '1 arquivo com alterações não salvas será perdido.'
      : `${dirty} arquivos com alterações não salvas serão perdidos.`;
  } else {
    opts.buttons = ['Sair', 'Cancelar'];
    opts.checkboxLabel = 'Não perguntar novamente';
    opts.checkboxChecked = false;
  }
  const { response, checkboxChecked } = await dialog.showMessageBox(parent, opts);
  if (response !== 0) return false;
  if (!dirty && checkboxChecked) disableConfirm();
  return true;
}

module.exports = { confirmQuit };
