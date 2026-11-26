import fs from 'node:fs';
import { cosmiconfig } from 'cosmiconfig';
import { GLOBAL_CONFIG_PATH } from './global-config.mjs';
import { die } from './die.mjs';
import { getApiKeySecret } from './secrets.mjs';

/** Parsed JSON object from a file, or {} when it is missing, unreadable, or not an object. */
export function readJsonObject(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function parseModelList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map((m) => String(m).trim()).filter(Boolean);
}

export const ALLOWED_PROVIDERS = new Set(['ollama', 'ollama-cloud', 'openai', 'anthropic']);

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

let cached;

/**
 * Lazily resolves and memoizes the full config: a cosmiconfig file search
 * plus, for non-ollama providers, an OS-keychain lookup. Deliberately not
 * done at module-evaluation time — that made every importer of this module
 * (directly or transitively) pay for a filesystem search and a
 * permission-prompting keychain read just by being imported, which made
 * unrelated pure functions untestable in isolation. Every caller gets the
 * same cached object after the first resolution in the process.
 *
 * searchStrategy: 'global' makes the search walk up from cwd to the user's
 * home directory (checking .commitsmithrc/.json/.yaml/.js and package.json's
 * "commitsmith" key at every level — not just cwd, which is cosmiconfig's
 * default 'none' strategy), then also check the OS-standard global config
 * directory (e.g. %APPDATA%\commitsmith\Config on Windows, ~/.config/commitsmith
 * on Linux) as a final fallback. This is what makes a project-less global
 * config (written by `commitsmith init`) actually get picked up.
 */
export async function loadConfig() {
  if (cached) return cached;

  const configResult = await cosmiconfig('commitsmith', { searchStrategy: 'global' }).search();
  const fileConfig = configResult?.config ?? {};
  const fileConfigPath = configResult?.filepath ?? null;

  const PROVIDER = (process.env.COMMITSMITH_PROVIDER || fileConfig.provider || 'ollama').toLowerCase();
  if (!ALLOWED_PROVIDERS.has(PROVIDER)) {
    die(`Unknown COMMITSMITH_PROVIDER "${PROVIDER}". Supported: ${[...ALLOWED_PROVIDERS].join(', ')}.`);
  }

  // Precedence: env var > plaintext in a config file > OS keychain. Skipped
  // entirely for local ollama, which never needs a key — avoids an
  // unnecessary (and on macOS, permission-prompting) keychain lookup.
  const API_KEY =
    process.env.COMMITSMITH_API_KEY ||
    fileConfig.apiKey ||
    (PROVIDER !== 'ollama' ? (await getApiKeySecret(PROVIDER)) || '' : '');
  const MODEL = process.env.COMMITSMITH_MODEL || fileConfig.model || DEFAULT_MODELS[PROVIDER];
  const HOST = process.env.COMMITSMITH_HOST || fileConfig.host || DEFAULT_HOSTS[PROVIDER];
  const MAX_DIFF = Number(process.env.COMMITSMITH_MAX_DIFF || fileConfig.maxDiff || 6000);
  const TIMEOUT_MS = Number(process.env.COMMITSMITH_TIMEOUT_MS || fileConfig.timeoutMs || 60000);
  const GROUP_MAX_DIFF_PER_FILE = Number(
    process.env.COMMITSMITH_GROUP_MAX_DIFF_PER_FILE || fileConfig.groupMaxDiffPerFile || 1200
  );
  const FALLBACK_MODELS = parseModelList(process.env.COMMITSMITH_FALLBACK_MODELS || fileConfig.fallbackModels);

  const RELEASE_NOTES_CONTEXT = String(
    process.env.COMMITSMITH_RELEASE_NOTES_CONTEXT || fileConfig.releaseNotesContext || ''
  ).trim();

  // "Open PRs as a bot": a bot token, or a GitHub App (id + private key file + optional installation id).
  // The private key itself is never stored here — only the path to the .pem.
  // cosmiconfig returns only the FIRST config file it finds, so a project
  // .commitsmithrc.json would hide the machine-specific key path that
  // `init github` keeps in the global config. Fall back to the global file for
  // these keys: env var > the found config file > the global config file.
  const globalFile = readJsonObject(GLOBAL_CONFIG_PATH);
  const pick = (key) => fileConfig[key] ?? globalFile[key];
  const GITHUB_BOT = {
    asDefault: /^(1|true|yes)$/i.test(String(process.env.COMMITSMITH_PR_AS_BOT ?? pick('prAsBot') ?? '')),
    token: process.env.COMMITSMITH_GH_TOKEN || '',
    appId: process.env.COMMITSMITH_GH_APP_ID || pick('githubAppId') || '',
    keyPath: process.env.COMMITSMITH_GH_APP_KEY_PATH || pick('githubAppKeyPath') || '',
    installationId: process.env.COMMITSMITH_GH_APP_INSTALLATION_ID || pick('githubAppInstallationId') || '',
  };

  cached = {
    fileConfig,
    fileConfigPath,
    PROVIDER,
    API_KEY,
    MODEL,
    HOST,
    MAX_DIFF,
    TIMEOUT_MS,
    GROUP_MAX_DIFF_PER_FILE,
    FALLBACK_MODELS,
    RELEASE_NOTES_CONTEXT,
    GITHUB_BOT,
  };
  return cached;
}
