import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_CONFIG_DIR } from './global-config.mjs';

// Remembered interactive choices (last mode, store preset, languages...).
// A separate file from config.json so it never touches the user's real config
// and is never mistaken for it by cosmiconfig's global search.
export const PREFS_PATH = path.join(GLOBAL_CONFIG_DIR, 'state.json');

export function loadPrefs(file = PREFS_PATH) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Merges `partial` into the saved prefs. Best-effort: remembering a choice must never break a run. */
export function savePrefs(partial, file = PREFS_PATH) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ ...loadPrefs(file), ...partial }, null, 2)}\n`, 'utf8');
  } catch {
    // ignore
  }
}
