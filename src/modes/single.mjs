import chalk from 'chalk';
import { loadConfig } from '../config.mjs';
import { getStagedFiles, getStagedNumstat, commitWithMessage } from '../git.mjs';
import { generateMessageFor, getWorkspaceRoots } from '../generate.mjs';
import { parseNumstat, analyzeStaged } from '../staged-check.mjs';
import { confirmWithEdit } from '../ui.mjs';
import { shouldCommit, noWarnings } from '../cli-args.mjs';

/** Advisory warnings (stderr) when the staged changes look too big or too mixed for one commit. */
async function printStagedWarnings() {
  const { DIFF_WARNINGS } = await loadConfig();
  if (!DIFF_WARNINGS || noWarnings) return;
  const warnings = analyzeStaged(parseNumstat(getStagedNumstat()), { workspaceRoots: getWorkspaceRoots() });
  for (const w of warnings) console.error(chalk.yellow(`⚠ ${w}`));
  if (warnings.length > 0) console.error(chalk.dim('(silence with --no-warnings or "diffWarnings": false)'));
}

export async function runSingleMode() {
  const files = getStagedFiles();
  console.log(`Staged files (${files.length}):`);
  files.forEach((f) => console.log(`  ${f}`));
  await printStagedWarnings();

  const label = 'all staged changes';
  const message = await generateMessageFor(null, label);
  if (!shouldCommit) return;

  const { proceed, message: finalMessage } = await confirmWithEdit('\nCommit with this message?', message, {
    regenerate: (feedback) => generateMessageFor(null, label, feedback),
  });
  if (!proceed) return console.log('Aborted. Nothing committed.');
  commitWithMessage(finalMessage, null);
}
