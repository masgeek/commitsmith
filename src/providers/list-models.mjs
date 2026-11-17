/**
 * Live "what models are available" lookups used by `oco-lite init` to offer
 * a real list instead of a hardcoded placeholder. Takes host/apiKey as
 * arguments rather than reading from config.mjs, since init collects them
 * interactively before anything is saved.
 */

async function listOllamaModels(host, apiKey) {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const res = await fetch(`${host}/api/tags`, { headers, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  return (data.models ?? []).map((m) => m.name ?? m.model).filter(Boolean);
}

async function listOpenAiModels(host, apiKey) {
  const res = await fetch(`${host}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  return (data.data ?? [])
    .map((m) => m.id)
    .filter(Boolean)
    .sort();
}

async function listAnthropicModels(host, apiKey) {
  const res = await fetch(`${host}/v1/models`, {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const data = await res.json();
  return (data.data ?? []).map((m) => m.id).filter(Boolean);
}

/** Returns a model-id list for the given provider, or throws if it couldn't be fetched. */
export async function listModelsFor(provider, host, apiKey) {
  if (provider === 'openai') return listOpenAiModels(host, apiKey);
  if (provider === 'anthropic') return listAnthropicModels(host, apiKey);
  return listOllamaModels(host, apiKey); // ollama + ollama-cloud share the NDJSON API shape
}
