#!/usr/bin/env node
/**
 * oco-lite.mjs
 *
 * Copyright (c) Munywele Consulting LTD
 * https://munywele.co.ke
 *
 * Minimal, dependency-free commit message generator using a local Ollama
 * model. Bypasses OpenCommit's known bugs (multi-line output on single
 * changes, Windows ESM config-loader crash in @commitlint mode) by talking
 * to the Ollama /api/generate endpoint directly with a strict, structured
 * prompt.
 *
 * Modes:
 *   node oco-lite.mjs                    print a single message for all staged changes
 *   node oco-lite.mjs --commit           ... and commit it (with confirmation)
 *   node oco-lite.mjs -y                 ... and commit it (no confirmation)
 *   node oco-lite.mjs --split            auto-detect related files and merge them;
 *                                         everything else gets one commit per file
 *   node oco-lite.mjs --split --no-group-detection  strict one commit per staged FILE
 *   node oco-lite.mjs --split-hunks      one message/commit per diff HUNK (logical change)
 *   node oco-lite.mjs --group            same relatedness detection as --split, without the
 *                                         per-file fallback for a single staged file
 *   node oco-lite.mjs --dry-run          (--split-hunks only) preview hunks/messages, touch nothing
 *   node oco-lite.mjs --help             show this help
 *
 * At any confirmation prompt, answering "e" opens the generated message in
 * $GIT_EDITOR/$EDITOR for editing before committing.
 *
 * --split / --group relatedness detection:
 *   Looks at all staged files together and asks the model to cluster files
 *   that belong to the same logical change (e.g. a migration + model +
 *   seeder added for the same feature) into one commit, while keeping
 *   genuinely unrelated files in separate commits — each group gets its own
 *   breaking-change assessment (see below). --split falls back to a strict
 *   one-commit-per-file split if nothing is related or the model's grouping
 *   response doesn't parse; pass --no-group-detection to always get the
 *   strict per-file behavior. Different from --split-hunks, which always
 *   produces one commit per diff hunk within a single file.
 *
 * Commit message format:
 *   <gitmoji> <type>(<scope>): <subject>
 *
 *   * <change 1>
 *   * <change 2> [BREAKING CHANGE: only present if applicable]
 *
 *   Gitmoji is chosen from the type (✨ feat, 🐛 fix, 📝 docs, 🎨 style,
 *   ♻️ refactor, ⚡ perf, ✅ test, 🛠️ build, 👷 ci, 🔧 chore, 🔒 security,
 *   ♿ accessibility, 🗑️ removal), or 💥 whenever the commit is flagged
 *   as a breaking change (see below), overriding the type's normal emoji.
 *
 * Breaking change detection:
 *   Every generated message is classified for breaking-change risk (removed
 *   or renamed public API, changed method signature, migration that alters
 *   an existing schema/column, changed config keys/env vars, etc.). When
 *   flagged, the leading gitmoji becomes 💥 and the relevant bullet is
 *   annotated inline with "[BREAKING CHANGE: <reason>]" per the template
 *   above. Disable with --no-breaking-detection if you find it too
 *   aggressive.
 *
 * Config via env vars (all optional):
 *   OCOLITE_MODEL      default: qwen2.5-coder:7b
 *   OCOLITE_HOST       default: http://localhost:11434
 *   OCOLITE_MAX_DIFF   default: 6000   (chars of diff sent to the model per request)
 *   OCOLITE_TIMEOUT_MS default: 60000  (per-request timeout to Ollama)
 *   OCOLITE_GROUP_MAX_DIFF_PER_FILE default: 1200 (chars of each file's diff sent during
 *                                                   relatedness detection in --split/--group)
 */

