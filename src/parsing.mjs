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

  const breakingIndex =
    Number.isInteger(parsed.breakingChangeIndex) && parsed.breakingChangeIndex < changes.length
      ? parsed.breakingChangeIndex
      : -1;

  if (!subject) return null;

  const gitmoji = breaking ? BREAKING_GITMOJI : GITMOJI[type];
  const scopePart = scope ? `(${scope})` : '';
  let message = `${gitmoji} ${type}${scopePart}: ${subject}`;

  if (changes.length > 0) {
    const bullets = changes.map((change, i) => {
      const isBreakingBullet = breaking && i === breakingIndex;
      const suffix = isBreakingBullet && breakingReason ? ` [BREAKING CHANGE: ${breakingReason}]` : '';
      return `* ${change}${suffix}`;
    });

    // If the model flagged a breaking change but didn't point at a specific
    // bullet, append a dedicated breaking-change bullet rather than losing it.
    if (breaking && breakingReason && breakingIndex < 0) {
      bullets.push(`* BREAKING CHANGE: ${breakingReason}`);
    }

    message += `\n\n${bullets.join('\n')}`;
  } else if (breaking && breakingReason) {
    message += `\n\n* BREAKING CHANGE: ${breakingReason}`;
  }

  return { message, breaking };
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
export function retypeMessage(message, { type, breaking } = {}) {
  const m = message.match(/^(\S+)\s+(\w+)(\([^)]*\))?:/);
  if (!m) return message;
  const newType = type && ALLOWED_TYPES.has(type) ? type : m[2];
  const isBreaking = breaking ?? m[1] === BREAKING_GITMOJI;
  const gitmoji = isBreaking ? BREAKING_GITMOJI : GITMOJI[newType];
  return `${gitmoji} ${newType}${m[3] || ''}:${message.slice(m[0].length)}`;
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
