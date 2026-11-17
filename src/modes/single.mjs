import { getStagedFiles, commitWithMessage } from '../git.mjs';
import { generateMessageFor } from '../generate.mjs';
import { confirmWithEdit } from '../ui.mjs';
import { shouldCommit } from '../cli-args.mjs';

export async function runSingleMode() {
  const files = getStagedFiles();
  console.log(`Staged files (${files.length}):`);
  files.forEach((f) => console.log(`  ${f}`));

  const message = await generateMessageFor(null, 'all staged changes');
  if (!shouldCommit) return;

  const { proceed, message: finalMessage } = await confirmWithEdit('\nCommit with this message? [y/N/e] ', message);
  if (!proceed) return console.log('Aborted. Nothing committed.');
  commitWithMessage(finalMessage, null);
}
