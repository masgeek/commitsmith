import { parseCommitHeader } from './conventional.mjs';

// ---------------------------------------------------------------------------
// Style learning: recent commit subjects of this repo, shown to the model
// ---------------------------------------------------------------------------

/** Conventional-looking subjects only (merge commits, "wip", "fix stuff" teach the model nothing), de-duplicated, at most `limit`. */
export function pickStyleExamples(subjects, limit = 10) {
  const seen = new Set();
  const out = [];
  for (const s of subjects) {
    const subject = String(s ?? '').trim();
    if (!subject || seen.has(subject) || !parseCommitHeader(subject)) continue;
    seen.add(subject);
    out.push(subject);
    if (out.length >= limit) break;
  }
  return out;
}

/** Prompt lines showing the repo's recent commit style (empty when there are no examples). */
export function styleLines(examples) {
  if (!examples || examples.length === 0) return [];
  return [
    '- Match the style of this repository\'s recent commits (tone, level of detail, how scopes are named). Never copy a subject:',
    ...examples.map((e) => `    ${e}`),
  ];
}

// ---------------------------------------------------------------------------
// Scope inference from the changed paths
// ---------------------------------------------------------------------------

/** Folders that only organize code; the scope is the thing inside them. */
const GENERIC_DIRS = new Set(['src', 'lib', 'app', 'source', 'test', 'tests', '__tests__', 'spec', 'specs']);
const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock', 'npm-shrinkwrap.json']);

/**
 * Workspace package roots, as folder prefixes ("packages", "apps"), from
 * pnpm-workspace.yaml and package.json "workspaces" patterns such as
 * "packages/*" or "apps/**". Negated patterns are ignored.
 */
export function parseWorkspaceRoots(pnpmYaml = '', packageJsonText = '') {
  const patterns = [];
  const inYaml = String(pnpmYaml).match(/^packages:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
  if (inYaml) {
    for (const line of inYaml[1].split('\n')) {
      const m = line.match(/^[ \t]*-[ \t]*['"]?([^'"#\s]+)['"]?/);
      if (m) patterns.push(m[1]);
    }
  }
  try {
    const ws = JSON.parse(packageJsonText || '{}')?.workspaces;
    const list = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];
    patterns.push(...list.filter((p) => typeof p === 'string'));
  } catch {
    // not JSON: no workspaces
  }
  const roots = new Set();
  for (const p of patterns) {
    if (p.startsWith('!')) continue;
    const m = p.replace(/^\.\//, '').match(/^([^*]+?)\/\*{1,2}\/?$/);
    if (m) roots.add(m[1]);
  }
  return [...roots];
}

const stem = (name) => name.replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '').toLowerCase();

/** The scope one path suggests, or null (lockfiles carry no signal). */
function scopeOfPath(file, workspaceRoots) {
  const parts = file.split('/').filter(Boolean);
  if (parts.length === 0 || LOCKFILES.has(parts[parts.length - 1])) return null;

  for (const root of workspaceRoots) {
    const prefix = root.split('/');
    if (parts.length > prefix.length + 1 && prefix.every((seg, i) => parts[i] === seg)) {
      return parts[prefix.length].replace(/^@/, '').toLowerCase();
    }
  }

  let i = 0;
  while (i < parts.length - 1 && GENERIC_DIRS.has(parts[i].toLowerCase())) i++;
  if (i < parts.length - 1) return parts[i].replace(/^\./, '').toLowerCase(); // a folder: its name
  return stem(parts[parts.length - 1]).replace(/^\./, '') || null; // a file: its stem
}

/**
 * One scope for a set of changed files when they all point at the same one
 * (a workspace package, a folder under src/, or a single file's stem), else
 * null. With `allowedScopes` the suggestion must be on that list.
 */
export function inferScope(files, { workspaceRoots = [], allowedScopes = [] } = {}) {
  const scopes = new Set();
  for (const f of files) {
    const s = scopeOfPath(String(f).replace(/\\/g, '/'), workspaceRoots);
    if (s) scopes.add(s);
  }
  if (scopes.size !== 1) return null;
  const [scope] = scopes;
  return allowedScopes.length === 0 || allowedScopes.includes(scope) ? scope : null;
}

/** Prompt line for the inferred scope (empty when none). */
export function scopeLines(scope) {
  return scope ? [`- The changed paths all point at the scope "${scope}"; use it unless the change clearly belongs elsewhere.`] : [];
}
