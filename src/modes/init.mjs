import fs from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import * as clack from '@clack/prompts';
import { DEFAULT_HOSTS, DEFAULT_MODELS } from '../config.mjs';
import { listModelsFor } from '../providers/list-models.mjs';
import { setApiKeySecret } from '../secrets.mjs';

// Matches exactly what cosmiconfig's searchStrategy: 'global' checks as a
// last-resort fallback (see config.mjs) — writing anywhere else here would
// silently never be found.
const GLOBAL_CONFIG_DIR = envPaths('oco-lite', { suffix: '' }).config;
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'config.json');

const CUSTOM_MODEL = '__custom__';

const PROVIDER_OPTIONS = [
  { value: 'ollama', label: 'Ollama (local)', hint: 'default, no API key, needs `ollama serve` running' },
  { value: 'ollama-cloud', label: 'Ollama Cloud', hint: 'ollama.com — requires an API key' },
  { value: 'openai', label: 'OpenAI', hint: 'or any OpenAI-compatible endpoint (Groq, Together, OpenRouter, ...)' },
  { value: 'anthropic', label: 'Anthropic', hint: 'requires an API key' },
];

function cancelled(value) {
  if (clack.isCancel(value)) {
    clack.cancel('Setup cancelled. Nothing was written.');
    return true;
  }
  return false;
}

/** Asks which model to use, offering a live-fetched list when one's available, else a free-text fallback. */
async function promptForModel(provider, host, apiKey) {
  const s = clack.spinner();
  s.start('Fetching available models...');

  let models = [];
  try {
    models = await listModelsFor(provider, host, apiKey);
    s.stop(models.length > 0 ? `Found ${models.length} model(s).` : 'No models found.');
  } catch (err) {
    s.stop('Could not fetch models automatically.');
    clack.log.warn(`${err.message} — you can still type a model name manually.`);
  }

  if (models.length === 0) {
    return clack.text({
      message: 'Model to use',
      placeholder: DEFAULT_MODELS[provider],
      defaultValue: DEFAULT_MODELS[provider],
    });
  }

  const choice = await clack.select({
    message: 'Model to use',
    options: [...models.map((m) => ({ value: m, label: m })), { value: CUSTOM_MODEL, label: 'Other (type manually)' }],
    initialValue: models.includes(DEFAULT_MODELS[provider]) ? DEFAULT_MODELS[provider] : models[0],
  });
  if (cancelled(choice)) return choice;
  if (choice !== CUSTOM_MODEL) return choice;

  return clack.text({
    message: 'Model name',
    placeholder: DEFAULT_MODELS[provider],
    defaultValue: DEFAULT_MODELS[provider],
  });
}

/**
 * Interactive setup: asks for provider/model/host/preferences and writes
 * either a project-local .oco-literc.json or a global one in the OS-standard
 * per-user config directory (see GLOBAL_CONFIG_PATH) — cosmiconfig's
 * searchStrategy: 'global' (see config.mjs) checks that directory as a
 * fallback for every project that doesn't have its own config. The
 * project-local file never stores an API key, since it's meant to be
 * shared/committed; the global file may, opt-in, since it's private to the
 * user. Safe to run before Ollama is reachable or outside a git repo.
 */
