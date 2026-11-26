import { ALLOWED_TYPES, BREAKING_GITMOJI } from './constants.mjs';

// ---------------------------------------------------------------------------
// Commit header parsing
// ---------------------------------------------------------------------------

const HEADER = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

/**
 * Parses "[emoji ]type(scope)!: description" (the emoji is optional).
 * Returns { emoji, type, scope, bang, description } or null.
 */
export function parseCommitHeader(subject) {
  const s = String(subject ?? '').trim();
  let m = s.match(HEADER);
  let emoji = '';
  if (!m) {
    const withEmoji = s.match(/^(\S+)\s+(.*)$/);
    if (withEmoji) {
      m = withEmoji[2].match(HEADER);
      if (m) emoji = withEmoji[1];
    }
  }
  if (!m) return null;
  return { emoji, type: m[1], scope: m[2] ?? '', bang: Boolean(m[3]), description: m[4].trim() };
}

/** "BREAKING CHANGE: …" footer lines of a commit body. */
export function breakingNotesOf(body = '') {
  return [...String(body).matchAll(/^BREAKING[ -]CHANGE:\s*(.+)$/gim)].map((m) => m[1].trim());
}

/** Breaking = 💥 header, `type!:`, or a BREAKING CHANGE footer. */
export function isBreakingCommit({ subject = '', body = '' }) {
  return Boolean(parseCommitHeader(subject)?.bang) || subject.trimStart().startsWith(BREAKING_GITMOJI) || breakingNotesOf(body).length > 0;
}

/** Normalizes a { sha, subject, body } commit for bump/changelog use. Unknown or unparsable types become "other". */
export function classifyCommit(commit) {
  const header = parseCommitHeader(commit.subject);
  const type = header && ALLOWED_TYPES.has(header.type) ? header.type : 'other';
  return {
    sha: commit.sha ?? '',
    type,
    scope: header?.scope ?? '',
    description: header ? header.description : String(commit.subject ?? '').trim(),
    breaking: isBreakingCommit(commit),
    notes: breakingNotesOf(commit.body),
  };
}

// ---------------------------------------------------------------------------
// Semver bump
// ---------------------------------------------------------------------------

const LEVEL_RANK = { none: 0, patch: 1, minor: 2, major: 3 };
const MINOR_TYPES = new Set(['feat', 'accessibility', 'removal']);
const PATCH_TYPES = new Set(['fix', 'perf', 'security', 'refactor', 'build', 'other']);

/** Bump level a single classified commit calls for. */
export function bumpLevelOf(classified) {
  if (classified.breaking) return 'major';
  if (MINOR_TYPES.has(classified.type)) return 'minor';
  if (PATCH_TYPES.has(classified.type)) return 'patch';
  return 'none'; // docs, style, test, ci, chore
}

/**
 * Highest bump level across commits ({ sha, subject, body }[]) plus the
 * commits that drove it: major for breaking changes, minor for features,
 * patch for fixes and other code changes, none when only docs/test/ci/chore.
 */
export function computeBump(commits) {
  let level = 'none';
  const classified = commits.map((c) => ({ ...classifyCommit(c), level: 'none' }));
  for (const c of classified) {
    c.level = bumpLevelOf(c);
    if (LEVEL_RANK[c.level] > LEVEL_RANK[level]) level = c.level;
  }
  return { level, reasons: level === 'none' ? [] : classified.filter((c) => c.level === level) };
}

/** Splits "v1.2.3" / "1.2.3" into { prefix, version }, or null when it isn't semver-like. */
export function parseVersionTag(tag) {
  const m = String(tag ?? '').match(/^(v?)(\d+\.\d+\.\d+)/);
  return m ? { prefix: m[1], version: m[2] } : null;
}

