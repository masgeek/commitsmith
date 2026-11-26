import chalk from 'chalk';
import { loadConfig } from '../config.mjs';
import {
  getStagedFiles,
  getStagedDiff,
  getWorkingTreeDiff,
  getReleaseNotesDiff,
  splitFileDiffs,
  extractPathFromFileDiff,
  resolveCommit,
  truncateDiff,
} from '../git.mjs';
import { buildBreakingPrompt } from '../prompts.mjs';
import { parseBreakingResult, mergeBreakingResults, breakingFooter } from '../parsing.mjs';
import { callModel } from '../providers/index.mjs';
import { releaseNotesFromRef, releaseNotesBranch } from '../cli-args.mjs';
import { die } from '../die.mjs';

/** Per-file analysis makes one model call per file; cap the cost and say so. */
export const MAX_BREAKING_FILES = 30;

/**
 * Picks what to analyze and validates it before any network call:
 * `--from <ref> [--branch <ref>]` → that range; otherwise the staged changes;
 * otherwise (nothing staged) the unstaged working-tree changes.
 * Returns { source, diff, maxDiff }.
 */
export async function prepareBreakingInput() {
  const { MAX_DIFF } = await loadConfig();

  if (releaseNotesFromRef) {
    const targetRef = releaseNotesBranch || 'HEAD';
    if (!resolveCommit(targetRef)) die(`--branch: "${targetRef}" is not a valid ref in this repo.`);
    if (!resolveCommit(releaseNotesFromRef)) die(`--from: "${releaseNotesFromRef}" is not a valid ref in this repo.`);
    const diff = getReleaseNotesDiff(releaseNotesFromRef, targetRef);
    if (!diff.trim()) die(`No changes between "${releaseNotesFromRef}" and "${targetRef}" — nothing to analyze.`);
    return { source: `${releaseNotesFromRef}..${targetRef}`, diff, maxDiff: MAX_DIFF };
  }
  if (releaseNotesBranch) die('--branch needs --from with --breaking (it sets the end of the range to analyze).');

  if (getStagedFiles().length > 0) {
    return { source: 'staged changes', diff: getStagedDiff(null), maxDiff: MAX_DIFF };
  }
  const diff = getWorkingTreeDiff();
  if (!diff.trim()) {
    die('Nothing to analyze: no staged or unstaged changes. Use --from <ref> to analyze a range of commits.');
  }
  return { source: 'unstaged working-tree changes', diff, maxDiff: MAX_DIFF };
}

async function analyze(diff, label) {
  let raw;
  try {
    raw = await callModel(buildBreakingPrompt(diff), label);
  } catch (err) {
    die(err.message);
  }
  return parseBreakingResult(raw);
}

/**
 * Dry run: asks the model whether the changes contain breaking changes and
 * prints each finding plus a ready-to-paste "BREAKING CHANGE:" footer. Never
 * writes a commit message, touches the index, or changes history. Exit code:
 * 1 if breaking changes were found, 2 if part of the analysis couldn't be
 * parsed (so a gate never passes silently), 0 otherwise.
 */
export async function runBreakingMode({ source, diff, maxDiff }) {
  // One call when everything fits the diff budget; otherwise one per file so
  // nothing past the truncation point goes unreviewed.
  let units;
  if (diff.length <= maxDiff) {
    units = [{ label: 'all changes', diff }];
  } else {
    const files = splitFileDiffs(diff);
    units = files.slice(0, MAX_BREAKING_FILES).map((fileDiff) => {
      const path = extractPathFromFileDiff(fileDiff) || 'file';
      return { label: path, diff: truncateDiff(fileDiff, maxDiff) };
    });
    if (files.length > units.length) {
      console.log(chalk.yellow(`(${files.length} files changed; analyzing the first ${MAX_BREAKING_FILES} — narrow the range to cover the rest)`));
    }
  }

  console.log(`Checking ${source} for breaking changes (${units.length} request${units.length === 1 ? '' : 's'})...\n`);

  const results = [];
  const unparsed = [];
  for (const unit of units) {
    const result = await analyze(unit.diff, `breaking-change review: ${unit.label}`.slice(0, 70));
    if (result) results.push(result);
    else unparsed.push(unit.label);
  }

  const merged = mergeBreakingResults(results);

  if (merged.breaking) {
    console.log(chalk.yellow(`⚠ ${merged.findings.length} breaking change(s) found:\n`));
    merged.findings.forEach((f, i) => {
      console.log(`${i + 1}. ${f.file ? chalk.bold(f.file) + ' — ' : ''}${f.what}`);
      if (f.impact) console.log(`   impact: ${f.impact}`);
    });
    console.log(`\nSuggested commit footer:\n  ${breakingFooter(merged.findings)}`);
    process.exitCode = 1;
  } else if (unparsed.length === 0) {
    console.log(chalk.green('✅ No breaking changes detected.'));
  }

  if (unparsed.length > 0) {
    console.log(chalk.yellow(`\nCould not parse the model's answer for: ${unparsed.join(', ')}. Try again or check COMMITSMITH_MODEL.`));
    if (!merged.breaking) process.exitCode = 2;
  }
}
