/**
 * AI Chat — UI stub.
 *
 * Este painel é onde o chat de IA vai morar. Hoje ele só mostra
 * mensagens mockadas e oferece um campo de input que não faz nada.
 *
 * A integração real com providers (OpenAI, Anthropic, Groq, OpenRouter,
 * Ollama) é a Fase 1 do roadmap.
 */

import { toast } from './toast.js';

export function setupAI() {
  const host = document.getElementById('ai-mock');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Pergunte algo ao Agzos IA…';
  input.id = 'ai-input';
  input.style.cssText = 'width: 100%; margin-top: 10px; padding: 6px 8px; background: var(--bg-soft3); border: 1px solid var(--line); color: var(--fg); border-radius: 3px; font-size: 12px; outline: none;';

  const send = document.createElement('button');
  send.textContent = 'Enviar';
  send.className = 'primary-btn';
  send.style.cssText = 'margin-top: 6px; font-size: 12px; padding: 6px 12px;';

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSend();
  });
  send.addEventListener('click', doSend);

  host.appendChild(input);
  host.appendChild(send);

  function doSend() {
    const txt = input.value.trim();
    if (!txt) return;
    addMsg(txt, 'user');
    input.value = '';
    // Resposta mock
    setTimeout(() => {
      addMsg(`(stub) Recebido: "${txt.slice(0, 80)}". Para respostas reais, configure um provider em Settings → IA.`, 'assistant');
    }, 400);
  }

  function addMsg(text, who) {
    const el = document.createElement('div');
    el.className = `ai-msg ai-${who}`;
    el.textContent = (who === 'user' ? '👤 ' : '✦ ') + text;
    host.appendChild(el);
    host.scrollTop = host.scrollHeight;
  }
}
