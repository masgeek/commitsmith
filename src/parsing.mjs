import { ALLOWED_TYPES, GITMOJI, BREAKING_GITMOJI } from './constants.mjs';
import { parseCommitHeader } from './conventional.mjs';
import { appendFooter } from './tickets.mjs';

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

/**
 * Build the final commit message string from the model's structured result.
 * `rules` (see rules.mjs, all optional) constrain the result: a type outside
 * `allowedTypes` falls back to chore (or the first allowed type), a scope
 * outside `scopes` is dropped, and `gitmoji: false` omits the leading emoji
 * (a breaking change is then marked `type(scope)!:`).
 */
export function formatCommitMessage(parsed, breakingDetectionEnabled = true, rules = {}) {
  const allowedTypes = rules.allowedTypes ?? [];
  let type = ALLOWED_TYPES.has(parsed.type) ? parsed.type : 'chore';
  if (allowedTypes.length > 0 && !allowedTypes.includes(type)) type = allowedTypes.includes('chore') ? 'chore' : allowedTypes[0];
  let scope = typeof parsed.scope === 'string' ? parsed.scope.trim().replace(/[()]/g, '') : '';
  if ((rules.scopes ?? []).length > 0 && !rules.scopes.includes(scope.toLowerCase())) scope = '';
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

  const scopePart = scope ? `(${scope})` : '';
  let message =
    rules.gitmoji === false
      ? `${type}${scopePart}${breaking ? '!' : ''}: ${subject}`
      : `${breaking ? BREAKING_GITMOJI : GITMOJI[type]} ${type}${scopePart}: ${subject}`;

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
export function formatPullRequestBody({ summary, testPlan, breaking = [], footer = '' }) {
  const sections = [];
  if (summary.length > 0) sections.push(`## Summary\n\n${summary.map((s) => `- ${s}`).join('\n')}`);
  if (breaking.length > 0) sections.push(`## ⚠️ Breaking changes\n\n${breaking.map((b) => `- ${b}`).join('\n')}`);
  if (testPlan.length > 0) sections.push(`## Test plan\n\n${testPlan.map((t) => `- [ ] ${t}`).join('\n')}`);
  if (footer) sections.push(footer); // e.g. "Refs: ABC-123"
  return sections.join('\n\n');
}

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

/**
 * Parses the model's `--review` response into { summary, findings[], missingTests[] }.
 * Findings are { severity, file, line, title, detail, suggestion }, unknown
 * severities become "low", items without a title are dropped, and the list is
 * sorted high → low and capped at 20. Returns null when there is no JSON.
 */
export function parseReviewResult(raw) {
  const parsed = parseModelJson(raw);
  if (!parsed) return null;
  const str = (v) => String(v ?? '').trim();
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .filter((f) => f && typeof f === 'object')
    .map((f) => ({
      severity: Object.hasOwn(SEVERITY_RANK, str(f.severity).toLowerCase()) ? str(f.severity).toLowerCase() : 'low',
      file: str(f.file),
      line: Number.isInteger(f.line) && f.line > 0 ? f.line : 0,
      title: str(f.title),
      detail: str(f.detail),
      suggestion: str(f.suggestion),
    }))
    .filter((f) => f.title)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, 20);
  return { summary: str(parsed.summary), findings, missingTests: cleanList(parsed.missingTests, 8) };
}

