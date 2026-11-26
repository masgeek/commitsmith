import { ALLOWED_TYPES, GITMOJI, BREAKING_GITMOJI } from './constants.mjs';

/** Extract and parse the first JSON object found in raw model output. */
export function parseModelJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Build the final commit message string from the model's structured result. */
export function formatCommitMessage(parsed, breakingDetectionEnabled = true) {
  const type = ALLOWED_TYPES.has(parsed.type) ? parsed.type : 'chore';
  const scope = typeof parsed.scope === 'string' ? parsed.scope.trim().replace(/[()]/g, '') : '';
  const subjectRaw = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
  const subject = subjectRaw.replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, '');
  const breaking = breakingDetectionEnabled && parsed.breaking === true;
  const breakingReason = typeof parsed.breakingReason === 'string' ? parsed.breakingReason.trim() : '';

  const changes = Array.isArray(parsed.changes)
    ? parsed.changes
        .filter((c) => typeof c === 'string' && c.trim().length > 0)
        .map((c) =>
          c
            .trim()
            .replace(/^["'`]+|["'`]+$/g, '')
            // Some models embed "[BREAKING CHANGE: ...]" directly into the
            // change text itself despite the prompt asking them not to —
            // strip it here so we don't end up appending our own copy on
            // top and showing it twice.
            .replace(/\s*\[?BREAKING CHANGE:[^\]\n]*\]?/gi, '')
            .trim()
            .replace(/\.$/, '')
        )
        .filter((c) => c.length > 0)
        .slice(0, 5)
    : [];

  if (!subject) return null;

  const gitmoji = breaking ? BREAKING_GITMOJI : GITMOJI[type];
  const scopePart = scope ? `(${scope})` : '';
  let message = `${gitmoji} ${type}${scopePart}: ${subject}`;

  if (changes.length > 0) {
    message += `\n\n${changes.map((change) => `* ${change}`).join('\n')}`;
  }

  // Conventional Commits footer: a final "BREAKING CHANGE: <description>"
  // paragraph, always present for a breaking commit (falls back to the
  // subject when the model gave no reason) so tools that scan footers see it.
  if (breaking) {
    message += `\n\nBREAKING CHANGE: ${breakingReason || subject}`;
  }

  return { message, breaking };
}

/**
 * Parses the model's `--breaking` review into { breaking, findings[] } where
 * each finding is { file, what, impact }. Returns null when the response has
 * no JSON. A breaking verdict with no findings still yields one generic
 * finding, so a "breaking" result is never silent.
 */
export function parseBreakingResult(raw) {
  const parsed = parseModelJson(raw);
  if (!parsed) return null;
  const breaking = parsed.breaking === true;
  if (!breaking) return { breaking: false, findings: [] };

  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      file: String(f.file ?? '').trim(),
      what: String(f.what ?? '').trim(),
      impact: String(f.impact ?? '').trim(),
    }))
    .filter((f) => f.what);
  if (findings.length === 0) {
    findings.push({ file: '', what: String(parsed.reason ?? '').trim() || 'unspecified breaking change', impact: '' });
  }
  return { breaking: true, findings };
}

/** Combines per-file results: breaking if any is, findings concatenated without duplicates. */
export function mergeBreakingResults(results) {
  const seen = new Set();
  const findings = [];
  for (const r of results) {
    for (const f of r.findings) {
      const key = `${f.file}|${f.what}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
    }
  }
  return { breaking: results.some((r) => r.breaking), findings };
}

/** "- subject (first 200 chars of body)" lines for a prompt, from { subject, body }[] commits. */
export function formatCommitsForPrompt(commits) {
  return commits
    .map(({ subject, body }) => {
      const detail = body.replace(/\s+/g, ' ').slice(0, 200);
      return detail ? `- ${subject} (${detail})` : `- ${subject}`;
    })
    .join('\n');
}

const cleanList = (value, max) =>
  (Array.isArray(value) ? value : [])
    .map((v) => String(v).trim().replace(/^[-*•]\s+/, ''))
    .filter(Boolean)
    .slice(0, max);

/**
 * Parses the model's pull-request response into { title, summary[], testPlan[] }.
 * Returns null when there is no usable title.
 */
export function parsePullRequest(raw) {
  const parsed = parseModelJson(raw);
  if (!parsed) return null;
  const title = String(parsed.title ?? '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\.$/, '');
  if (!title) return null;
  return { title, summary: cleanList(parsed.summary, 6), testPlan: cleanList(parsed.testPlan, 6) };
}

/** "BREAKING CHANGE: …" footer lines found in commit messages ({ subject, body }[]), deduplicated. */
export function extractBreakingNotes(commits) {
  const notes = new Set();
  for (const { body = '' } of commits) {
    for (const m of body.matchAll(/^BREAKING[ -]CHANGE:\s*(.+)$/gim)) notes.add(m[1].trim());
  }
  return [...notes];
}

/** Markdown PR body: Summary, optional Breaking changes, Test plan (as unchecked boxes). */
export function formatPullRequestBody({ summary, testPlan, breaking = [] }) {
  const sections = [];
  if (summary.length > 0) sections.push(`## Summary\n\n${summary.map((s) => `- ${s}`).join('\n')}`);
  if (breaking.length > 0) sections.push(`## ⚠️ Breaking changes\n\n${breaking.map((b) => `- ${b}`).join('\n')}`);
  if (testPlan.length > 0) sections.push(`## Test plan\n\n${testPlan.map((t) => `- [ ] ${t}`).join('\n')}`);
  return sections.join('\n\n');
}

/** One-line description of what breaks, for a commit's BREAKING CHANGE footer. */
export function breakingReason(findings) {
  return findings
    .slice(0, 3)
    .map((f) => f.impact || f.what)
    .join('; ');
}

/** The "BREAKING CHANGE: …" footer text to paste into a commit message for these findings. */
export function breakingFooter(findings) {
  return `BREAKING CHANGE: ${breakingReason(findings)}`;
}

/** True when a formatted commit message is flagged breaking (leading 💥). */
export function isBreakingMessage(message) {
  return message.trimStart().startsWith(BREAKING_GITMOJI);
}

/**
 * Rewrites the header line of a formatted commit message with a different
 * type and/or breaking flag, swapping the leading gitmoji to match. Leaves the
 * message untouched when its header isn't in "<emoji> type(scope): …" form.
 */
export function retypeMessage(message, { type, breaking, breakingReason } = {}) {
  const m = message.match(/^(\S+)\s+(\w+)(\([^)]*\))?:/);
  if (!m) return message;
  const newType = type && ALLOWED_TYPES.has(type) ? type : m[2];
  const isBreaking = breaking ?? m[1] === BREAKING_GITMOJI;
  const gitmoji = isBreaking ? BREAKING_GITMOJI : GITMOJI[newType];
  let result = `${gitmoji} ${newType}${m[3] || ''}:${message.slice(m[0].length)}`;

  // Keep the "BREAKING CHANGE:" footer in step with the flag.
  const footerAt = result.search(/\n\nBREAKING CHANGE:/);
  if (!isBreaking && footerAt !== -1) {
    result = result.slice(0, footerAt);
  } else if (isBreaking && footerAt === -1) {
    const subject = result.split('\n')[0].replace(/^\S+\s+\w+(\([^)]*\))?:\s*/, '');
    result += `\n\nBREAKING CHANGE: ${breakingReason || subject}`;
  }
  return result;
}

