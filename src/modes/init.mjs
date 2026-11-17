import fs from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { DEFAULT_HOSTS, DEFAULT_MODELS } from '../config.mjs';
import { setApiKeySecret } from '../secrets.mjs';
import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from '../global-config.mjs';
import { PROVIDER_OPTIONS } from '../provider-options.mjs';
import { cancelled, promptForModel } from '../wizard-ui.mjs';

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
