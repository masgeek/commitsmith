export const PROVIDER_OPTIONS = [
  { value: 'ollama', label: 'Ollama (local)', hint: 'default, no API key, needs `ollama serve` running' },
  { value: 'ollama-cloud', label: 'Ollama Cloud', hint: 'ollama.com — requires an API key' },
  { value: 'openai', label: 'OpenAI', hint: 'or any OpenAI-compatible endpoint (Groq, Together, OpenRouter, ...)' },
  { value: 'anthropic', label: 'Anthropic', hint: 'requires an API key' },
];

export const PROVIDER_LABELS = Object.fromEntries(PROVIDER_OPTIONS.map((o) => [o.value, o.label]));
