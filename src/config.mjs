import { cosmiconfig } from 'cosmiconfig';
import { die } from './die.mjs';

function parseModelList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map((m) => String(m).trim()).filter(Boolean);
}

const configResult = await cosmiconfig('oco-lite').search();
export const fileConfig = configResult?.config ?? {};

export const ALLOWED_PROVIDERS = new Set(['ollama', 'ollama-cloud', 'openai', 'anthropic']);
export const PROVIDER = (process.env.OCOLITE_PROVIDER || fileConfig.provider || 'ollama').toLowerCase();
if (!ALLOWED_PROVIDERS.has(PROVIDER)) {
  die(`Unknown OCOLITE_PROVIDER "${PROVIDER}". Supported: ${[...ALLOWED_PROVIDERS].join(', ')}.`);
}

const DEFAULT_HOSTS = {
  ollama: 'http://localhost:11434',
  'ollama-cloud': 'https://ollama.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

const DEFAULT_MODELS = {
  ollama: 'qwen2.5-coder:7b',
  'ollama-cloud': 'qwen3-coder:480b-cloud',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-5-5',
};

export const API_KEY = process.env.OCOLITE_API_KEY || fileConfig.apiKey || '';
export const MODEL = process.env.OCOLITE_MODEL || fileConfig.model || DEFAULT_MODELS[PROVIDER];
export const HOST = process.env.OCOLITE_HOST || fileConfig.host || DEFAULT_HOSTS[PROVIDER];
export const MAX_DIFF = Number(process.env.OCOLITE_MAX_DIFF || fileConfig.maxDiff || 6000);
export const TIMEOUT_MS = Number(process.env.OCOLITE_TIMEOUT_MS || fileConfig.timeoutMs || 60000);
export const GROUP_MAX_DIFF_PER_FILE = Number(
  process.env.OCOLITE_GROUP_MAX_DIFF_PER_FILE || fileConfig.groupMaxDiffPerFile || 1200
);
export const FALLBACK_MODELS = parseModelList(process.env.OCOLITE_FALLBACK_MODELS || fileConfig.fallbackModels);
