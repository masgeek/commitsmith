import fs from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { DEFAULT_HOSTS, DEFAULT_MODELS } from '../config.mjs';

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

  const model = await clack.text({
    message: 'Model to use',
    placeholder: DEFAULT_MODELS[provider],
    defaultValue: DEFAULT_MODELS[provider],
  });
  if (cancelled(model)) return;

  const host = await clack.text({
    message: 'API host',
    placeholder: DEFAULT_HOSTS[provider],
    defaultValue: DEFAULT_HOSTS[provider],
  });
  if (cancelled(host)) return;

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

  let apiKey = '';
  if (provider !== 'ollama') {
    apiKey = await clack.password({
      message: `API key for ${provider} (used only to show you how to set it — never written to disk)`,
    });
    if (cancelled(apiKey)) return;
  }

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
