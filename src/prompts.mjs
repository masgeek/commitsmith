export function buildPrompt(diff) {
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
    '  "breakingChangeIndex": if breaking is true, the 0-based index into "changes" that is the breaking one (append "[BREAKING CHANGE: ...]" context there); otherwise -1,',
    '  "breakingReason": if breaking is true, one short phrase explaining what breaks; otherwise ""',
    '}',
    '',
    'Rules:',
    '- Output ONLY the JSON object. No text before or after it.',
    '- "subject" must describe the diff as a single coherent change, even if it touches multiple methods.',
    '- Each entry in "changes" is a short, concrete bullet point (not a restatement of "subject") — e.g. "extracted validation into validateInput()", "added null check for legacy records".',
    '- Be conservative with "breaking": true — routine refactors, added optional parameters, new files, and internal-only changes are NOT breaking.',
    '',
    'Diff:',
    diff,
  ].join('\n');
}

export function buildGroupingPrompt(fileEntries) {
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
    '- Output ONLY the JSON object.',
    '',
    'Staged files:',
    filesBlock,
  ].join('\n');
}
