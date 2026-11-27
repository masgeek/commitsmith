import chalk from 'chalk';
import { loadConfig } from '../config.mjs';
import { getCommitsSince, getCurrentBranch, getUserEmail, getWorkingTreeChanges, truncateDiff } from '../git.mjs';
import { buildStandupPrompt } from '../prompts.mjs';
import { parseStandup, formatStandup, formatCommitsForPrompt } from '../parsing.mjs';
import { callModel } from '../providers/index.mjs';
import { copyToClipboard } from '../clipboard.mjs';
import { standupSince, standupAuthor, standupAllBranches, releaseNotesCopy } from '../cli-args.mjs';
import { die } from '../die.mjs';

/** Default look-back: since the last working day (Monday → 3 days, Sunday → 2, otherwise 1). */
export function defaultSince(now = new Date()) {
  const day = now.getDay();
  return day === 1 ? '3 days ago' : day === 0 ? '2 days ago' : '1 day ago';
}

/** Who to report on: --author <text> (substring of name/email), "all" for everyone, default = you (git user.email). */
export function resolveAuthor(flag, email) {
  if (flag && /^(all|\*)$/i.test(flag)) return '';
  return flag || email;
}

/**
 * `--standup [--since <when>] [--author <who|all>] [--all-branches] [--copy]`:
 * a short "Done / In progress" status update from your recent commits (all
 * local branches with --all-branches) and the files you have uncommitted.
 * `--since` takes anything git understands: "yesterday", "3 days ago",
 * "2026-01-15". The update goes to stdout; the header to stderr.
 */
export async function runStandupMode() {
  const { MAX_DIFF } = await loadConfig();
  const since = standupSince || defaultSince();
  const author = resolveAuthor(standupAuthor, getUserEmail());
  if (!author && !standupAuthor) die('No git user.email configured, so "you" is unknown. Pass --author <name> or --author all.');

  const commits = getCommitsSince({ since, author, allBranches: standupAllBranches });
  const wip = getWorkingTreeChanges().map((c) => c.file);
  if (commits.length === 0 && wip.length === 0) {
    return console.error(`No commits${author ? ` by ${author}` : ''} since ${since}, and nothing uncommitted.`);
  }

  console.error(chalk.dim(`Stand-up: ${commits.length} commit(s) since ${since}${author ? ` by ${author}` : ''}${wip.length > 0 ? `, ${wip.length} uncommitted file(s)` : ''}\n`));

  let raw;
  try {
    raw = await callModel(
      buildStandupPrompt({
        commitsText: truncateDiff(formatCommitsForPrompt(commits), MAX_DIFF),
        since,
        wipFiles: wip.slice(0, 30),
        branch: getCurrentBranch() ?? '',
      }),
      'stand-up update'
    );
  } catch (err) {
    die(err.message);
  }
  const standup = parseStandup(raw);
  if (!standup) die('Model returned an empty stand-up. Try again or check COMMITSMITH_MODEL.');

  const text = formatStandup(standup);
  console.log(text);
  if (releaseNotesCopy) console.error(copyToClipboard(text) ? '\nCopied to clipboard.' : '\nCould not copy: no clipboard tool found.');
}