/** Combines per-file reviews: summaries joined, findings and missing tests merged without duplicates. */
export function mergeReviewResults(results) {
  const seen = new Set();
  const findings = [];
  for (const r of results) {
    for (const f of r.findings) {
      const key = `${f.file}|${f.line}|${f.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push(f);
      }
    }
  }
  findings.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return {
    summary: [...new Set(results.map((r) => r.summary).filter(Boolean))].join(' '),
    findings,
    missingTests: [...new Set(results.flatMap((r) => r.missingTests))],
  };
}

/** True when any finding is at or above `level` (high > medium > low). */
export function exceedsSeverity(findings, level) {
  return Boolean(level) && findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[level]);
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

/** True when a commit message is flagged breaking: a 💥 header, `type!:`, or a BREAKING CHANGE footer. */
export function isBreakingMessage(message) {
  const header = parseCommitHeader(String(message).trimStart().split('\n')[0]);
  return header?.emoji === BREAKING_GITMOJI || Boolean(header?.bang) || /^BREAKING[ -]CHANGE:/im.test(message);
}

/** Removes "BREAKING CHANGE:" footer lines (and any paragraph left empty), keeping other footers such as "Refs:". */
function stripBreakingFooter(text) {
  return text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split('\n')
        .filter((l) => !/^BREAKING[ -]CHANGE:/i.test(l))
        .join('\n')
    )
    .filter((p) => p.trim() !== '')
    .join('\n\n');
}

/**
 * Rewrites the header of a formatted commit message with a different type
 * and/or breaking flag. With a leading emoji the emoji is swapped to match
 * (💥 for breaking); without one, breaking is marked `type(scope)!:`. The
 * "BREAKING CHANGE:" footer is added or removed to match. Leaves the message
 * untouched when its first line isn't a conventional header.
 */
export function retypeMessage(message, { type, breaking, breakingReason } = {}) {
  const firstLine = message.split('\n')[0];
  const header = parseCommitHeader(firstLine);
  if (!header) return message;

  const newType = type && ALLOWED_TYPES.has(type) ? type : header.type;
  const isBreaking = breaking ?? (header.emoji === BREAKING_GITMOJI || header.bang);
  const scopePart = header.scope ? `(${header.scope})` : '';
  const newFirst = header.emoji
    ? `${isBreaking ? BREAKING_GITMOJI : GITMOJI[newType]} ${newType}${scopePart}: ${header.description}`
    : `${newType}${scopePart}${isBreaking ? '!' : ''}: ${header.description}`;

  let result = `${newFirst}${message.slice(firstLine.length)}`;
  const hasFooter = /^BREAKING[ -]CHANGE:/im.test(result);
  if (!isBreaking && hasFooter) {
    result = stripBreakingFooter(result);
  } else if (isBreaking && !hasFooter) {
    result = appendFooter(result, `BREAKING CHANGE: ${breakingReason || header.description}`);
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

/** Parses the `--standup` response into { done[], inProgress[] }; null when both are empty or there is no JSON. */
export function parseStandup(raw) {
  const parsed = parseModelJson(raw);
  if (!parsed) return null;
  const done = cleanList(parsed.done, 6);
  const inProgress = cleanList(parsed.inProgress, 3);
  return done.length === 0 && inProgress.length === 0 ? null : { done, inProgress };
}

/** Plain-text stand-up: "Done:" and "In progress:" bullet blocks (empty blocks omitted). */
export function formatStandup({ done, inProgress }) {
  const block = (title, items) => (items.length > 0 ? `${title}\n${items.map((i) => `- ${i}`).join('\n')}` : '');
  return [block('Done:', done), block('In progress:', inProgress)].filter(Boolean).join('\n\n');
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

export function parseGroupingResult(raw, allFiles, breakingDetectionEnabled = true, rules = {}) {
  const parsed = parseModelJson(raw);
  if (!parsed || !Array.isArray(parsed.groups)) return null;

  const seen = new Set();
  const groups = [];

  for (const g of parsed.groups) {
    if (!Array.isArray(g.files) || g.files.length === 0) continue;
    const validFiles = g.files.filter((f) => allFiles.includes(f) && !seen.has(f));
    if (validFiles.length === 0) continue;
    validFiles.forEach((f) => seen.add(f));

    const formatted = formatCommitMessage(g, breakingDetectionEnabled, rules);
    if (!formatted) continue;

    groups.push({ files: validFiles, message: formatted.message, breaking: formatted.breaking });
  }

  // Any staged file the model missed or duplicated away gets swept into a
  // trailing catch-all group rather than silently dropped.
  const leftover = allFiles.filter((f) => !seen.has(f));
  if (leftover.length > 0) {
    groups.push({
      files: leftover,
      message: `${rules.gitmoji === false ? '' : `${GITMOJI.chore} `}chore: update ${leftover.length > 1 ? 'remaining files' : leftover[0]}`,
      breaking: false,
    });
  }

  return groups.length > 0 ? groups : null;
}
