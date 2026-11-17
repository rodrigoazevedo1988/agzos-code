/**
 * Cofre .env — interface (renderer). Stub da Fase A: registra o card no hub com uma
 * view provisória. O Agente C substitui pelo conteúdo real.
 */

import { registerModule } from './modules-hub.js';

export function setupEnvVault() {
  registerModule({
    id: 'envVault',
    label: 'Cofre .env',
    icon: 'key-round',
    description: 'Veja e edite .env com valores mascarados e bloqueie commits com segredos.',
    open(container) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Cofre .env — em construção.';
      container.appendChild(p);
    },
  });
}
