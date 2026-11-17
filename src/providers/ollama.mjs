import { HOST, PROVIDER, API_KEY } from '../config.mjs';
import { streamLines, wrapTimeoutError } from './stream.mjs';

/**
 * Local Ollama, or Ollama Cloud (ollama.com) when PROVIDER is "ollama-cloud" —
 * same /api/generate NDJSON shape, just a different host and a bearer token.
 */
export async function callOllamaOnce(prompt, model, spinner) {
  const headers = { 'Content-Type': 'application/json' };
  if (PROVIDER === 'ollama-cloud') headers.Authorization = `Bearer ${API_KEY}`;

  try {
    return await streamLines(
      `${HOST}/api/generate`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, prompt, stream: true, format: 'json', options: { temperature: 0.15 } }),
      },
      {
        onLine: (line) => {
          if (!line.trim()) return '';
          try {
            const chunk = JSON.parse(line);
            return typeof chunk.response === 'string' ? chunk.response : '';
          } catch {
            return '';
          }
        },
        onProgress: (full) => {
          if (spinner) spinner.text = `Generating with ${model}... (${full.length} chars received)`;
        },
      }
    );
  } catch (err) {
    throw wrapTimeoutError(err, model);
  }
}
