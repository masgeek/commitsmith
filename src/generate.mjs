import chalk from 'chalk';
import { loadConfig } from './config.mjs';
import { breakingDetectionEnabled } from './cli-args.mjs';
import { getStagedDiff, truncateDiff } from './git.mjs';
import { buildPrompt, buildBreakingPrompt } from './prompts.mjs';
import {
  parseModelJson,
  formatCommitMessage,
  fallbackFromRawText,
  parseBreakingResult,
  breakingReason,
  retypeMessage,
  isBreakingMessage,
} from './parsing.mjs';
import { callModel } from './providers/index.mjs';
import { die } from './die.mjs';

/**
 * Second opinion on breaking changes. The commit-message prompt classifies
 * conservatively and can miss one, so when a message isn't already flagged we
 * run the focused breaking-change review (same one as `--breaking`) on the
 * same diff. If it finds something, the message gets the 💥 header and a
 * `BREAKING CHANGE: …` footer. A failed review never blocks the commit flow.
 * Returns { message, breaking }. No-op when breaking detection is off.
 */
export async function addBreakingFooterIfNeeded(message, diff, label) {
  if (!breakingDetectionEnabled) return { message, breaking: false };
  if (isBreakingMessage(message)) return { message, breaking: true };

  let review;
  try {
    review = parseBreakingResult(await callModel(buildBreakingPrompt(diff), `breaking-change review: ${label}`.slice(0, 70)));
  } catch (err) {
    console.warn(`Skipping the breaking-change review (${err.message}).`);
    return { message, breaking: false };
  }
  if (!review?.breaking) return { message, breaking: false };

  const reason = breakingReason(review.findings);
  const retyped = retypeMessage(message, { breaking: true, breakingReason: reason });
  // retypeMessage leaves headers it can't parse (e.g. a raw-text fallback) alone.
  return { message: retyped === message ? `${message}\n\nBREAKING CHANGE: ${reason}` : retyped, breaking: true };
}

export async function generateMessageForDiffText(diffText, label, feedback = '') {
  const { MAX_DIFF } = await loadConfig();
  const diff = truncateDiff(diffText, MAX_DIFF);
  console.log();

  let raw;
  try {
    raw = await callModel(buildPrompt(diff, feedback), `commit message for ${label}`);
  } catch (err) {
    die(err.message);
  }

  const parsed = parseModelJson(raw);
  const result = parsed ? formatCommitMessage(parsed, breakingDetectionEnabled) : fallbackFromRawText(raw);

  if (!result || !result.message) {
    die('Model returned an empty or unparseable message. Try again or check COMMITSMITH_MODEL.');
  }

  const { message, breaking } = await addBreakingFooterIfNeeded(result.message, diff, label);

  console.log(chalk.dim('——————————————————'));
  console.log(message);
  console.log(chalk.dim('——————————————————'));
  if (breaking) {
    console.log(chalk.yellow('⚠ marked as a BREAKING CHANGE'));
  }

  return message;
}

export async function generateMessageFor(pathspec, label, feedback = '') {
  return generateMessageForDiffText(getStagedDiff(pathspec), label, feedback);
}
