import { inferScope } from './hints.mjs';

/** `git diff --numstat` text → { file, added, deleted, binary }[] (binary files report "-"). */
export function parseNumstat(text) {
  return String(text ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [a, d, ...rest] = line.split('\t');
      const file = rest.join('\t');
      const binary = a === '-' || d === '-';
      return { file, added: binary ? 0 : Number(a) || 0, deleted: binary ? 0 : Number(d) || 0, binary };
    });
}

const LOCK = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|npm-shrinkwrap\.json|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$/;
const GENERATED = /(^|\/)(dist|build|out|coverage|node_modules)\/|\.min\.(js|css)$|\.map$/;
const MANIFEST = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|composer\.json|Gemfile)$/;
const SOURCE = /\.(m?[jt]sx?|py|rb|go|rs|java|kt|cs|php|swift|c|cc|cpp|h|hpp|vue|svelte)$/;

export const LIMITS = { files: 25, lines: 800, areas: 4 };

/**
 * Sanity checks on what is about to be committed as ONE commit. Returns
 * advisory strings (empty = looks like a single change): too big, mixes many
 * unrelated areas, includes generated output, a lockfile without its manifest,
 * or binary files. Never blocks anything.
 */
export function analyzeStaged(entries, { workspaceRoots = [], limits = LIMITS } = {}) {
  const warnings = [];
  if (entries.length === 0) return warnings;

  const lines = entries.reduce((n, e) => n + e.added + e.deleted, 0);
  const files = entries.map((e) => e.file);
  const relevant = entries.filter((e) => !LOCK.test(e.file));

  if (entries.length > limits.files || lines > limits.lines) {
    warnings.push(
      `Large change: ${entries.length} file(s), ${lines} changed lines. One message will be vague — try --group (related files together) or --split.`
    );
  }

  const areas = new Set();
  for (const e of relevant) {
    const a = inferScope([e.file], { workspaceRoots });
    if (a) areas.add(a);
  }
  if (areas.size >= limits.areas) {
    warnings.push(`Touches ${areas.size} unrelated areas (${[...areas].slice(0, 5).join(', ')}${areas.size > 5 ? ', …' : ''}). Consider --group to commit them separately.`);
  }

  const generated = files.filter((f) => GENERATED.test(f));
  if (generated.length > 0) {
    warnings.push(`Looks like generated output is staged: ${generated.slice(0, 3).join(', ')}${generated.length > 3 ? `, +${generated.length - 3} more` : ''}.`);
  }

  const lock = files.filter((f) => LOCK.test(f));
  if (lock.length > 0 && !files.some((f) => MANIFEST.test(f)) && files.some((f) => SOURCE.test(f))) {
    warnings.push(`${lock[0]} changed alongside source code but no dependency manifest did — was that lockfile change intended?`);
  }

  const binary = entries.filter((e) => e.binary).map((e) => e.file);
  if (binary.length > 0) {
    warnings.push(`Binary file(s) staged (the model can't read them): ${binary.slice(0, 3).join(', ')}${binary.length > 3 ? ', …' : ''}.`);
  }
  return warnings;
}
