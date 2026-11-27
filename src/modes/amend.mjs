import chalk from 'chalk';
import {
  getStagedFiles,
  getLastCommitMessage,
  getLastCommitDiff,
  isCommitPublished,
  amendCommitMessage,
  resolveCommit,
} from '../git.mjs';
import { generateMessageForDiffText } from '../generate.mjs';
import { confirmWithEdit } from '../ui.mjs';
import { autoYes, hookForce } from '../cli-args.mjs';
import { die } from '../die.mjs';

/**
 * `--amend`: regenerates the commit message of HEAD from its own diff, shows
 * the usual review menu (edit, change type, regenerate, …) and rewrites only
 * the message. It refuses when changes are staged (an amend would fold them
 * in), and treats a commit that is already on a remote as published history:
 * you must confirm in the menu, or pass `--force` together with `-y`.
 */
export async function runAmendMode() {
  if (!resolveCommit('HEAD')) die('There are no commits to amend yet.');
  if (getStagedFiles().length > 0) {
    die('You have staged changes; amending would fold them into HEAD. Commit or unstage them first — --amend only rewrites the message.');
  }

  const published = isCommitPublished('HEAD');
  if (published && autoYes && !hookForce) {
    die('HEAD is already on a remote branch, so amending rewrites published history (and needs a force-push). Pass --force with -y to do it anyway.');
  }

  console.log(chalk.dim('Current message:'));
  console.log(chalk.dim('——————————————————'));
  console.log(getLastCommitMessage());
  console.log(chalk.dim('——————————————————'));
  if (published) {
    console.warn(chalk.yellow('⚠ HEAD is already on a remote branch; amending it will require a force-push.'));
  }

  const diff = getLastCommitDiff();
  const message = await generateMessageForDiffText(diff, 'HEAD');
  const { proceed, message: finalMessage } = await confirmWithEdit('\nAmend HEAD with this message?', message, {
    regenerate: (feedback) => generateMessageForDiffText(diff, 'HEAD', feedback),
  });
  if (!proceed) return console.log('Aborted. HEAD is unchanged.');

  amendCommitMessage(finalMessage);
}
