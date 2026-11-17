import { HOST, API_KEY } from '../config.mjs';
import { streamLines, wrapTimeoutError } from './stream.mjs';

/** Local Ollama: /api/generate, NDJSON lines each a `{ response: "<token>" }` chunk. */
export async function callOllamaOnce(prompt, model, spinner) {
  try {
    return await streamLines(
      `${HOST}/api/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

/**
 * Ollama Cloud (ollama.com): unlike local Ollama, /api/generate is not
 * usable here — Ollama's own cloud docs only show /api/chat against the
 * cloud host, and /api/generate returns 401 even with a valid key. Same
 * NDJSON streaming shape, but chat-style request/response:
 * `{ message: { role, content } }` instead of `{ response }`.
 */
export async function callOllamaCloudOnce(prompt, model, spinner) {
  try {
    return await streamLines(
      `${HOST}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
          format: 'json',
          options: { temperature: 0.15 },
        }),
      },
      {
        onLine: (line) => {
          if (!line.trim()) return '';
          try {
            const chunk = JSON.parse(line);
            return typeof chunk.message?.content === 'string' ? chunk.message.content : '';
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
