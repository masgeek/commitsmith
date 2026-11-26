import { getStagedFiles, commitWithMessage } from '../git.mjs';
import { generateMessageFor } from '../generate.mjs';
import { confirmWithEdit } from '../ui.mjs';
import { shouldCommit } from '../cli-args.mjs';

export async function runSingleMode() {
  const files = getStagedFiles();
  console.log(`Staged files (${files.length}):`);
  files.forEach((f) => console.log(`  ${f}`));

  const label = 'all staged changes';
  const message = await generateMessageFor(null, label);
  if (!shouldCommit) return;

  const { proceed, message: finalMessage } = await confirmWithEdit('\nCommit with this message?', message, {
    regenerate: (feedback) => generateMessageFor(null, label, feedback),
  });
  if (!proceed) return console.log('Aborted. Nothing committed.');
  commitWithMessage(finalMessage, null);
}
