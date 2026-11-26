import chalk from 'chalk';
import { loadConfig } from '../config.mjs';
import {
  getLastCommitMessage,
  getLastCommitDiff,
  getCommitMessage,
  getCommitDiff,
  listCommitShas,
  resolveCommit,
  truncateDiff,
} from '../git.mjs';
import { buildPrompt } from '../prompts.mjs';
import { parseModelJson } from '../parsing.mjs';
import { callModel } from '../providers/index.mjs';
import { ALLOWED_TYPES, BREAKING_GITMOJI } from '../constants.mjs';
import { releaseNotesFromRef, releaseNotesBranch } from '../cli-args.mjs';
import { die } from '../die.mjs';

/** Range scans make one model call per commit; cap the cost and say so. */
export const MAX_RANGE_COMMITS = 50;

/**
 * Compares a commit message with the model's classification of its diff and
 * returns a list of human-readable issues (empty = consistent). Pure, so the
 * rules are unit-testable without a model.
 */
export function findCommitIssues(message, parsed) {
  const issues = [];
  const expectedBreaking = parsed.breaking === true;
  const hasBreakingGitmoji = message.trimStart().startsWith(BREAKING_GITMOJI);
  const mentionsBreakingChange = /BREAKING CHANGE/i.test(message);

  if (expectedBreaking && !hasBreakingGitmoji && !mentionsBreakingChange) {
    issues.push(
      `Model classifies this diff as a BREAKING CHANGE (${parsed.breakingReason || 'no reason given'}), but the commit ` +
        `message doesn't flag it (no ${BREAKING_GITMOJI} or "BREAKING CHANGE" text).`
    );
  }
  if (!expectedBreaking && (hasBreakingGitmoji || mentionsBreakingChange)) {
    issues.push('The commit message flags a breaking change, but the model does not think this diff is breaking. Double check.');
  }

  const expectedType = ALLOWED_TYPES.has(parsed.type) ? parsed.type : null;
  if (expectedType) {
    const typeMatch = message.match(/^\S+\s+(\w+)(\([^)]*\))?:/);
    if (typeMatch && typeMatch[1] !== expectedType) {
      issues.push(`Model classifies this change as "${expectedType}", but the commit message uses type "${typeMatch[1]}".`);
    }
  }
  return issues;
}

async function classify(diff, label) {
  let raw;
  try {
    raw = await callModel(buildPrompt(diff), label);
  } catch (err) {
    die(err.message);
  }
  const parsed = parseModelJson(raw);
  if (!parsed) die('Model returned an unparseable classification. Try again or check COMMITSMITH_MODEL.');
  return parsed;
}

function printMessage(message) {
  console.log(chalk.dim('——————————————————'));
  console.log(message);
  console.log(chalk.dim('——————————————————'));
}

function printIssues(issues) {
  console.log(chalk.yellow(`⚠ ${issues.length} issue(s) found:\n`));
  issues.forEach((issue, i) => console.log(`${i + 1}. ${issue}`));
}

/**
 * Validates `--check --from <ref> [--branch <ref>]` before any network call.
 * Returns { baseRef, targetRef, shas } for a range scan, or null for the plain
 * HEAD check.
 */
export function prepareCheckRange() {
  if (!releaseNotesFromRef) {
    if (releaseNotesBranch) die('--branch needs --from with --check (it sets the end of the range to scan).');
    return null;
  }
  const targetRef = releaseNotesBranch || 'HEAD';
  if (!resolveCommit(targetRef)) die(`--branch: "${targetRef}" is not a valid ref in this repo.`);
  if (!resolveCommit(releaseNotesFromRef)) die(`--from: "${releaseNotesFromRef}" is not a valid ref in this repo.`);

  const shas = listCommitShas(releaseNotesFromRef, targetRef);
  if (shas.length === 0) die(`No commits between "${releaseNotesFromRef}" and "${targetRef}" — nothing to check.`);
  return { baseRef: releaseNotesFromRef, targetRef, shas };
}

/**
 * Re-classifies HEAD's diff — or, with `--from <ref>`, every non-merge commit
 * in the range — and warns when a commit message looks inconsistent with that
 * classification. Catches commits made by hand (bypassing commitsmith) that
 * miss a breaking-change flag or use a mismatched type. Read-only: never
 * touches the index or history. Exits non-zero if issues are found, so it's
 * usable as a CI/hook/pre-release gate.
 */
export async function runCheckMode(range = null) {
  if (range) return runRangeCheck(range);

  const { MAX_DIFF } = await loadConfig();
  const message = getLastCommitMessage();
  const diff = truncateDiff(getLastCommitDiff(), MAX_DIFF);

  console.log('Checking the last commit message against its diff...\n');
  console.log(chalk.dim('Current message:'));
  printMessage(message);
  console.log();

  const issues = findCommitIssues(message, await classify(diff, 'classification for HEAD'));
  if (issues.length === 0) {
    console.log(chalk.green('✅ No issues found — message looks consistent with the diff.'));
    return;
  }
  printIssues(issues);
  process.exitCode = 1;
}

async function runRangeCheck({ baseRef, targetRef, shas }) {
  const { MAX_DIFF } = await loadConfig();
  const selected = shas.slice(-MAX_RANGE_COMMITS); // newest N when the range is huge
  console.log(`Checking ${selected.length} commit(s) in ${baseRef}..${targetRef} against their diffs...`);
  if (selected.length < shas.length) {
    console.log(
      chalk.yellow(`(range has ${shas.length} commits; checking only the newest ${MAX_RANGE_COMMITS} — narrow --from to cover the rest)`)
    );
  }
  console.log();

  const failures = [];
  for (const sha of selected) {
    const message = getCommitMessage(sha);
    const subject = message.split('\n')[0];
    const parsed = await classify(truncateDiff(getCommitDiff(sha), MAX_DIFF), `${sha.slice(0, 7)} ${subject}`.slice(0, 70));
    const issues = findCommitIssues(message, parsed);
    if (issues.length === 0) {
      console.log(chalk.green(`✅ ${sha.slice(0, 7)} ${subject}`));
    } else {
      console.log(chalk.yellow(`⚠ ${sha.slice(0, 7)} ${subject}`));
      issues.forEach((issue) => console.log(`   - ${issue}`));
      failures.push(sha);
    }
  }

  console.log();
  if (failures.length === 0) {
    console.log(chalk.green(`✅ All ${selected.length} commit(s) look consistent.`));
    return;
  }
  console.log(chalk.yellow(`⚠ ${failures.length} of ${selected.length} commit(s) have issues.`));
  process.exitCode = 1;
}
