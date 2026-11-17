import * as clack from '@clack/prompts';
import { DEFAULT_MODELS } from './config.mjs';
import { listModelsFor } from './providers/list-models.mjs';

const CUSTOM_MODEL = '__custom__';

/** Shared cancel handling for `oco-lite init`/`use` — call after every clack prompt. */
export function cancelled(value) {
  if (clack.isCancel(value)) {
    clack.cancel('Setup cancelled. Nothing was written.');
    return true;
  }
  return false;
}

/** Asks which model to use, offering a live-fetched list when one's available, else a free-text fallback. */
export async function promptForModel(provider, host, apiKey) {
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
