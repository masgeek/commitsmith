import {
  helpRequested,
  versionRequested,
  initMode,
  useMode,
  dryRun,
  splitHunksMode,
  groupMode,
  splitMode,
  checkMode,
  breakingMode,
  releaseNotesMode,
  releaseNotesArgErrors,
  releaseNotesFlagsUsed,
  bareInvocation,
  applyFileConfigToArgs,
} from './cli-args.mjs';
import { loadConfig } from './config.mjs';
import { printHelp, printVersion } from './ui.mjs';
import { assertGitRepo, getStagedFiles } from './git.mjs';
import { die } from './die.mjs';
import { isInteractive } from './tty.mjs';
import { assertProviderReachable } from './providers/index.mjs';
import { runInitMode } from './modes/init.mjs';
import { runUseMode } from './modes/use.mjs';
import { runSplitHunksMode } from './modes/split-hunks.mjs';
import { runGroupMode } from './modes/group.mjs';
import { runSplitMode } from './modes/split.mjs';
import { runSingleMode } from './modes/single.mjs';
import { runBreakingMode, prepareBreakingInput } from './modes/breaking.mjs';
import { runCheckMode, prepareCheckRange } from './modes/check.mjs';
import { prepareReleaseNotes, runReleaseNotesMode } from './modes/release-notes.mjs';
import { maybeInteractiveStage, maybeInteractivePickRunOptions } from './modes/interactive-stage.mjs';

export async function run() {
  if (helpRequested) return printHelp();
  if (versionRequested) return printVersion();
  if (initMode) return runInitMode();
  if (useMode) return runUseMode();

  const { fileConfig } = await loadConfig();
  applyFileConfigToArgs(fileConfig);

  if (releaseNotesArgErrors.length > 0) die(releaseNotesArgErrors.join('\n'));
  // --from/--branch also select the range for `--check` and `--breaking`.
  const strayFlags = releaseNotesFlagsUsed.filter(
    (f) => !((checkMode || breakingMode) && (f === '--from' || f === '--branch'))
  );
  if (!releaseNotesMode && strayFlags.length > 0) {
    console.warn(`${strayFlags.join(', ')} only apply with --release-notes; ignoring.`);
  }

  assertGitRepo();
  // Validate refs before the (network) provider check so bad input fails fast.
  const releaseNotesInput = releaseNotesMode ? await prepareReleaseNotes({ interactive: isInteractive() }) : null;
  const checkRange = checkMode ? prepareCheckRange() : null;
  const breakingInput = breakingMode ? await prepareBreakingInput() : null;
  await assertProviderReachable();

  if (breakingInput) return runBreakingMode(breakingInput);
  if (checkMode) return runCheckMode(checkRange);
  if (releaseNotesInput) return runReleaseNotesMode(releaseNotesInput, { interactive: isInteractive() });

  if (getStagedFiles().length === 0) {
    // No prompts without a real terminal (pipes, CI, --no-interactive): fail like before.
    if (!isInteractive()) die('No staged changes found. Run `git add <files>` first.');
    const wasBare = bareInvocation;
    const staged = await maybeInteractiveStage();
    if (!staged) die('No staged changes found. Run `git add <files>` first.');
    if (wasBare) {
      const picked = await maybeInteractivePickRunOptions();
      if (!picked) return;
    }
  }

  // These are live ESM bindings, so they already reflect any change made by
  // maybeInteractivePickRunOptions() above via cli-args.mjs's setRunOptions().
  if (dryRun && !splitHunksMode) {
    console.warn('--dry-run is only supported with --split-hunks; ignoring.');
  }

  if (splitHunksMode) await runSplitHunksMode();
  else if (groupMode) await runGroupMode();
  else if (splitMode) await runSplitMode();
  else await runSingleMode();
}
