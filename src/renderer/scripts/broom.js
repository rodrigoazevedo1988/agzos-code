/**
 * Vassoura de Produção — interface (renderer). Stub da Fase A: registra o card no hub
 * com uma view provisória. O Agente V substitui pelo conteúdo real (comandos, status bar,
 * preview, view do hub, menu de contexto e badges).
 */

import { registerModule } from './modules-hub.js';

export function setupBroom() {
  registerModule({
    id: 'broom',
    label: 'Vassoura de Produção',
    icon: 'brush-cleaning',
    description: 'Remove console.*, comentários, imports não usados e código morto antes do deploy.',
    open(container) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Vassoura de Produção — em construção.';
      container.appendChild(p);
    },
  });
}
