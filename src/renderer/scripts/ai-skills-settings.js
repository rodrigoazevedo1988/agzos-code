/**
 * Configurações → Agzos IA: lista de skills (modos) e visão do perfil ativo.
 * Montado por settings-modal.js em #ai-skills-host.
 */
import { lucideIcon } from './lucide.js';
import { toast } from './toast.js';

const State = window.AgzosState;
const SOURCE = { builtin: 'embutida', user: 'sua', project: 'do projeto' };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child != null) el.append(child);
  return el;
}
const icon = (name, size = 13) => lucideIcon(name, { size, strokeWidth: 1.75 });

async function openInEditor(file) {
  try {
    const { openFile } = await import('./editor.js');
    await openFile(file);
  } catch (err) {
    toast(`Skill criada em ${file}, mas não abriu no editor: ${err?.message || err}`, 'info');
  }
}

function visionRow() {
  const ai = State.settings.ai || {};
  const profile = (ai.profiles || []).find((p) => p.id === ai.activeProfileId);
  if (!profile) return null;
  const value = profile.vision === true ? 'yes' : profile.vision === false ? 'no' : 'auto';
  const select = h('select', { id: 'ai-vision-select', 'aria-label': 'Visão do perfil ativo' },
    h('option', { value: 'auto', text: 'Automático (tenta e avisa se o modelo recusar)' }),
    h('option', { value: 'yes', text: 'Sim — o modelo aceita imagens' }),
    h('option', { value: 'no', text: 'Não — bloquear imagens neste perfil' }));
  select.value = value;
  select.addEventListener('change', async () => {
    const vision = select.value === 'yes' ? true : select.value === 'no' ? false : 'auto';
    try {
      await window.agzos.ai.saveProfile({ ...profile, vision });
      window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
      toast('Visão do perfil atualizada.', 'success');
    } catch { toast('Não foi possível salvar.', 'error'); }
  });
  return h('div', { class: 'ai-skills-vision' },
    h('label', { for: 'ai-vision-select', text: `Imagens (visão) no perfil "${profile.label}"` }), select);
}

export async function mountSkillsSettings(host) {
  if (!host) return;
  const api = window.agzos?.agent;
  host.replaceChildren(h('p', { class: 'setting-item-desc', text: 'Carregando skills…' }));
  let data = { skills: [], warnings: [] };
  try { data = await api.skills({ root: State.workspaceRoot || null }); } catch { /* lista vazia */ }
  const list = h('ul', { class: 'ai-skills-list' }, (data.skills || []).map((s) => h('li', { class: 'ai-skills-item', 'data-skill': s.id },
    h('span', { class: 'ai-skills-icon' }, icon(s.icon || 'sparkles', 14)),
    h('span', { class: 'ai-skills-text' },
      h('span', { class: 'ai-skills-name' }, h('strong', { text: s.label }),
        h('span', { class: `ai-skills-source is-${s.source}`, text: SOURCE[s.source] || s.source }),
        s.readOnly ? h('span', { class: 'ai-skills-source', text: 'pede OK para escrever' }) : null,
        Array.isArray(s.tools) ? h('span', { class: 'ai-skills-source', text: `${s.tools.length} ferramentas` }) : null),
      h('span', { class: 'ai-skills-desc', text: s.description || '' })),
    s.source !== 'builtin' && s.file ? h('button', { type: 'button', class: 'secondary-btn ai-skills-edit', onclick: () => openInEditor(s.file) }, icon('pencil', 12), h('span', { text: 'Editar' })) : null)));
  const warnings = (data.warnings || []).map((w) => h('li', { class: 'ai-skills-warning' }, icon('triangle-alert', 12), h('span', { text: `${w.file}: ${w.message}` })));
  host.replaceChildren(
    h('p', { class: 'setting-item-desc', text: 'Modos do seletor do composer. Cada skill é um Markdown com frontmatter (id, label, icon, description, tools, readOnly). Skills do usuário ficam na pasta de skills; as do projeto, em .agzos/skills. Mesmo id substitui a embutida.' }),
    list,
    warnings.length ? h('ul', { class: 'ai-skills-warnings' }, warnings) : null,
    h('div', { class: 'ai-profiles-actions' },
      h('button', {
        type: 'button', class: 'primary-btn', id: 'btn-ai-new-skill',
        onclick: async () => {
          const file = await api.newSkill().catch(() => null);
          if (!file) { toast('Não foi possível criar a skill.', 'error'); return; }
          const { closeSettingsModal } = await import('./settings-modal.js');
          closeSettingsModal();
          await openInEditor(file);
        },
      }, h('span', { text: '+ Nova skill' })),
      h('button', {
        type: 'button', class: 'secondary-btn', id: 'btn-ai-open-skills',
        onclick: () => api.openSkillsFolder().catch(() => toast('Não foi possível abrir a pasta.', 'error')),
      }, h('span', { text: 'Abrir pasta de skills' }))),
    visionRow(),
  );
}
