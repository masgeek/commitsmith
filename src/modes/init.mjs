import fs from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { DEFAULT_HOSTS, DEFAULT_MODELS } from '../config.mjs';
import { listModelsFor } from '../providers/list-models.mjs';

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
 * Interactive setup: asks for provider/model/host/preferences and writes a
 * project-local .oco-literc.json config file. Never writes an API key to
 * disk — it only prints the right export command for the chosen shell.
 * Safe to run before Ollama is reachable or outside a git repo.
 */
export async function runInitMode() {
  clack.intro('oco-lite init');

  const provider = await clack.select({
    message: 'Which provider do you want to use?',
    options: PROVIDER_OPTIONS,
    initialValue: 'ollama',
  });
  if (cancelled(provider)) return;

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

  const configPath = path.join(process.cwd(), '.oco-literc.json');
  if (fs.existsSync(configPath)) {
    const overwrite = await clack.confirm({
      message: `${path.basename(configPath)} already exists here. Overwrite it?`,
      initialValue: false,
    });
    if (cancelled(overwrite)) return;
    if (!overwrite) {
      clack.outro('Setup cancelled — existing config left untouched.');
      return;
    }
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const notes = [`Wrote ${path.relative(process.cwd(), configPath)} — safe to commit, it contains no secrets.`];

  if (apiKey) {
    notes.push(
      '',
      `Set your API key before running oco-lite (not stored in the config file):`,
      `  PowerShell:  $env:OCOLITE_API_KEY = "${apiKey}"`,
      `  bash/zsh:    export OCOLITE_API_KEY=${apiKey}`
    );
  }

  clack.note(notes.join('\n'), 'Done');
  clack.outro('Run `oco-lite --help` to see all commands.');
}