/** Fallback for when the model doesn't return valid JSON: treat first line as the subject. */
export function fallbackFromRawText(raw) {
  const firstLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  const cleaned = firstLine.replace(/^["'`]+|["'`]+$/g, '');
  return { message: cleaned, breaking: false };
}

const MAX_RELEASE_NOTES = 6; // matches the "3 to 6 bullets" rule in buildReleaseNotesPrompt

/**
 * Parses the model's release-notes response into a bullet list of user-facing
 * strings. JSON shape: { "notes": [...] }. Falls back to the non-empty lines
 * of raw text when the model returns no JSON. Returns null when there is
 * nothing to summarize.
 */
export function parseReleaseNotes(raw) {
  const parsed = parseModelJson(raw);
  if (parsed) {
    // The model produced the expected JSON shape; accept it if non-empty,
    // otherwise there is nothing to summarize — don't fall back to echoing the raw JSON.
    const notes = (Array.isArray(parsed.notes) ? parsed.notes : [])
      .map((n) => String(n).trim())
      .filter(Boolean)
      .slice(0, MAX_RELEASE_NOTES);
    return notes.length > 0 ? notes : null;
  }
  const lines = raw
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•]\s+/, ''))
    .filter((l) => l && !l.endsWith(':')); // drop "Here are the notes:"-style preambles
  return lines.length > 0 ? lines.slice(0, MAX_RELEASE_NOTES) : null;
}

/** Renders notes as the "- bullet" block that --release-notes prints. */
export function formatReleaseNotes(notes) {
  return notes.map((n) => `- ${n}`).join('\n');
}

/**
 * Drops trailing (least notable) notes until the rendered block fits maxChars.
 * Always keeps at least one note; returns { notes, fits } so callers can warn
 * when even a single note is over the limit.
 */
export function limitReleaseNotes(notes, maxChars) {
  if (!maxChars) return { notes, fits: true };
  const kept = [...notes];
  while (kept.length > 1 && formatReleaseNotes(kept).length > maxChars) kept.pop();
  return { notes: kept, fits: formatReleaseNotes(kept).length <= maxChars };
}

export function parseGroupingResult(raw, allFiles, breakingDetectionEnabled = true) {
  const parsed = parseModelJson(raw);
  if (!parsed || !Array.isArray(parsed.groups)) return null;

  const seen = new Set();
  const groups = [];

  for (const g of parsed.groups) {
    if (!Array.isArray(g.files) || g.files.length === 0) continue;
    const validFiles = g.files.filter((f) => allFiles.includes(f) && !seen.has(f));
    if (validFiles.length === 0) continue;
    validFiles.forEach((f) => seen.add(f));

    const formatted = formatCommitMessage(g, breakingDetectionEnabled);
    if (!formatted) continue;

    groups.push({ files: validFiles, message: formatted.message, breaking: formatted.breaking });
  }

  // Any staged file the model missed or duplicated away gets swept into a
  // trailing catch-all group rather than silently dropped.
  const leftover = allFiles.filter((f) => !seen.has(f));
  if (leftover.length > 0) {
    groups.push({
      files: leftover,
      message: `${GITMOJI.chore} chore: update ${leftover.length > 1 ? 'remaining files' : leftover[0]}`,
      breaking: false,
    });
  }

  return groups.length > 0 ? groups : null;
}
