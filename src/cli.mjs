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
import { runCheckMode } from './modes/check.mjs';
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
  if (!releaseNotesMode && releaseNotesFlagsUsed.length > 0) {
    console.warn(`${releaseNotesFlagsUsed.join(', ')} only apply with --release-notes; ignoring.`);
  }

  assertGitRepo();
  // Validate refs before the (network) provider check so bad input fails fast.
  const releaseNotesInput = releaseNotesMode ? await prepareReleaseNotes({ interactive: isInteractive() }) : null;
  await assertProviderReachable();

  if (checkMode) return runCheckMode();
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