export async function runInitMode() {
  clack.intro('oco-lite init');

  const provider = await clack.select({
    message: 'Which provider do you want to use?',
    options: PROVIDER_OPTIONS,
    initialValue: 'ollama',
  });
  if (cancelled(provider)) return;

  if (provider !== 'ollama' && process.env.OCOLITE_API_KEY) {
    clack.log.warn(
      `OCOLITE_API_KEY is already set in your environment — it will override whatever key you configure ` +
        `here (env var always wins over the keychain or a config file). If that's not what you want, unset it first.`
    );
  }

  const host = await clack.text({
    message: 'API host',
    placeholder: DEFAULT_HOSTS[provider],
    defaultValue: DEFAULT_HOSTS[provider],
  });
  if (cancelled(host)) return;

  let apiKey = '';
  if (provider !== 'ollama') {
    apiKey = await clack.password({
      message: `API key for ${provider} (used to list models and show you how to set it — never written to disk)`,
      validate: (value) => (!value ? 'An API key is required for this provider.' : undefined),
    });
    if (cancelled(apiKey)) return;
  }

  const model = await promptForModel(provider, host || DEFAULT_HOSTS[provider], apiKey);
  if (cancelled(model)) return;

  const breakingDetection = await clack.confirm({
    message: 'Enable breaking-change detection?',
    initialValue: true,
  });
  if (cancelled(breakingDetection)) return;

  const fallbackRaw = await clack.text({
    message: 'Fallback models to retry with on failure (comma-separated, optional)',
    placeholder: 'leave blank for none',
    defaultValue: '',
  });
  if (cancelled(fallbackRaw)) return;

  const config = {
    provider,
    model: model || DEFAULT_MODELS[provider],
    host: host || DEFAULT_HOSTS[provider],
    breakingDetection,
  };

  const fallbackModels = fallbackRaw
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  if (fallbackModels.length > 0) config.fallbackModels = fallbackModels;

  const scope = await clack.select({
    message: 'Where should this be saved?',
    options: [
      { value: 'project', label: 'This project only', hint: `./.oco-literc.json — safe to commit/share` },
      {
        value: 'global',
        label: 'Your user profile (global)',
        hint: `${GLOBAL_CONFIG_PATH} — used when a project has no config of its own`,
      },
    ],
    initialValue: 'project',
  });
  if (cancelled(scope)) return;

  let keySaveMode = 'none';
  if (apiKey && scope === 'global') {
    keySaveMode = await clack.select({
      message: `How should your ${provider} API key be saved?`,
      options: [
        {
          value: 'keychain',
          label: 'OS keychain (recommended)',
          hint: 'Windows Credential Manager / macOS Keychain / Linux Secret Service',
        },
        { value: 'plaintext', label: 'Plain text in the config file', hint: 'readable by anything with file access' },
        { value: 'none', label: "Don't save it", hint: "you'll set OCOLITE_API_KEY yourself" },
      ],
      initialValue: 'keychain',
    });
    if (cancelled(keySaveMode)) return;
  }

  if (keySaveMode === 'keychain') {
    try {
      await setApiKeySecret(provider, apiKey);
    } catch (err) {
      clack.log.warn(`Could not save to the OS keychain (${err.message}). Falling back to plain text in the config file.`);
      keySaveMode = 'plaintext';
    }
  }
  if (keySaveMode === 'plaintext') {
    config.apiKey = apiKey;
  }

  const configPath = scope === 'global' ? GLOBAL_CONFIG_PATH : path.join(process.cwd(), '.oco-literc.json');

  if (scope === 'global') {
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }

  if (fs.existsSync(configPath)) {
    const overwrite = await clack.confirm({
      message: `${configPath} already exists. Overwrite it?`,
      initialValue: false,
    });
    if (cancelled(overwrite)) return;
    if (!overwrite) {
      clack.outro('Setup cancelled — existing config left untouched.');
      return;
    }
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  if (keySaveMode === 'plaintext') {
    try {
      fs.chmodSync(configPath, 0o600);
    } catch {
      // best-effort — e.g. no-op on Windows, which doesn't honor POSIX mode bits the same way
    }
  }

  const displayPath = scope === 'global' ? configPath : path.relative(process.cwd(), configPath);
  const notes = [
    scope === 'global'
      ? `Wrote ${displayPath} (global — applies to any project without its own config).`
      : `Wrote ${displayPath} — safe to commit, it contains no secrets.`,
  ];

  if (keySaveMode === 'keychain') {
    notes.push('', `Your ${provider} API key is saved in the OS keychain, not in any file.`);
  } else if (keySaveMode === 'plaintext') {
    notes.push(
      '',
      `Your API key is saved in that file, in plain text. Restricted it to owner-only read/write where the OS` +
        ` supports it${process.platform === 'win32' ? ' (Windows does not enforce this the same way — keep this file private)' : ''}.`
    );
  } else if (apiKey) {
    notes.push(
      '',
      `Set your API key before running oco-lite (not stored anywhere):`,
      `  PowerShell:  $env:OCOLITE_API_KEY = "${apiKey}"`,
      `  bash/zsh:    export OCOLITE_API_KEY=${apiKey}`
    );
  }

  clack.note(notes.join('\n'), 'Done');
  clack.outro('Run `oco-lite --help` to see all commands.');
}
