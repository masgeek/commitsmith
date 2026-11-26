import chalk from 'chalk';
import { loadConfig } from './config.mjs';
import { breakingDetectionEnabled, noGitmoji } from './cli-args.mjs';
import { getStagedDiff, getCurrentBranch, truncateDiff } from './git.mjs';
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
import { appendFooter, extractTicket, withTicketFooter } from './tickets.mjs';
import { callModel } from './providers/index.mjs';
import { die } from './die.mjs';

/** Commit rules from config, with the `--no-gitmoji` flag applied. */
export async function getEffectiveRules() {
  const { RULES } = await loadConfig();
  return { ...RULES, gitmoji: RULES.gitmoji && !noGitmoji };
}

let ticketNoted = false;

/**
 * Adds the "Refs: ABC-123" footer for the ticket named in the current branch
 * (`feature/ABC-123-login`, `feat/123-login` → `#123`), unless the message
 * already mentions it or `ticketLinks: false`. Returns the message unchanged
 * when the branch has no ticket.
 */
export async function addTicketFooter(message) {
  const { TICKETS } = await loadConfig();
  if (!TICKETS.enabled) return message;
  const ticket = extractTicket(getCurrentBranch(), TICKETS);
  if (!ticket) return message;
  if (!ticketNoted) {
    ticketNoted = true;
    console.error(chalk.dim(`Linking ticket ${ticket} from the branch name.`));
  }
  return withTicketFooter(message, ticket, TICKETS.footer);
}

/**
 * Second opinion on breaking changes. The commit-message prompt classifies
 * conservatively and can miss one, so when a message isn't already flagged we
 * run the focused breaking-change review (same one as `--breaking`) on the
 * same diff. If it finds something, the message gets the 💥 header (or `!`
 * without gitmoji) and a `BREAKING CHANGE: …` footer. A failed review never
 * blocks the commit flow. Returns { message, breaking }. No-op when breaking
 * detection is off.
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
  return { message: retyped === message ? appendFooter(message, `BREAKING CHANGE: ${reason}`) : retyped, breaking: true };
}

export async function generateMessageForDiffText(diffText, label, feedback = '') {
  const { MAX_DIFF } = await loadConfig();
  const rules = await getEffectiveRules();
  const diff = truncateDiff(diffText, MAX_DIFF);
  console.log();

  let raw;
  try {
    raw = await callModel(buildPrompt(diff, feedback, rules), `commit message for ${label}`);
  } catch (err) {
    die(err.message);
  }

  const parsed = parseModelJson(raw);
  const result = parsed ? formatCommitMessage(parsed, breakingDetectionEnabled, rules) : fallbackFromRawText(raw);

  if (!result || !result.message) {
    die('Model returned an empty or unparseable message. Try again or check COMMITSMITH_MODEL.');
  }

  const reviewed = await addBreakingFooterIfNeeded(result.message, diff, label);
  const message = await addTicketFooter(reviewed.message);
  const breaking = reviewed.breaking;

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
