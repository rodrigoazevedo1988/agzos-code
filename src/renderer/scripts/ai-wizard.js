const KEY_LINKS = {
  openai: 'https://platform.openai.com/api-keys',
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/keys',
  gemini: 'https://aistudio.google.com/app/apikey',
  anthropic: 'https://console.anthropic.com/settings/keys',
};

/** Configura um perfil sem persistir credenciais até a conclusão. */
export async function openAIWizard({ profileId } = {}) {
  const overlay = document.getElementById('ai-wizard-overlay');
  if (!overlay.hidden) return false;
  const [presets, profiles, detected] = await Promise.all([
    window.agzos.ai.presets(), window.agzos.ai.profiles(), window.agzos.ai.detectOllama(),
  ]);
  const existing = profiles.profiles.find((p) => p.id === profileId);
  let draft = existing ? { ...existing } : { preset: 'openai', baseUrl: presets.openai.baseUrl, model: null };
  let key = '';
  let step = 0;
  let models = [];
  let result = '';
  let busy = false;
  const context = { file: true, selection: true, terminal: false, ...window.AgzosState.settings.ai?.context };
  overlay.hidden = false;
  overlay.classList.add('active');

  return new Promise((resolve) => {
    function close(saved) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.innerHTML = '';
      key = '';
      resolve(saved);
    }
    function render() {
      const titles = ['Conheça a IA', 'Escolha um provider', 'Credenciais', 'Escolha um modelo', 'Teste a conexão', 'Contexto', 'Tudo pronto'];
      overlay.innerHTML = `<div class="onb-card ai-wizard-card" role="dialog" aria-modal="true" aria-labelledby="ai-wizard-title">
        <div class="onb-header"><strong>Configurar IA</strong><span>Passo ${step + 1} de 7</span></div>
        <div class="onb-body"><h2 id="ai-wizard-title">${titles[step]}</h2><div class="ai-wizard-content"></div><p class="ai-wizard-result" role="status"></p></div>
        <div class="onb-footer"><button class="onb-secondary ai-cancel">Cancelar</button><div class="onb-nav-left"><button class="onb-secondary ai-back">Voltar</button><button class="onb-primary ai-next">${step === 6 ? 'Concluir' : 'Próximo'}</button></div></div></div>`;
      const content = overlay.querySelector('.ai-wizard-content');
      const next = overlay.querySelector('.ai-next');
      const back = overlay.querySelector('.ai-back');
      const status = overlay.querySelector('.ai-wizard-result');
      status.textContent = result;
      next.disabled = busy;
      back.disabled = busy || step === 0;
      overlay.querySelector('.ai-cancel').disabled = busy;
      overlay.querySelector('.ai-cancel').onclick = () => close(false);
      back.onclick = () => { step = step === 3 && draft.preset === 'ollama' ? 1 : step - 1; result = ''; render(); };
      if (step === 0) content.textContent = 'A IA ajuda a entender e criar código. Sua chave fica no cofre do sistema.';
      if (step === 1) {
        const grid = document.createElement('div'); grid.className = 'ai-provider-grid';
        Object.entries(presets).forEach(([id, preset]) => {
          const button = document.createElement('button'); button.className = `onb-theme-card ${draft.preset === id ? 'selected' : ''}`;
          button.dataset.preset = id; button.textContent = preset.label + (id === 'ollama' && detected ? ' • Detectado' : '');
          button.onclick = () => { draft = { ...(existing?.preset === id ? existing : {}), preset: id, baseUrl: preset.baseUrl, model: null }; key = ''; render(); };
          grid.appendChild(button);
        });
        content.appendChild(grid);
      }
      if (step === 2) {
        if (draft.preset === 'custom') {
          const label = document.createElement('label'); label.textContent = 'URL do endpoint';
          const input = document.createElement('input'); input.id = 'ai-base-url'; input.type = 'url'; input.placeholder = 'https://exemplo.com/v1'; input.value = draft.baseUrl; input.oninput = () => { draft.baseUrl = input.value.trim(); };
          label.appendChild(input); content.appendChild(label);
        }
        const label = document.createElement('label'); label.textContent = draft.preset === 'custom' ? 'Chave de API (opcional)' : 'Chave de API';
        const input = document.createElement('input'); input.id = 'ai-api-key'; input.type = 'password'; input.autocomplete = 'off'; input.value = key; input.placeholder = existing?.id === draft.id ? 'Deixe vazio para manter a chave salva' : 'Chave de API'; input.oninput = () => { key = input.value; };
        label.appendChild(input); content.appendChild(label);
        if (KEY_LINKS[draft.preset]) {
          const link = document.createElement('button'); link.className = 'onb-skip'; link.textContent = 'Onde pego minha chave?'; link.onclick = () => window.agzos.app.openExternal(KEY_LINKS[draft.preset]); content.appendChild(link);
        }
      }
      if (step === 3) {
        const label = document.createElement('label'); label.textContent = 'Modelo';
        const select = document.createElement('select'); select.id = 'ai-model';
        models.forEach((model) => { const option = document.createElement('option'); option.value = model; option.textContent = model; select.appendChild(option); });
        select.value = draft.model || models[0] || ''; draft.model = select.value || null;
        select.onchange = () => { draft.model = select.value; }; label.appendChild(select); content.appendChild(label);
        next.disabled = busy || !models.length;
      }
      if (step === 4) {
        const button = document.createElement('button'); button.className = 'onb-secondary'; button.textContent = 'Testar conexão'; button.disabled = busy;
        button.onclick = async () => { busy = true; result = ''; render(); try { const test = await window.agzos.ai.test(draft, key || undefined); result = test.ok ? `✅ ${test.models} modelos disponíveis` : `❌ ${test.error}`; } catch { result = '❌ Não foi possível testar a conexão.'; } finally { busy = false; render(); } };
        content.appendChild(button);
      }
      if (step === 5) Object.entries({ file: 'Arquivo aberto', selection: 'Seleção', terminal: 'Saída do terminal' }).forEach(([name, text]) => {
        const label = document.createElement('label'); label.className = 'ai-context-option'; const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = context[name]; checkbox.onchange = () => { context[name] = checkbox.checked; }; label.append(checkbox, document.createTextNode(` ${text}`)); content.appendChild(label);
      });
      if (step === 6) content.textContent = 'Ctrl+Shift+A abre o chat. Ctrl+L envia a seleção ao chat.';
      next.onclick = async () => {
        result = '';
        if (step === 2 && !draft.baseUrl) { result = 'Informe a URL do endpoint.'; render(); return; }
        if (step === 2 && presets[draft.preset].needsKey && !key && !draft.id) { result = 'Informe a chave de API.'; render(); return; }
        if (step === 1 && draft.preset !== 'ollama') { step = 2; render(); return; }
        if (step === 2 || (step === 1 && draft.preset === 'ollama')) {
          busy = true; render();
          try {
            const test = await window.agzos.ai.test(draft, key || undefined);
            if (!test.ok) { result = `❌ ${test.error}`; }
            else { models = await window.agzos.ai.models(draft, key || undefined); step = 3; if (!models.length) result = 'Nenhum modelo disponível.'; }
          } catch { result = 'Não foi possível listar os modelos.'; }
          finally { busy = false; render(); }
          return;
        }
        if (step === 6) {
          busy = true; render();
          try {
            await window.agzos.ai.saveProfile(draft, key || undefined);
            const settings = await window.agzos.settings.load(); settings.ai.context = context;
            await window.agzos.settings.save(settings); Object.assign(window.AgzosState.settings, settings);
            const profile = settings.ai.profiles.find((p) => p.id === settings.ai.activeProfileId);
            document.getElementById('status-ai').textContent = profile ? `IA: ${profile.model || profile.label}` : 'IA: off';
            window.dispatchEvent(new CustomEvent('agzos:ai-profiles-changed'));
            close(true);
          } catch { result = 'Não foi possível salvar a configuração.'; busy = false; render(); }
          return;
        }
        step++; render();
      };
    }
    render();
  });
}