import { execSync, execFileSync, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL = process.env.OCOLITE_MODEL || 'qwen2.5-coder:7b';
const HOST = process.env.OCOLITE_HOST || 'http://localhost:11434';
const MAX_DIFF = Number(process.env.OCOLITE_MAX_DIFF || 6000);
const TIMEOUT_MS = Number(process.env.OCOLITE_TIMEOUT_MS || 60000);
const GROUP_MAX_DIFF_PER_FILE = Number(process.env.OCOLITE_GROUP_MAX_DIFF_PER_FILE || 1200);

const ALLOWED_TYPES = new Set([
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test',
  'build', 'ci', 'chore', 'security', 'accessibility', 'removal',
]);

const GITMOJI = {
  feat: '✨',
  fix: '🐛',
  docs: '📝',
  style: '🎨',
  refactor: '♻️',
  perf: '⚡',
  test: '✅',
  build: '🛠️',
  ci: '👷',
  chore: '🔧',
  security: '🔒',
  accessibility: '♿',
  removal: '🗑️',
};
const BREAKING_GITMOJI = '💥';

const args = process.argv.slice(2);
const shouldCommit = args.includes('--commit') || args.includes('-y');
const autoYes = args.includes('-y');
const splitMode = args.includes('--split');
const splitHunksMode = args.includes('--split-hunks');
const groupMode = args.includes('--group');
const dryRun = args.includes('--dry-run');
const breakingDetectionEnabled = !args.includes('--no-breaking-detection');
const helpRequested = args.includes('--help') || args.includes('-h');

function printHelp() {
  console.log(`oco-lite — local Ollama commit message generator

Usage:
  oco-lite                        print message for all staged changes
  oco-lite --commit               generate + confirm + commit
  oco-lite -y                     generate + commit, no confirmation
  oco-lite --split [--commit|-y]  merge related staged files into one commit each,
                                   one commit per file for everything else
  oco-lite --split --no-group-detection  strict one commit per staged file
  oco-lite --split-hunks [...]    one commit per logical diff hunk
  oco-lite --split-hunks --dry-run  preview hunks/messages, no staging or commits
  oco-lite --group [--commit|-y]  same relatedness detection as --split
  oco-lite --no-breaking-detection  skip breaking-change classification
  oco-lite --help                 show this help

At any confirmation prompt, answer "e" to edit the message in $GIT_EDITOR/$EDITOR before committing.

Env vars: OCOLITE_MODEL, OCOLITE_HOST, OCOLITE_MAX_DIFF, OCOLITE_TIMEOUT_MS`);
}

/** Fail fast with a clear message and a non-zero exit code. */
function die(message) {
  console.error(message);
  process.exit(1);
}

function assertGitRepo() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch {
    die('Not inside a git repository.');
  }
}

async function assertOllamaReachable() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${HOST}/api/tags`, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (err) {
    die(
      `Cannot reach Ollama at ${HOST} (${err.message || err}).\n` +
        `Is it running? Try: ollama serve\n` +
        `Or set OCOLITE_HOST if it's on a different address.`
    );
  }
}

function getStagedDiff(pathspec) {
  const cmd = pathspec
    ? `git diff --staged --no-color -- ${JSON.stringify(pathspec)}`
    : 'git diff --staged --no-color';
  let diff;
  try {
    diff = execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  } catch {
    die('Failed to run `git diff --staged`.');
  }
  if (!diff.trim()) die('No staged changes found. Run `git add <files>` first.');
  return diff;
}