/** Applies a bump level to "X.Y.Z" (a prerelease/build suffix is dropped). Null for an invalid version. */
export function bumpVersion(version, level) {
  const m = String(version ?? '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  const [major, minor, patch] = m.slice(1).map(Number);
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
  return `${major}.${minor}.${patch}`;
}

// ---------------------------------------------------------------------------
// Changelog
// ---------------------------------------------------------------------------

const SECTIONS = [
  ['feat', '✨ Features'],
  ['fix', '🐛 Bug fixes'],
  ['perf', '⚡ Performance'],
  ['security', '🔒 Security'],
  ['accessibility', '♿ Accessibility'],
  ['removal', '🗑️ Removed'],
  ['refactor', '♻️ Refactoring'],
  ['docs', '📝 Documentation'],
  ['build', '🛠️ Build'],
  ['ci', '👷 CI'],
  ['test', '✅ Tests'],
  ['style', '🎨 Style'],
  ['chore', '🔧 Chores'],
  ['other', 'Other changes'],
];
const HIDDEN_BY_DEFAULT = new Set(['ci', 'test', 'style', 'chore']);

const entry = (c, withSha = true) =>
  `- ${c.scope ? `**${c.scope}:** ` : ''}${c.description}${withSha && c.sha ? ` (${c.sha.slice(0, 7)})` : ''}`;

/**
 * Markdown changelog section for a release: breaking changes first (with their
 * footers), then commits grouped by type. ci/test/style/chore are hidden
 * unless `all`. `version` null renders "[Unreleased]".
 */
export function formatChangelogSection({ version, date, commits, all = false }) {
  const classified = commits.map(classifyCommit);
  const lines = [version ? `## [${version}] - ${date}` : '## [Unreleased]'];

  const breaking = classified.filter((c) => c.breaking);
  if (breaking.length > 0) {
    lines.push('', '### ⚠️ BREAKING CHANGES', '');
    for (const c of breaking) lines.push(c.notes.length > 0 ? `${entry(c, false)} — ${c.notes.join('; ')}` : entry(c, false));
  }

  let shown = breaking.length;
  for (const [type, title] of SECTIONS) {
    if (!all && HIDDEN_BY_DEFAULT.has(type)) continue;
    const group = classified.filter((c) => c.type === type);
    if (group.length === 0) continue;
    lines.push('', `### ${title}`, '', ...group.map((c) => entry(c)));
    shown += group.length;
  }
  if (shown === 0) lines.push('', '_No notable changes._');
  return lines.join('\n');
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CHANGELOG_HEADER = '# Changelog\n\nAll notable changes to this project are documented in this file.\n';

/**
 * Puts `section` into CHANGELOG text: a new file gets a title; an existing
 * section for the same version is replaced; otherwise the section goes above
 * the newest existing release. CRLF files stay CRLF.
 */
export function insertChangelogSection(existing, section) {
  const crlf = typeof existing === 'string' && existing.includes('\r\n');
  const text = (existing ?? '').replace(/\r\n/g, '\n');
  const heading = section.split('\n')[0];

  let result;
  if (!text.trim()) {
    result = `${CHANGELOG_HEADER}\n${section}\n`;
  } else {
    const same = new RegExp(`^${escapeRegExp(heading.replace(/ - .*$/, ''))}(?: - .*)?$`, 'm').exec(text);
    if (same) {
      const start = same.index;
      const next = text.indexOf('\n## ', start + 1);
      result = next === -1 ? `${text.slice(0, start)}${section}\n` : `${text.slice(0, start)}${section}\n\n${text.slice(next + 1)}`;
    } else {
      const firstRelease = text.search(/^## /m);
      result =
        firstRelease === -1
          ? `${text.replace(/\n*$/, '\n')}\n${section}\n`
          : `${text.slice(0, firstRelease)}${section}\n\n${text.slice(firstRelease)}`;
    }
  }
  return crlf ? result.replace(/\n/g, '\r\n') : result;
}

// ---------------------------------------------------------------------------
// Commit-message lint (offline; used by the commit-msg hook)
// ---------------------------------------------------------------------------

/** Auto-generated messages git creates itself; never linted. */
const EXEMPT = /^(Merge |Revert |fixup! |squash! |amend! )/;

/**
 * Rule violations for a commit message (empty = fine). Comment lines (`# …`)
 * are ignored like git does. `rules` (from rules.mjs, all optional):
 * maxSubjectLength, allowedTypes, scopes, requireScope.
 */
export function lintCommitMessage(message, rules = {}) {
  const { maxSubjectLength = 72, allowedTypes = [], scopes = [], requireScope = false } = rules;
  const subject =
    String(message ?? '')
      .split('\n')
      .find((l) => l.trim() && !l.startsWith('#'))
      ?.trim() ?? '';
  if (!subject) return ['The commit message is empty.'];
  if (EXEMPT.test(subject)) return [];

  const issues = [];
  const header = parseCommitHeader(subject);
  if (!header) {
    issues.push('The first line must look like "[emoji ]type(scope): subject", e.g. "✨ feat(cli): add --pr".');
  } else {
    if (!ALLOWED_TYPES.has(header.type)) {
      issues.push(`Unknown type "${header.type}". Use one of: ${[...ALLOWED_TYPES].join(', ')}.`);
    } else if (allowedTypes.length > 0 && !allowedTypes.includes(header.type)) {
      issues.push(`Type "${header.type}" is not allowed in this project. Use one of: ${allowedTypes.join(', ')}.`);
    }
    if (!header.description) issues.push('The subject after the colon is empty.');
    if (scopes.length > 0 && header.scope && !scopes.includes(header.scope.toLowerCase())) {
      issues.push(`Scope "${header.scope}" is not allowed. Use one of: ${scopes.join(', ')}.`);
    }
    if (requireScope && !header.scope) {
      issues.push(`A scope is required: "type(scope): subject"${scopes.length > 0 ? ` with scope one of: ${scopes.join(', ')}` : ''}.`);
    }
  }
  if (subject.length > maxSubjectLength) {
    issues.push(`The first line is ${subject.length} characters; keep it under ${maxSubjectLength}.`);
  }
  return issues;
}
