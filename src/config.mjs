import { cosmiconfig } from 'cosmiconfig';
import { die } from './die.mjs';
import { getApiKeySecret } from './secrets.mjs';

function parseModelList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map((m) => String(m).trim()).filter(Boolean);
}

// searchStrategy: 'global' makes the search walk up from cwd to the user's
// home directory (checking .oco-literc/.json/.yaml/.js and package.json's
// "oco-lite" key at every level — not just cwd, which is cosmiconfig's
// default 'none' strategy), then also check the OS-standard global config
// directory (e.g. %APPDATA%\oco-lite\Config on Windows, ~/.config/oco-lite
// on Linux) as a final fallback. This is what makes a project-less global
// config (written by `oco-lite init`) actually get picked up.
const configResult = await cosmiconfig('oco-lite', { searchStrategy: 'global' }).search();
export const fileConfig = configResult?.config ?? {};
export const fileConfigPath = configResult?.filepath ?? null;

export const ALLOWED_PROVIDERS = new Set(['ollama', 'ollama-cloud', 'openai', 'anthropic']);
export const PROVIDER = (process.env.OCOLITE_PROVIDER || fileConfig.provider || 'ollama').toLowerCase();
if (!ALLOWED_PROVIDERS.has(PROVIDER)) {
  die(`Unknown OCOLITE_PROVIDER "${PROVIDER}". Supported: ${[...ALLOWED_PROVIDERS].join(', ')}.`);
}

export const DEFAULT_HOSTS = {
  ollama: 'http://localhost:11434',
  'ollama-cloud': 'https://ollama.com',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

export const DEFAULT_MODELS = {
  ollama: 'qwen2.5-coder:7b',
  'ollama-cloud': 'qwen3-coder:480b-cloud',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-5-5',
};

// Precedence: env var > plaintext in a config file > OS keychain. Skipped
// entirely for local ollama, which never needs a key — avoids an
// unnecessary (and on macOS, permission-prompting) keychain lookup.
export const API_KEY =
  process.env.OCOLITE_API_KEY ||
  fileConfig.apiKey ||
  (PROVIDER !== 'ollama' ? (await getApiKeySecret(PROVIDER)) || '' : '');
export const MODEL = process.env.OCOLITE_MODEL || fileConfig.model || DEFAULT_MODELS[PROVIDER];
export const HOST = process.env.OCOLITE_HOST || fileConfig.host || DEFAULT_HOSTS[PROVIDER];
export const MAX_DIFF = Number(process.env.OCOLITE_MAX_DIFF || fileConfig.maxDiff || 6000);
export const TIMEOUT_MS = Number(process.env.OCOLITE_TIMEOUT_MS || fileConfig.timeoutMs || 60000);
export const GROUP_MAX_DIFF_PER_FILE = Number(
  process.env.OCOLITE_GROUP_MAX_DIFF_PER_FILE || fileConfig.groupMaxDiffPerFile || 1200
);
export const FALLBACK_MODELS = parseModelList(process.env.OCOLITE_FALLBACK_MODELS || fileConfig.fallbackModels);
