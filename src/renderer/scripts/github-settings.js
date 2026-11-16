/**
 * Configurações → Git & GitHub: contas por PAT (adicionar, remover, padrão)
 * e conta do repositório aberto. Montado por settings-modal.js em
 * #github-settings-host. O token só vai para o main (github:addPat).
 */

import { toast } from './toast.js';
import { confirmGit } from './git-dialog.js';
import { github } from './git-api.js';

const State = window.AgzosState;
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:user&description=Agzos%20Code';

function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function avatar(a) {
  const w = h('span', 'gh-avatar');
  if (a.avatarData) {
    const img = h('img');
    img.src = a.avatarData;
    img.alt = '';
    w.append(img);
  } else {
    w.textContent = (a.login || '?').slice(0, 1).toUpperCase();
  }
  return w;
}

export async function mountGithubSettings(host) {
  if (!host) return;
  host.replaceChildren(h('p', 'hint', 'Carregando contas…'));
  let list;
  try {
    list = await github.accounts();
  } catch (e) {
    host.replaceChildren(h('p', 'gh-error', e.message));
    return;
  }
  State.settings.github = { ...(State.settings.github || {}), ...list };
  let repo = null;
  if (State.workspaceRoot) {
    try { repo = await github.accountForCwd(State.workspaceRoot); } catch { repo = null; }
  }
  render(host, list, repo);
}

function render(host, list, repo) {
  host.replaceChildren();
  const card = h('div', 'gh-settings');

  // Contas
  const accountsBox = h('div', 'gh-accounts');
  accountsBox.id = 'gh-accounts';
  if (!list.accounts.length) {
    accountsBox.append(h('p', 'gh-empty', 'Nenhuma conta conectada. Adicione um token para fazer push, publicar repositórios e abrir Pull Requests.'));
  }
  for (const a of list.accounts) {
    const row = h('div', 'gh-account');
    row.dataset.id = a.id;
    const info = h('div', 'gh-account-info');
    const name = h('strong', 'gh-account-login', `@${a.login}`);
    info.append(name);
    if (a.name && a.name !== a.login) info.append(h('span', 'gh-account-name', a.name));
    const isDefault = list.defaultAccountId === a.id;
    const actions = h('div', 'gh-account-actions');
    if (isDefault) {
      actions.append(h('span', 'gh-badge', 'Padrão'));
    } else {
      const def = h('button', 'secondary-btn gh-btn', 'Tornar padrão');
      def.type = 'button';
      def.addEventListener('click', async () => {
        try { render(host, await github.setDefault(a.id), repo); } catch (e) { toast(e.message, 'error'); }
      });
      actions.append(def);
    }
    const rm = h('button', 'secondary-btn gh-btn gh-remove', 'Remover');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Remover conta ${a.login}`);
    rm.addEventListener('click', async () => {
      const okay = await confirmGit({ title: `Remover @${a.login}?`, message: 'O token será apagado do cofre do sistema.', confirmLabel: 'Remover', danger: true });
      if (!okay) return;
      try {
        const next = await github.remove(a.id);
        State.settings.github = { ...(State.settings.github || {}), ...next };
        render(host, next, repo && repo.account?.id === a.id ? { ...repo, account: null } : repo);
        toast(`Conta @${a.login} removida.`, 'success', 1800);
      } catch (e) { toast(e.message, 'error'); }
    });
    actions.append(rm);
    row.append(avatar(a), info, actions);
    accountsBox.append(row);
  }
  card.append(accountsBox);

  // Adicionar por PAT
  const form = h('form', 'gh-add');
  form.id = 'gh-add-form';
  const label = h('label', 'gh-label', 'Adicionar conta com token (PAT)');
  label.htmlFor = 'gh-token-input';
  const rowForm = h('div', 'gh-add-row');
  const input = h('input', 'settings-control-input gh-token');
  input.id = 'gh-token-input';
  input.type = 'password';
  input.placeholder = 'ghp_… ou github_pat_…';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const add = h('button', 'primary-btn gh-add-btn', 'Adicionar conta');
  add.type = 'submit';
  rowForm.append(input, add);
  const hint = h('small', 'gh-hint');
  const link = h('a', null, 'Criar token no GitHub');
  link.href = '#';
  link.addEventListener('click', (e) => { e.preventDefault(); window.agzos.app.openExternal(TOKEN_URL); });
  hint.append('Escopos: repo e read:user. O token fica no cofre do sistema, nunca no settings.json. ', link);
  const err = h('p', 'gh-error');
  err.hidden = true;
  err.setAttribute('role', 'alert');
  form.append(label, rowForm, hint, err);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = input.value.trim();
    if (!token) { input.focus(); return; }
    add.disabled = true;
    add.textContent = 'Validando…';
    err.hidden = true;
    try {
      const res = await github.addPat(token);
      input.value = '';
      State.settings.github = { ...(State.settings.github || {}), accounts: res.accounts, defaultAccountId: res.defaultAccountId, repoAccounts: res.repoAccounts };
      toast(`Conta @${res.account.login} conectada.`, 'success', 2000);
      render(host, res, repo);
      window.dispatchEvent(new CustomEvent('agzos:github-accounts-changed'));
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      add.disabled = false;
      add.textContent = 'Adicionar conta';
    }
  });
  card.append(form);

  // Conta do repositório atual
  if (repo?.remoteKey && list.accounts.length) {
    const box = h('div', 'gh-repo');
    const title = h('div', 'gh-label', `Conta para ${repo.github.owner}/${repo.github.repo}`);
    const sel = h('select', 'settings-control-select');
    sel.id = 'gh-repo-account';
    const mapped = list.repoAccounts?.[repo.remoteKey] || '';
    const opts = [{ value: '', label: `Automática${repo.account && !mapped ? ` (@${repo.account.login})` : ''}` },
      ...list.accounts.map((a) => ({ value: a.id, label: `@${a.login}` }))];
    for (const o of opts) {
      const opt = h('option', null, o.label);
      opt.value = o.value;
      if (o.value === mapped) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener('change', async () => {
      try {
        const next = await github.assign(State.workspaceRoot, sel.value || null);
        State.settings.github = { ...(State.settings.github || {}), ...next };
        toast('Conta do repositório atualizada.', 'success', 1500);
        window.dispatchEvent(new CustomEvent('agzos:github-accounts-changed'));
      } catch (e) { toast(e.message, 'error'); }
    });
    box.append(title, sel, h('small', 'gh-hint', 'Usada em push, pull e Pull Requests deste repositório.'));
    card.append(box);
  }

  host.append(card);
}
