import { ruleLines } from './rules.mjs';

/** Prompt fragment for a user's "regenerate with an instruction" feedback. */
function feedbackLines(feedback) {
  return feedback ? ['', `Additional instruction from the user (follow it): ${feedback}`] : [];
}

export function buildPrompt(diff, feedback = '', rules = null) {
  return [
    'You classify a git diff and produce a commit message. Respond with ONLY a JSON object, nothing else — no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{',
    '  "type": one of feat|fix|docs|style|refactor|perf|test|build|ci|chore|security|accessibility|removal,',
    '  "scope": short lowercase scope, e.g. a filename stem or module (use "" if not applicable),',
    '  "subject": imperative, under 72 chars, summarizing the overall intent as ONE change,',
    '  "changes": array of 1-5 short bullet strings, each describing one concrete change made in this diff (function added, logic changed, bug fixed, etc.),',
    '  "breaking": true or false — true only if this diff removes/renames a public function, class, route, config key, env var, or changes a method signature or database schema in a way that could break existing callers or data,',
    '  "breakingChangeIndex": if breaking is true, the 0-based index into "changes" that is the breaking one; otherwise -1,',
    '  "breakingReason": if breaking is true, one short phrase explaining what breaks; otherwise ""',
    '}',
    '',
    'Rules:',
    '- Output ONLY the JSON object. No text before or after it.',
    '- "subject" must describe the diff as a single coherent change, even if it touches multiple methods.',
    '- Each entry in "changes" is a short, concrete bullet point (not a restatement of "subject") — e.g. "extracted validation into validateInput()", "added null check for legacy records".',
    '- "changes" entries must be PLAIN descriptions only — never write literal text like "[BREAKING CHANGE: ...]" inside a "changes" string. That annotation is added separately by the caller from "breakingReason"; your job is only to point at the right bullet via "breakingChangeIndex" and explain the reason in "breakingReason".',
    '- Be conservative with "breaking": true — routine refactors, added optional parameters, new files, and internal-only changes are NOT breaking.',
    ...ruleLines(rules),
    ...feedbackLines(feedback),
    '',
    'Diff:',
    diff,
  ].join('\n');
}

/**
 * @param {{ commitsText: string, diff: string, context?: string, maxChars?: number|null }} input
 *   commitsText — the release's commit list (primary source); diff — filtered
 *   supplementary diff; context — what the product is (e.g. "a CLI tool").
 */
export function buildReleaseNotesPrompt({ commitsText, diff, context = '', maxChars = null, feedback = '' }) {
  return [
    `You write release notes for end users of ${context || 'a software product'} from its commit history and code changes. Respond with ONLY a JSON object, nothing else — no markdown fences, no commentary.`,
    '',
    'JSON shape:',
    '{',
    '  "notes": ["bullet 1", "bullet 2", ...]',
    '}',
    '',
    'Rules:',
    '- 3 to 6 short bullets max, each describing ONE user-visible change or improvement.',
    '- Plain, clear, non-technical language; start with a verb when natural (e.g. "Added", "Fixed", "Improved").',
    '- No code, file paths, function names or other internal details.',
    '- Order: most notable change first.',
    '- Skip internal-only work (CI, tests, refactors, dependency bumps, docs) unless users would notice it.',
    ...(maxChars ? [`- Keep the whole list, as "- " bullets joined by newlines, under ${maxChars} characters.`] : []),
    '- Output ONLY the JSON object. No text before or after it.',
    ...feedbackLines(feedback),
    '',
    'Commits (primary source of truth; ignore conventional-commit prefixes and emoji in your wording):',
    commitsText || '(none)',
    '',
    'Code diff (supplementary, lockfiles/tests/CI excluded):',
    diff || '(none)',
  ].join('\n');
}

/** Pull-request title + description from a branch's commits and diff — used by `--pr`. */
export function buildPullRequestPrompt({ commitsText, diff, feedback = '' }) {
  return [
    'You write a GitHub pull request title and description for a branch, from its commits and code diff. Respond with ONLY a JSON object, nothing else — no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{',
    '  "title": "conventional-commit style title: type(scope): subject, imperative, under 72 chars, no emoji",',
    '  "summary": ["2-5 short bullets: what changed and why, for a reviewer"],',
    '  "testPlan": ["1-5 short, concrete steps a reviewer can run to verify the change"]',
    '}',
    '',
    'Rules:',
    '- Describe the branch as ONE coherent change; do not just list commits.',
    '- Be specific and concrete (flags, files, behaviors), not generic.',
    '- Do not mention breaking changes here; they are added separately from the commit messages.',
    '- Output ONLY the JSON object.',
    ...(feedback ? ['', `Additional instruction from the user (follow it): ${feedback}`] : []),
    '',
    'Commits:',
    commitsText || '(none)',
    '',
    'Code diff (lockfiles excluded):',
    diff || '(none)',
  ].join('\n');
}

