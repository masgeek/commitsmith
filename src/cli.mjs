import {
  args,
  helpRequested,
  helpCommand,
  versionRequested,
  initMode,
  initGithubMode,
  useMode,
  dryRun,
  splitHunksMode,
  groupMode,
  splitMode,
  checkMode,
  breakingMode,
  prMode,
  prFlagsUsed,
  scanMode,
  bumpMode,
  changelogMode,
  hookMode,
  amendMode,
  reviewMode,
  doctorMode,
  releaseMode,
  releaseTagsMode,
  fixupMode,
  rewordMode,
  standupMode,
  lintCommitsMode,
  lintMessageFile,
  scopedFlagGroups,
  releaseNotesMode,
  releaseNotesArgErrors,
  releaseNotesFlagsUsed,
  bareInvocation,
  applyFileConfigToArgs,
} from './cli-args.mjs';
import { loadConfig } from './config.mjs';
import { printVersion } from './ui.mjs';
import { printHelp } from './help.mjs';
import { assertGitRepo, getStagedFiles } from './git.mjs';
import { die } from './die.mjs';
import { isInteractive } from './tty.mjs';
import { assertProviderReachable } from './providers/index.mjs';
import { runInitMode } from './modes/init.mjs';
import { runInitGithubMode } from './modes/init-github.mjs';
import { runUseMode } from './modes/use.mjs';
import { runSplitHunksMode } from './modes/split-hunks.mjs';
import { runGroupMode } from './modes/group.mjs';
import { runSplitMode } from './modes/split.mjs';
import { runSingleMode } from './modes/single.mjs';
import { runBreakingMode, prepareBreakingInput } from './modes/breaking.mjs';
import { runPullRequestMode, preparePullRequest } from './modes/pull-request.mjs';
import { runCheckMode, prepareCheckRange } from './modes/check.mjs';
import { prepareReleaseNotes, runReleaseNotesMode } from './modes/release-notes.mjs';
import { runScanMode, runLintMessageMode, runLintCommitsMode } from './modes/scan.mjs';
import { runReleaseMode } from './modes/release.mjs';
import { runReleaseTagsMode } from './modes/release-tags.mjs';
import { runFixupMode } from './modes/fixup.mjs';
import { runRewordMode } from './modes/reword.mjs';
import { runStandupMode } from './modes/standup.mjs';
import { runBumpMode } from './modes/bump.mjs';
import { runChangelogMode } from './modes/changelog.mjs';
import { runHookMode } from './modes/hook.mjs';
import { runAmendMode } from './modes/amend.mjs';
import { runReviewMode, prepareReviewInput } from './modes/review.mjs';
import { runDoctorMode } from './modes/doctor.mjs';
import { maybeInteractiveStage, maybeInteractivePickRunOptions } from './modes/interactive-stage.mjs';

/** Warns about flags that only apply to a mode that wasn't selected. */
function warnStrayFlags() {
  // --from/--branch select the range for check, breaking, bump, changelog, release, reword and lint-commits;
  // --output also names the changelog file; --copy works with --standup.
  const rangeModes = checkMode || breakingMode || bumpMode || changelogMode || reviewMode || releaseMode || releaseTagsMode || rewordMode || lintCommitsMode;
  const strayFlags = releaseNotesFlagsUsed.filter(
    (f) =>
      !(rangeModes && (f === '--from' || f === '--branch')) &&
      !((changelogMode || releaseMode) && f === '--output') &&
      !(standupMode && f === '--copy')
  );
  if (!releaseNotesMode && strayFlags.length > 0) {
    console.warn(`${strayFlags.join(', ')} only apply with --release-notes; ignoring.`);
  }
  // --release also takes --draft and --as-bot (for the GitHub Release).
  const strayPr = prFlagsUsed.filter((f) => !((releaseMode || releaseTagsMode || bumpMode) && (f === '--draft' || f === '--as-bot')));
  if (!prMode && strayPr.length > 0) {
    console.warn(`${strayPr.join(', ')} only apply with --pr; ignoring.`);
  }
  for (const { mode, active, used } of scopedFlagGroups) {
    if (!active && used.length > 0) console.warn(`${used.join(', ')} only apply with ${mode}; ignoring.`);
  }
}

export async function run() {
  if (helpRequested || helpCommand) return printHelp(args);
  if (versionRequested) return printVersion();
  if (initGithubMode) return runInitGithubMode();
  if (initMode) return runInitMode();
  if (useMode) return runUseMode();

  if (releaseNotesArgErrors.length > 0) die(releaseNotesArgErrors.join('\n'));

  // Offline modes: no model, no provider, and — importantly for git hooks that
  // run on every commit — no config or keychain lookup at all.
  if (hookMode || scanMode || lintMessageFile || lintCommitsMode || bumpMode || changelogMode || fixupMode) {
    warnStrayFlags();
    assertGitRepo();
    if (hookMode) return runHookMode();
    if (scanMode) return runScanMode();
    if (lintMessageFile) return runLintMessageMode(lintMessageFile);
    if (lintCommitsMode) return runLintCommitsMode();
    if (bumpMode) return runBumpMode();
    if (fixupMode) return runFixupMode();
    return runChangelogMode();
  }

  const { fileConfig } = await loadConfig();
  applyFileConfigToArgs(fileConfig);

  warnStrayFlags();

  if (doctorMode) return runDoctorMode(); // works outside a git repo too

  assertGitRepo();
  if (releaseMode) return runReleaseMode(); // git + optional gh; no model
  if (releaseTagsMode) return runReleaseTagsMode(); // git + gh; no model
  // Validate refs before the (network) provider check so bad input fails fast.
  const releaseNotesInput = releaseNotesMode ? await prepareReleaseNotes({ interactive: isInteractive() }) : null;
  const checkRange = checkMode ? prepareCheckRange() : null;
  const breakingInput = breakingMode ? await prepareBreakingInput() : null;
  const prInput = prMode ? await preparePullRequest() : null;
  const reviewInput = reviewMode ? await prepareReviewInput() : null;
  await assertProviderReachable();

  if (amendMode) return runAmendMode();
  if (rewordMode) return runRewordMode();
  if (standupMode) return runStandupMode();
  if (reviewInput) return runReviewMode(reviewInput);
  if (prInput) return runPullRequestMode(prInput, { interactive: isInteractive() });
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
