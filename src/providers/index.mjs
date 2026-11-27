import ora from 'ora';
import { loadConfig } from '../config.mjs';
import { die } from '../die.mjs';
import { guardPrompt } from '../secret-guard.mjs';
import { noSecretGuard } from '../cli-args.mjs';
import { callOllamaOnce, callOllamaCloudOnce } from './ollama.mjs';
import { callOpenAiOnce } from './openai.mjs';
import { callAnthropicOnce } from './anthropic.mjs';

async function callModelOnce(prompt, model, spinner) {
  const { PROVIDER } = await loadConfig();
  if (PROVIDER === 'openai') return callOpenAiOnce(prompt, model, spinner);
  if (PROVIDER === 'anthropic') return callAnthropicOnce(prompt, model, spinner);
  if (PROVIDER === 'ollama-cloud') return callOllamaCloudOnce(prompt, model, spinner);
  return callOllamaOnce(prompt, model, spinner);
}

/**
 * Calls the configured provider with live streaming progress, trying
 * COMMITSMITH_FALLBACK_MODELS (in order, same provider) if the primary model
 * fails or times out.
 */
export async function callModel(rawPrompt, label = 'response') {
  const { MODEL, FALLBACK_MODELS, SECRET_GUARD } = await loadConfig();
  // Every model request passes through here, so this is the one place secrets are kept out of prompts.
  const { prompt } = guardPrompt(rawPrompt, noSecretGuard ? 'off' : SECRET_GUARD);
  const modelsToTry = [MODEL, ...FALLBACK_MODELS];
  const spinner = ora(`Generating ${label} with ${MODEL}...`).start();

  let lastErr;
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    if (i > 0) spinner.start(`Retrying ${label} with fallback model "${model}"...`);
    try {
      const result = await callModelOnce(prompt, model, spinner);
      spinner.succeed(`Generated ${label} with ${model}.`);
      return result;
    } catch (err) {
      lastErr = err;
      spinner.fail(`"${model}" failed: ${err.message}`);
    }
  }
  throw lastErr;
}

/**
 * Checks the configured provider without exiting: { ok: true } or
 * { ok: false, message }. Cloud providers (openai, anthropic) only need an
 * API key here; Ollama and Ollama Cloud are probed over the network.
 */
export async function probeProvider() {
  const { PROVIDER, API_KEY, HOST } = await loadConfig();

  if (PROVIDER === 'openai' || PROVIDER === 'anthropic') {
    return API_KEY
      ? { ok: true }
      : {
          ok: false,
          message:
            `COMMITSMITH_API_KEY (or config "apiKey") is required for provider "${PROVIDER}".\n` +
            `Set COMMITSMITH_PROVIDER=ollama to use a local Ollama model instead.`,
        };
  }

  if (PROVIDER === 'ollama-cloud' && !API_KEY) {
    return {
      ok: false,
      message:
        `COMMITSMITH_API_KEY (or config "apiKey") is required for provider "ollama-cloud".\n` +
        `Get one from https://ollama.com/settings/keys.`,
    };
  }

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const headers = PROVIDER === 'ollama-cloud' ? { Authorization: `Bearer ${API_KEY}` } : {};
    const res = await fetch(`${HOST}/api/tags`, { signal: controller.signal, headers });
    clearTimeout(t);
    if (!res.ok) throw new Error(`status ${res.status}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message:
        PROVIDER === 'ollama-cloud'
          ? `Cannot reach Ollama Cloud at ${HOST} (${err.message || err}). Check COMMITSMITH_API_KEY and your network connection.`
          : `Cannot reach Ollama at ${HOST} (${err.message || err}).\n` +
            `Is it running? Try: ollama serve\n` +
            `Or set COMMITSMITH_HOST if it's on a different address, or COMMITSMITH_PROVIDER=openai/anthropic/ollama-cloud to use a cloud provider instead.`,
    };
  }
}

export async function assertProviderReachable() {
  const result = await probeProvider();
  if (!result.ok) die(result.message);
}