function getStagedFiles() {
  try {
    return execSync('git diff --staged --name-only', { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) return diff;
  return diff.slice(0, maxChars) + '\n[... diff truncated ...]';
}

/** Split one file's unified diff into { header, hunks[] }. Returns null for binary/mode-only diffs. */
function parseFileDiffIntoHunks(fileDiff) {
  const lines = fileDiff.split('\n');
  const firstHunkIdx = lines.findIndex((l) => l.startsWith('@@'));
  if (firstHunkIdx === -1) return null;

  const header = lines.slice(0, firstHunkIdx).join('\n');
  const body = lines.slice(firstHunkIdx);

  const hunks = [];
  let current = [];
  for (const line of body) {
    if (line.startsWith('@@') && current.length > 0) {
      hunks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) hunks.push(current.join('\n'));

  return { header, hunks };
}

function getFileDiffs() {
  const fullDiff = getStagedDiff(null);
  return fullDiff.split(/(?=^diff --git )/m).filter((p) => p.trim().length > 0);
}

function extractPathFromFileDiff(fileDiff) {
  const match = fileDiff.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  return match ? match[2] : null;
}

function buildPrompt(diff) {
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

function buildGroupingPrompt(fileEntries) {
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

function parseGroupingResult(raw, allFiles) {
  const parsed = parseModelJson(raw);
  if (!parsed || !Array.isArray(parsed.groups)) return null;

  const seen = new Set();
  const groups = [];

  for (const g of parsed.groups) {
    if (!Array.isArray(g.files) || g.files.length === 0) continue;
    const validFiles = g.files.filter((f) => allFiles.includes(f) && !seen.has(f));
    if (validFiles.length === 0) continue;
    validFiles.forEach((f) => seen.add(f));

    const formatted = formatCommitMessage(g);
    if (!formatted) continue;

    groups.push({ files: validFiles, message: formatted.message, breaking: formatted.breaking });
  }

  // Any staged file the model missed or duplicated away gets swept into a
  // trailing catch-all group rather than silently left uncommitted.
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

async function callOllama(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        format: 'json',
        options: { temperature: 0.15 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Ollama request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    return data.response ?? '';
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${TIMEOUT_MS}ms. Try a smaller diff or a faster model.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Extract and parse the first JSON object found in raw model output. */
function parseModelJson(raw) {
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
function formatCommitMessage(parsed) {
  const type = ALLOWED_TYPES.has(parsed.type) ? parsed.type : 'chore';
  const scope = typeof parsed.scope === 'string' ? parsed.scope.trim().replace(/[()]/g, '') : '';
  const subjectRaw = typeof parsed.subject === 'string' ? parsed.subject.trim() : '';
  const subject = subjectRaw.replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, '');
  const breaking = breakingDetectionEnabled && parsed.breaking === true;
  const breakingReason = typeof parsed.breakingReason === 'string' ? parsed.breakingReason.trim() : '';

  const changes = Array.isArray(parsed.changes)
    ? parsed.changes
        .filter((c) => typeof c === 'string' && c.trim().length > 0)
        .map((c) => c.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, ''))
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

/** Fallback for when the model doesn't return valid JSON: treat first line as the subject. */
function fallbackFromRawText(raw) {
  const firstLine = raw
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  const cleaned = firstLine.replace(/^["'`]+|["'`]+$/g, '');
  return { message: cleaned, breaking: false };
}

async function generateMessageForDiffText(diffText, label) {
  const diff = truncateDiff(diffText, MAX_DIFF);
  console.log(`\nGenerating commit message for ${label} with ${MODEL}...`);

  let raw;
  try {
    raw = await callOllama(buildPrompt(diff));
  } catch (err) {
    die(err.message);
  }

  const parsed = parseModelJson(raw);
  const result = parsed ? formatCommitMessage(parsed) : fallbackFromRawText(raw);

  if (!result || !result.message) {
    die('Model returned an empty or unparseable message. Try again or check OCOLITE_MODEL.');
  }

  console.log('——————————————————');
  console.log(result.message);
  console.log('——————————————————');
  if (result.breaking) {
    console.log('⚠ marked as a BREAKING CHANGE');
  }

  return result.message;
}

async function generateMessageFor(pathspec, label) {
  return generateMessageForDiffText(getStagedDiff(pathspec), label);
}

/** Open `message` in $GIT_EDITOR/$EDITOR for editing; returns the edited text, or the original if the editor fails or leaves it empty. */
function editMessageInEditor(message) {
  const editor = process.env.GIT_EDITOR || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
  const tmpFile = path.join(os.tmpdir(), `oco-lite-msg-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmpFile, message, 'utf8');

  try {
    const result = spawnSync(`${editor} ${JSON.stringify(tmpFile)}`, { stdio: 'inherit', shell: true });
    if (result.error || result.status !== 0) {
      console.warn(`Editor "${editor}" did not exit cleanly; keeping the previous message.`);
      return message;
    }
    const edited = fs.readFileSync(tmpFile, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
    return edited.trim() ? edited : message;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Prompt for confirmation, allowing "e" to edit the message in $EDITOR first
 * (looping back to the same prompt with the edited text). Returns the final
 * { proceed, message }.
 */
async function confirmWithEdit(question, message) {
  if (autoYes) return { proceed: true, message };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  let current = message;
  try {
    for (;;) {
      const answer = (await ask(question)).trim();
      if (/^e(dit)?$/i.test(answer)) {
        current = editMessageInEditor(current);
        console.log('——————————————————');
        console.log(current);
        console.log('——————————————————');
        continue;
      }
      return { proceed: /^y(es)?$/i.test(answer), message: current };
    }
  } finally {
    rl.close();
  }
}

function commitWithMessage(message, pathspec) {
  const args = pathspec ? ['commit', '-m', message, '--', pathspec] : ['commit', '-m', message];
  try {
    execFileSync('git', args, { stdio: 'inherit' });
  } catch {
    die(`git commit failed${pathspec ? ` for ${pathspec}` : ''}.`);
  }
}

async function runSingleMode() {
  const files = getStagedFiles();
  console.log(`Staged files (${files.length}):`);
  files.forEach((f) => console.log(`  ${f}`));

  const message = await generateMessageFor(null, 'all staged changes');
  if (!shouldCommit) return;

  const { proceed, message: finalMessage } = await confirmWithEdit('\nCommit with this message? [y/N/e] ', message);
  if (!proceed) return console.log('Aborted. Nothing committed.');
  commitWithMessage(finalMessage, null);
}

/** Strict one-commit-per-staged-file mode, with no relatedness detection. */
async function runStrictSplitMode(files) {
  files = files || getStagedFiles();
  if (files.length === 0) die('No staged files found.');

  console.log(`Splitting into ${files.length} commit(s), one per staged file:\n`);

  for (const file of files) {
    const message = await generateMessageFor(file, file);
    if (!shouldCommit) continue;

    const { proceed, message: finalMessage } = await confirmWithEdit(`Commit "${file}" with this message? [y/N/e] `, message);
    if (!proceed) {
      console.log(`Skipped ${file}. It remains staged.`);
      continue;
    }
    commitWithMessage(finalMessage, file);
  }
  console.log('\nDone.');
}

/**
 * Sends all staged files' diffs to the model in one request and asks it to
 * cluster files that implement the same logical change into groups, so a
 * related edit spread across several files becomes one commit instead of
 * several. Each group gets its own breaking-change assessment.
 *
 * Returns true if a valid grouping was found and handled (printed, and
 * committed if --commit/-y was passed), or false if the model's response
 * didn't parse into a valid grouping — the caller decides the fallback.
 */
async function runGroupedCommitFlow(files) {
  const fileEntries = files.map((path) => ({
    path,
    diff: truncateDiff(getStagedDiff(path), GROUP_MAX_DIFF_PER_FILE),
  }));

  console.log(`Analyzing ${files.length} staged files for related changes with ${MODEL}...`);

  let raw;
  try {
    raw = await callOllama(buildGroupingPrompt(fileEntries));
  } catch (err) {
    die(err.message);
  }

  const groups = parseGroupingResult(raw, files);
  if (!groups) return false;

  console.log(`\nDetected ${groups.length} logical group(s):\n`);
  groups.forEach((g, i) => {
    console.log(`Group ${i + 1}: ${g.files.join(', ')}`);
    console.log('——————————————————');
    console.log(g.message);
    console.log('——————————————————');
    if (g.breaking) console.log('⚠ marked as a BREAKING CHANGE');
    console.log('');
  });

  if (!shouldCommit) return true;

  for (const g of groups) {
    const { proceed, message: finalMessage } = await confirmWithEdit(
      `Commit group [${g.files.join(', ')}] with the above message? [y/N/e] `,
      g.message
    );
    if (!proceed) {
      console.log(`Skipped group [${g.files.join(', ')}]. Files remain staged.`);
      continue;
    }
    execFileSync('git', ['commit', '-m', finalMessage, '--', ...g.files], { stdio: 'inherit' });
  }
  console.log('\nDone.');
  return true;
}

/**
 * Default --split behavior: detect related files across everything staged
 * and merge them into one commit each, falling back to a strict
 * one-commit-per-file split for files with no detected relationship (or
 * entirely, if the model's grouping response doesn't parse). Pass
 * --no-group-detection to skip relatedness detection and always get the old
 * strict one-commit-per-file behavior.
 */
async function runSplitMode() {
  const files = getStagedFiles();
  if (files.length === 0) die('No staged files found.');

  if (files.length === 1 || args.includes('--no-group-detection')) {
    return runStrictSplitMode(files);
  }

  console.log(`Checking ${files.length} staged files for related changes before splitting...\n`);
  const grouped = await runGroupedCommitFlow(files);
  if (!grouped) {
    console.warn('Could not detect related groups from the model. Falling back to one commit per file.');
    return runStrictSplitMode(files);
  }
}

async function runSplitHunksMode() {
  const fileDiffs = getFileDiffs();
  if (fileDiffs.length === 0) die('No staged changes found.');

  console.log(
    dryRun
      ? `Previewing logical (per-hunk) commits across ${fileDiffs.length} file(s) — nothing will be staged or committed:\n`
      : `Splitting into logical (per-hunk) commits across ${fileDiffs.length} file(s):\n`
  );

  if (!dryRun) execSync('git reset', { stdio: 'ignore' });

  for (const fileDiff of fileDiffs) {
    const filePath = extractPathFromFileDiff(fileDiff);
    if (!filePath) {
      console.warn('Could not determine file path for a diff chunk, skipping.');
      continue;
    }

    const parsed = parseFileDiffIntoHunks(fileDiff);

    if (!parsed || parsed.hunks.length <= 1) {
      const message = await generateMessageForDiffText(fileDiff, filePath);
      if (dryRun) continue;

      execSync(`git add -- ${JSON.stringify(filePath)}`, { stdio: 'ignore' });
      if (shouldCommit) {
        const { proceed, message: finalMessage } = await confirmWithEdit(`Commit "${filePath}" with this message? [y/N/e] `, message);
        if (proceed) commitWithMessage(finalMessage, filePath);
        else console.log(`Skipped ${filePath}.`);
      }
      continue;
    }

    console.log(`\n${filePath}: ${parsed.hunks.length} hunk(s) detected`);

    for (let i = 0; i < parsed.hunks.length; i++) {
      const patch = `${parsed.header}\n${parsed.hunks[i]}\n`;
      const label = `${filePath} (hunk ${i + 1}/${parsed.hunks.length})`;

      if (dryRun) {
        await generateMessageForDiffText(patch, label);
        continue;
      }

      try {
        execSync('git apply --cached --whitespace=nowarn -', { input: patch });
      } catch {
        console.warn(
          `  Hunk ${i + 1} failed to apply cleanly (context conflict). ` +
            `Falling back to committing the remaining changes in ${filePath} as one commit.`
        );
        execSync(`git add -- ${JSON.stringify(filePath)}`, { stdio: 'ignore' });
        const message = await generateMessageFor(null, `${filePath} (remaining changes)`);
        if (shouldCommit) {
          const { proceed, message: finalMessage } = await confirmWithEdit(`Commit remaining "${filePath}" changes? [y/N/e] `, message);
          if (proceed) commitWithMessage(finalMessage, filePath);
        }
        break;
      }

      const message = await generateMessageFor(null, label);
      if (!shouldCommit) continue;

      const { proceed, message: finalMessage } = await confirmWithEdit(`Commit this hunk of "${filePath}"? [y/N/e] `, message);
      if (!proceed) {
        console.log(`  Skipped hunk ${i + 1}. It remains staged — commit or reset it manually.`);
        continue;
      }
      commitWithMessage(finalMessage, filePath);
    }
  }
  console.log(dryRun ? '\nDry run complete. Nothing was staged or committed.' : '\nDone.');
}

/** Explicit alias of the --split default: always attempts grouping (never a strict-split fallback). */
async function runGroupMode() {
  const files = getStagedFiles();
  if (files.length === 0) die('No staged files found.');

  if (files.length === 1) {
    console.log('Only one staged file — nothing to group, falling back to single-file mode.');
    return runSingleMode();
  }

  const grouped = await runGroupedCommitFlow(files);
  if (!grouped) {
    console.warn('Could not parse a valid grouping from the model. Falling back to one commit per file.');
    return runStrictSplitMode(files);
  }
}

async function main() {
  if (helpRequested) return printHelp();

  if (dryRun && !splitHunksMode) {
    console.warn('--dry-run is only supported with --split-hunks; ignoring.');
  }

  assertGitRepo();
  await assertOllamaReachable();

  if (splitHunksMode) await runSplitHunksMode();
  else if (groupMode) await runGroupMode();
  else if (splitMode) await runSplitMode();
  else await runSingleMode();
}

process.on('unhandledRejection', (err) => {
  console.error('Unexpected error:', err?.message || err);
  process.exit(1);
});

main();
