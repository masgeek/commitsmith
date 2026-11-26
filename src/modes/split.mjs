import { getStagedFiles, commitWithMessage } from '../git.mjs';
import { generateMessageFor } from '../generate.mjs';
import { confirmWithEdit } from '../ui.mjs';
import { shouldCommit, noGroupDetection } from '../cli-args.mjs';
import { die } from '../die.mjs';
import { runGroupedCommitFlow } from './group.mjs';

/** Strict one-commit-per-staged-file mode, with no relatedness detection. */
export async function runStrictSplitMode(files) {
  files = files || getStagedFiles();
  if (files.length === 0) die('No staged files found.');

  console.log(`Splitting into ${files.length} commit(s), one per staged file:\n`);

  for (const file of files) {
    const message = await generateMessageFor(file, file);
    if (!shouldCommit) continue;

    const { proceed, message: finalMessage } = await confirmWithEdit(`Commit "${file}" with this message?`, message, {
      regenerate: (feedback) => generateMessageFor(file, file, feedback),
    });
    if (!proceed) {
      console.log(`Skipped ${file}. It remains staged.`);
      continue;
    }
    commitWithMessage(finalMessage, file);
  }
  console.log('\nDone.');
}

/**
 * Default --split behavior: detect related files across everything staged
 * and merge them into one commit each, falling back to a strict
 * one-commit-per-file split for files with no detected relationship (or
 * entirely, if the model's grouping response doesn't parse). Pass
 * --no-group-detection to skip relatedness detection and always get the old
 * strict one-commit-per-file behavior.
 */
export async function runSplitMode() {
  const files = getStagedFiles();
  if (files.length === 0) die('No staged files found.');

  if (files.length === 1 || noGroupDetection) {
    return runStrictSplitMode(files);
  }

  console.log(`Checking ${files.length} staged files for related changes before splitting...\n`);
  const grouped = await runGroupedCommitFlow(files);
  if (!grouped) {
    console.warn('Could not detect related groups from the model. Falling back to one commit per file.');
    return runStrictSplitMode(files);
  }
}
