import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { loadConfig } from '../config.mjs';
import {
  getCurrentBranch,
  getDefaultBranch,
  getCommitsForRewrite,
  getCommitDiff,
  isCommitPublished,
  resolveCommit,
  rewriteMessages,
  moveBranchSafely,
} from '../git.mjs';
import { lintCommitMessage } from '../conventional.mjs';
import { generateMessageForDiffText } from '../generate.mjs';
import { isInteractive } from '../tty.mjs';
import { releaseNotesFromRef, rewordAll, hookForce, autoYes } from '../cli-args.mjs';
import { die } from '../die.mjs';

export const MAX_REWORD = 50;

const TRAILER = /^(Co-authored-by|Signed-off-by|Reviewed-by|Acked-by|Refs|Closes|Fixes):\s*\S/i;

/** Appends the original message's attribution/ticket trailers that the new message lacks, so rewording never drops them. */
export function keepTrailers(oldMessage, newMessage) {
  const have = new Set(newMessage.split('\n').map((l) => l.trim().toLowerCase()));
  const missing = oldMessage
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => TRAILER.test(l) && !have.has(l.toLowerCase()));
  return missing.length === 0 ? newMessage : `${newMessage.replace(/\s+$/, '')}\n\n${[...new Set(missing)].join('\n')}`;
}

/** Commits whose message breaks the rules (all of them with `all`). */
export function selectRewordTargets(commits, rules, all = false) {
  return all ? commits : commits.filter((c) => lintCommitMessage(c.message, rules).length > 0);
}

/** A rewrite needs a plain chain: every commit has exactly one parent and the next commit's parent is the previous commit. */
export function isLinearChain(commits) {
  return commits.every((c, i) => c.parents.length === 1 && (i === 0 || c.parents[0] === commits[i - 1].sha));
}

/**
 * `--reword [--from <ref>] [--all] [-y] [--force]`: rewrites the messages of
 * the commits on this branch that don't pass the commit rules (every commit
 * with --all), by regenerating each from its own diff — before the branch is
 * merged. The range is <default branch>..HEAD, or --from <ref>..HEAD. File
 * contents never change (commits are re-created on the same trees, authors and
 * dates kept); the old tip is saved under refs/commitsmith/backup/. Preview
 * unless -y or you confirm. Commits already on the remote need --force.
 */
export async function runRewordMode() {
  const branch = getCurrentBranch();
  if (!branch) die('Detached HEAD: check out the branch whose commits you want to reword.');

  let baseRef = releaseNotesFromRef;
  if (baseRef) {
    if (!resolveCommit(baseRef)) die(`--from: "${baseRef}" is not a valid ref in this repo.`);
  } else {
    const def = getDefaultBranch();
    if (!def) die('Could not determine the default branch. Pass --from <ref>.');
    if (def === branch) die(`You are on "${def}". Switch to a feature branch, or pass --from <ref> to choose where the range starts.`);
    baseRef = resolveCommit(`origin/${def}`) ? `origin/${def}` : def;
  }

  const commits = getCommitsForRewrite(baseRef);
  if (commits.length === 0) return console.log(`No commits in ${baseRef}..HEAD.`);
  if (!isLinearChain(commits)) die(`${baseRef}..HEAD contains merge commits (or is not a straight line). Rebase the branch first, or pick a narrower --from.`);
  if (commits.length > MAX_REWORD) die(`${commits.length} commits is a lot to reword at once (limit ${MAX_REWORD}). Narrow the range with --from <ref>.`);

  const { RULES } = await loadConfig();
  const targets = selectRewordTargets(commits, RULES, rewordAll);
  if (targets.length === 0) return console.log(chalk.green(`✅ All ${commits.length} commit message(s) in ${baseRef}..HEAD already follow the rules.`));

  const published = isCommitPublished(commits[0].sha);
  console.log(`${targets.length} of ${commits.length} commit(s) in ${baseRef}..HEAD ${rewordAll ? 'will be reworded' : 'break the commit rules'}:\n`);

  const messages = new Map();
  for (const c of targets) {
    const oldSubject = c.message.split('\n')[0];
    console.log(chalk.bold(`${c.sha.slice(0, 7)}  ${oldSubject}`));
    const generated = await generateMessageForDiffText(getCommitDiff(c.sha), c.sha.slice(0, 7));
    messages.set(c.sha, keepTrailers(c.message, generated));
  }

  if (published) {
    console.warn(chalk.yellow('\n⚠ Some of these commits are already on a remote branch; rewording them needs a force-push.'));
  }

  if (!autoYes) {
    if (!isInteractive()) return console.log('\nPreview only. Re-run with -y to rewrite these messages.');
    const go = await clack.confirm({ message: `Rewrite ${targets.length} commit message(s)? Their hashes will change.`, initialValue: false });
    if (clack.isCancel(go) || !go) return console.log('Aborted. Nothing changed.');
  }
  if (published && !hookForce) die('Those commits are already pushed; pass --force to rewrite them anyway.');

  const oldTip = commits[commits.length - 1].sha;
  const newTip = rewriteMessages(commits, messages, commits[0].parents[0]);
  const backup = `refs/commitsmith/backup/${branch}-${Date.now()}`;
  moveBranchSafely(branch, oldTip, newTip, backup);

  console.log(chalk.green(`\n✔ Reworded ${targets.length} commit(s) on ${branch}. File contents are unchanged.`));
  console.log(chalk.dim(`Undo with: git reset --hard ${backup}`));
  if (published) console.log(chalk.dim(`Publish with: git push --force-with-lease origin ${branch}`));
}
