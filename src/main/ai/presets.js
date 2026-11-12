const PRESETS = Object.freeze({
  openai: Object.freeze({ label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, kind: 'openai' }),
  groq: Object.freeze({ label: 'Groq (grátis)', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, kind: 'openai' }),
  openrouter: Object.freeze({ label: 'OpenRouter (tem modelos grátis)', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, kind: 'openai' }),
  gemini: Object.freeze({ label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', needsKey: true, kind: 'openai' }),
  ollama: Object.freeze({ label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', needsKey: false, kind: 'openai' }),
  anthropic: Object.freeze({ label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', needsKey: true, kind: 'anthropic' }),
  custom: Object.freeze({ label: 'Endpoint compatível com OpenAI', baseUrl: '', needsKey: false, kind: 'openai' }),
});

module.exports = { PRESETS };
