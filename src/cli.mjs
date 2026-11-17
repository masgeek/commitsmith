import { helpRequested, initMode, useMode, dryRun, splitHunksMode, groupMode, splitMode, checkMode } from './cli-args.mjs';
import { printHelp } from './ui.mjs';
import { assertGitRepo } from './git.mjs';
import { assertProviderReachable } from './providers/index.mjs';
import { runInitMode } from './modes/init.mjs';
import { runUseMode } from './modes/use.mjs';
import { runSplitHunksMode } from './modes/split-hunks.mjs';
import { runGroupMode } from './modes/group.mjs';
import { runSplitMode } from './modes/split.mjs';
import { runSingleMode } from './modes/single.mjs';
import { runCheckMode } from './modes/check.mjs';

export async function run() {
  if (helpRequested) return printHelp();
  if (initMode) return runInitMode();
  if (useMode) return runUseMode();

  assertGitRepo();
  await assertProviderReachable();

  if (checkMode) return runCheckMode();

  if (dryRun && !splitHunksMode) {
    console.warn('--dry-run is only supported with --split-hunks; ignoring.');
  }

  if (splitHunksMode) await runSplitHunksMode();
  else if (groupMode) await runGroupMode();
  else if (splitMode) await runSplitMode();
  else await runSingleMode();
}
