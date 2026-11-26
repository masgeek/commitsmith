import fs from 'node:fs';
import { cosmiconfig } from 'cosmiconfig';
import { ALLOWED_TYPES } from './constants.mjs';
import { GLOBAL_CONFIG_PATH } from './global-config.mjs';

// (config.mjs imports this module, so the tiny JSON reader lives here rather than being imported back.)
function readGlobalConfig() {
  try {
    const value = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export const DEFAULT_RULES = Object.freeze({
  scopes: [],
  requireScope: false,
  maxSubjectLength: 72,
  allowedTypes: [],
  gitmoji: true,
});

/**
 * Validates the `commitRules` config object. Returns { rules, warnings }:
 * bad values fall back to the defaults and are reported, never thrown, so a
 * typo in config can't break a commit.
 *   scopes            allowed scopes (empty = any)
 *   requireScope      every message must have a scope
 *   maxSubjectLength  20–200 (default 72)
 *   allowedTypes      restrict commit types (empty = all)
 *   gitmoji           false → "type(scope): subject" without the leading emoji
 */
export function normalizeRules(raw) {
  const rules = { ...DEFAULT_RULES, scopes: [], allowedTypes: [] };
  const warnings = [];
  if (raw === undefined || raw === null) return { rules, warnings };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { rules, warnings: ['"commitRules" must be an object; ignoring it.'] };
  }

  if (raw.scopes !== undefined) {
    if (Array.isArray(raw.scopes) && raw.scopes.every((s) => typeof s === 'string')) {
      rules.scopes = [...new Set(raw.scopes.map((s) => s.trim().toLowerCase()).filter(Boolean))];
    } else {
      warnings.push('"commitRules.scopes" must be an array of strings; ignoring it.');
    }
  }
  if (raw.requireScope !== undefined) {
    if (typeof raw.requireScope === 'boolean') rules.requireScope = raw.requireScope;
    else warnings.push('"commitRules.requireScope" must be true or false; ignoring it.');
  }
  if (raw.maxSubjectLength !== undefined) {
    const n = raw.maxSubjectLength;
    if (Number.isInteger(n) && n >= 20 && n <= 200) rules.maxSubjectLength = n;
    else warnings.push('"commitRules.maxSubjectLength" must be an integer from 20 to 200; using 72.');
  }
  if (raw.allowedTypes !== undefined) {
    if (Array.isArray(raw.allowedTypes) && raw.allowedTypes.every((t) => typeof t === 'string')) {
      const known = raw.allowedTypes.map((t) => t.trim().toLowerCase()).filter((t) => ALLOWED_TYPES.has(t));
      const unknown = raw.allowedTypes.filter((t) => !ALLOWED_TYPES.has(String(t).trim().toLowerCase()));
      if (unknown.length > 0) warnings.push(`"commitRules.allowedTypes" has unknown type(s): ${unknown.join(', ')}.`);
      rules.allowedTypes = [...new Set(known)];
    } else {
      warnings.push('"commitRules.allowedTypes" must be an array of strings; ignoring it.');
    }
  }
  if (raw.gitmoji !== undefined) {
    if (typeof raw.gitmoji === 'boolean') rules.gitmoji = raw.gitmoji;
    else warnings.push('"commitRules.gitmoji" must be true or false; ignoring it.');
  }
  return { rules, warnings };
}

/**
 * Reads `commitRules` straight from the config files — project first, then
 * the global file — without loadConfig(): no keychain, no provider. This is
 * what lets the commit-msg hook enforce rules while staying fast and offline.
 */
export async function loadRulesFromFiles() {
  let fileConfig = {};
  try {
    fileConfig = (await cosmiconfig('commitsmith', { searchStrategy: 'global' }).search())?.config ?? {};
  } catch {
    // an unreadable config must not break a commit
  }
  const raw = fileConfig.commitRules ?? readGlobalConfig().commitRules;
  return normalizeRules(raw).rules;
}

/** Prompt lines that tell the model about the rules (empty when there is nothing to say). */
export function ruleLines(rules) {
  if (!rules) return [];
  const lines = [];
  if (rules.allowedTypes.length > 0) lines.push(`- "type" must be one of: ${rules.allowedTypes.join(', ')}.`);
  if (rules.scopes.length > 0) {
    lines.push(`- "scope" must be one of: ${rules.scopes.join(', ')} (pick the closest; use "" only if none applies).`);
  } else if (rules.requireScope) {
    lines.push('- "scope" is required: a short lowercase module or area name.');
  }
  if (rules.requireScope && rules.scopes.length > 0) lines.push('- "scope" must not be empty.');
  if (rules.maxSubjectLength !== DEFAULT_RULES.maxSubjectLength) {
    lines.push(`- "subject" must be at most ${rules.maxSubjectLength} characters.`);
  }
  return lines;
}