/** Short status update from a person's recent commits (+ uncommitted file names) — used by `--standup`. */
export function buildStandupPrompt({ commitsText, since, wipFiles = [], branch = '' }) {
  return [
    'You write a brief stand-up update for a developer from their git activity. Respond with ONLY a JSON object, nothing else — no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{',
    '  "done": ["what was accomplished, one short plain-English line each"],',
    '  "inProgress": ["what looks unfinished or ongoing, one short line each"]',
    '}',
    '',
    'Rules:',
    '- "done" comes from the commits: merge related commits into one line, describe outcomes (what now works), not file names or commit hashes. At most 6 lines.',
    '- "inProgress" comes only from the uncommitted files and the branch name; leave it empty when there is nothing uncommitted. At most 3 lines.',
    '- Do not invent work that the input does not support. No blockers, no praise, no emoji.',
    '- Output ONLY the JSON object.',
    '',
    `Commits since ${since}:`,
    commitsText || '(none)',
    '',
    `Current branch: ${branch || 'unknown'}`,
    `Uncommitted files: ${wipFiles.length > 0 ? wipFiles.join(', ') : '(none)'}`,
  ].join('\n');
}

/** Code review of a diff for real problems (not style) — used by `--review`. */
export function buildReviewPrompt(diff) {
  return [
    'You are a careful senior engineer reviewing a git diff. Respond with ONLY a JSON object, nothing else — no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{',
    '  "summary": "one or two sentences: what this change does and your overall impression",',
    '  "findings": [',
    '    { "severity": "high|medium|low", "file": "path", "line": 0, "title": "short problem statement", "detail": "why it is a problem, concretely", "suggestion": "how to fix it" }',
    '  ],',
    '  "missingTests": ["behavior in this diff that has no test coverage"]',
    '}',
    '',
    'Rules:',
    '- Report real problems supported by the diff: bugs, security issues, data loss, race conditions, unhandled errors, broken edge cases, API misuse, serious performance problems. No style nits, naming opinions or praise.',
    '- "high" = likely bug, security hole or data loss; "medium" = risky or fragile; "low" = minor but worth fixing.',
    '- "line" is the line number in the new file when you can tell, otherwise 0.',
    '- Keep "findings" and "missingTests" empty when there is nothing real to report — do not invent issues.',
    '- Output ONLY the JSON object.',
    '',
    'Diff:',
    diff,
  ].join('\n');
}

/** Focused breaking-change review of a diff (no commit message) — used by `--breaking`. */
export function buildBreakingPrompt(diff) {
  return [
    'You review a git diff ONLY for breaking changes. Respond with ONLY a JSON object, nothing else — no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{',
    '  "breaking": true or false,',
    '  "findings": [',
    '    { "file": "path of the changed file", "what": "what changed, e.g. config key maxDiff renamed to maxDiffChars", "impact": "what breaks for existing users/callers, e.g. existing .commitsmithrc files stop applying maxDiff" }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- "breaking" is true only if an existing public interface is removed, renamed, or changed incompatibly: exported functions/classes and their signatures, routes/endpoints, CLI commands and flags, environment variables, config keys, file formats, database schemas, or default behavior that existing callers rely on.',
    '- NOT breaking: new optional parameters/flags/options, new files, internal refactors, bug fixes that keep the interface, docs, tests, formatting.',
    '- "findings" lists each breaking change (one entry per change); it is empty when "breaking" is false.',
    '- Keep "what" and "impact" short and concrete. Output ONLY the JSON object.',
    '',
    'Diff:',
    diff,
  ].join('\n');
}

/** Translates already-approved release-note bullets; same JSON shape as the original. */
export function buildTranslationPrompt(notes, language) {
  return [
    `Translate these app release-note bullets into ${language}. Keep the meaning, keep each bullet short, and keep the same number of bullets in the same order. Respond with ONLY a JSON object: { "notes": ["...", ...] } — no markdown fences, no commentary.`,
    '',
    'Bullets:',
    ...notes.map((n) => `- ${n}`),
  ].join('\n');
}

export function buildGroupingPrompt(fileEntries, rules = null) {
  const filesBlock = fileEntries
    .map(({ path, diff }) => `### FILE: ${path}\n${diff}`)
    .join('\n\n');

  return [
    'You group a set of staged file diffs into logical commits. Respond with ONLY a JSON object, nothing else — no markdown fences, no commentary.',
    '',
    'JSON shape:',
    '{',
    '  "groups": [',
    '    {',
    '      "files": ["path/one.php", "path/two.php"],',
    '      "type": one of feat|fix|docs|style|refactor|perf|test|build|ci|chore|security|accessibility|removal,',
    '      "scope": short lowercase scope, use "" if not applicable,',
    '      "subject": imperative, under 72 chars, describing what this GROUP of files does together,',
    '      "changes": array of 1-5 short bullet strings describing concrete changes across this group,',
    '      "breaking": true or false,',
    '      "breakingChangeIndex": 0-based index into "changes" that is breaking, else -1,',
    '      "breakingReason": short phrase if breaking is true, else ""',
    '    }',
    '  ]',
    '}',
    '',
    'Rules:',
    '- Every staged file below must appear in EXACTLY ONE group. Do not omit or duplicate any file.',
    '- Put files together in the same group ONLY if they implement the same logical change (e.g. a migration + model + seeder for the same new feature, or a class and its test).',
    '- If a file is unrelated to the others, give it its own group rather than forcing it in.',
    '- Prefer fewer, larger groups over many tiny ones ONLY when the relationship is genuine — do not merge unrelated files just to reduce the count.',
    '- "changes" entries must be PLAIN descriptions only — never write literal text like "[BREAKING CHANGE: ...]" inside a "changes" string. That annotation is added separately by the caller from "breakingReason"; your job is only to point at the right bullet via "breakingChangeIndex" and explain the reason in "breakingReason".',
    ...ruleLines(rules),
    '- Output ONLY the JSON object.',
    '',
    'Staged files:',
    filesBlock,
  ].join('\n');
}
