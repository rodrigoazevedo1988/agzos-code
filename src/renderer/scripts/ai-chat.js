/**
 * AI Chat — prévia até a Fase 2.
 *
 * O painel não finge responder: mostra o estado real e explica quando o chat
 * e o wizard de providers chegam. A implementação real é a Fase 2 do roadmap.
 */

export function setupAI() {
  const host = document.getElementById('ai-mock');
  if (!host) return;

  host.replaceChildren();
  const msg = document.createElement('div');
  msg.className = 'ai-msg ai-system';
  msg.textContent = 'Agzos IA chega na Fase 2: wizard de provider, streaming, contexto do editor e aplicar código com diff.';
  host.appendChild(msg);
}
