import path from 'node:path';
import envPaths from 'env-paths';

// Matches exactly what cosmiconfig's searchStrategy: 'global' checks as a
// last-resort fallback (see config.mjs) — writing anywhere else would
// silently never be found.
export const GLOBAL_CONFIG_DIR = envPaths('oco-lite', { suffix: '' }).config;
export const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, 'config.json');
