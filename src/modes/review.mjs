import chalk from 'chalk';
import { splitFileDiffs, extractPathFromFileDiff, getBranchDiff, truncateDiff } from '../git.mjs';
import { buildReviewPrompt } from '../prompts.mjs';
import { parseReviewResult, mergeReviewResults, exceedsSeverity } from '../parsing.mjs';
import { callModel } from '../providers/index.mjs';
import { failOn } from '../cli-args.mjs';
import { die } from '../die.mjs';
import { prepareBreakingInput, MAX_BREAKING_FILES } from './breaking.mjs';

/**
 * Picks what to review (`--from <ref> [--branch <ref>]`, else staged, else
 * unstaged) and validates it before any network call. Ranges include tests —
 * only lockfiles are left out — because missing tests are part of a review.
 */
export function prepareReviewInput() {
  return prepareBreakingInput({ flag: '--review', rangeDiff: getBranchDiff });
}

const ICON = { high: chalk.red('● high  '), medium: chalk.yellow('● medium'), low: chalk.blue('● low   ') };

async function review(diff, label) {
  let raw;
  try {
    raw = await callModel(buildReviewPrompt(diff), label);
  } catch (err) {
    die(err.message);
  }
  return parseReviewResult(raw);
}

/**
 * `--review`: asks the model for a code review of the changes — real problems
 * ranked high/medium/low, plus behavior with no test coverage — and prints it.
 * Read-only: never touches the index, files or history. Exit code: 1 when a
 * finding reaches `--fail-on <level>` (default: never), 2 when part of the
 * answer couldn't be parsed.
 */
export async function runReviewMode({ source, diff, maxDiff }) {
  let units;
  if (diff.length <= maxDiff) {
    units = [{ label: 'all changes', diff }];
  } else {
    const files = splitFileDiffs(diff);
    units = files.slice(0, MAX_BREAKING_FILES).map((fileDiff) => ({
      label: extractPathFromFileDiff(fileDiff) || 'file',
      diff: truncateDiff(fileDiff, maxDiff),
    }));
    if (files.length > units.length) {
      console.log(chalk.yellow(`(${files.length} files changed; reviewing the first ${MAX_BREAKING_FILES} — narrow the range to cover the rest)`));
    }
  }

  console.log(`Reviewing ${source} (${units.length} request${units.length === 1 ? '' : 's'})...\n`);

  const results = [];
  const unparsed = [];
  for (const unit of units) {
    const result = await review(unit.diff, `review: ${unit.label}`.slice(0, 70));
    if (result) results.push(result);
    else unparsed.push(unit.label);
  }

  const merged = mergeReviewResults(results);

  if (merged.summary) console.log(`${merged.summary}\n`);

  if (merged.findings.length === 0) {
    if (results.length > 0) console.log(chalk.green('✅ No problems found.'));
  } else {
    console.log(chalk.bold(`${merged.findings.length} finding(s):\n`));
    for (const f of merged.findings) {
      const where = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '';
      console.log(`${ICON[f.severity]} ${where ? `${chalk.bold(where)} — ` : ''}${f.title}`);
      if (f.detail) console.log(`   ${f.detail}`);
      if (f.suggestion) console.log(`   ${chalk.dim('fix:')} ${f.suggestion}`);
      console.log('');
    }
  }

  if (merged.missingTests.length > 0) {
    console.log(chalk.bold('Missing test coverage:'));
    merged.missingTests.forEach((t) => console.log(`  - ${t}`));
  }

  if (unparsed.length > 0) {
    console.log(chalk.yellow(`\nCould not parse the model's answer for: ${unparsed.join(', ')}. Try again or check COMMITSMITH_MODEL.`));
  }

  if (exceedsSeverity(merged.findings, failOn)) process.exitCode = 1;
  else if (unparsed.length > 0 && merged.findings.length === 0) process.exitCode = 2;
}
