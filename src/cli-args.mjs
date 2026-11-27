import { STORE_PRESETS } from './constants.mjs';

export const args = process.argv.slice(2);
export const noInteractive = args.includes('--no-interactive');
export const noSecretGuard = args.includes('--no-secret-guard');
export const forceInteractive = args.includes('--interactive');
export const initMode = args[0] === 'init';
export const initGithubMode = args[0] === 'init' && args[1] === 'github';
export const useMode = args[0] === 'use';
export let shouldCommit = args.includes('--commit') || args.includes('-y');
export let autoYes = args.includes('-y');
export let splitMode = args.includes('--split');
export let splitHunksMode = args.includes('--split-hunks');
export let groupMode = args.includes('--group');
export let dryRun = args.includes('--dry-run');
export const checkMode = args.includes('--check');
export const breakingMode = args.includes('--breaking');
export const noGitmoji = args.includes('--no-gitmoji');
export const amendMode = args.includes('--amend');
export const reviewMode = args.includes('--review');
export const doctorMode = args[0] === 'doctor';
export const scanMode = args.includes('--scan');
export const bumpMode = args.includes('--bump');
export const bumpApply = args.includes('--apply');
export const bumpTag = args.includes('--tag');
export const changelogMode = args.includes('--changelog');
export const changelogAll = args.includes('--all');
export const changelogUnreleasedOnly = args.includes('--unreleased');
export const changelogRebuild = args.includes('--rebuild');
export const changelogStdout = args.includes('--stdout');
export const hookMode = args[0] === 'hook';
export const hookAction = hookMode ? (args[1] ?? 'status') : null;
export const hookPrePush = args.includes('--pre-push');
export const hookForce = args.includes('--force');
export const prMode = args.includes('--pr');
export const prDraft = args.includes('--draft');
export const prCreate = args.includes('--create');
export const prAsBot = args.includes('--as-bot');
export const releaseNotesMode = args.includes('--release-notes');
export const noStyleHint = args.includes('--no-style');
export const noScopeHint = args.includes('--no-scope-hint');
export const noWarnings = args.includes('--no-warnings');
export const releaseMode = args.includes('--release');
export const releasePush = args.includes('--push');
export const releaseGithub = args.includes('--github');
export const noChangelog = args.includes('--no-changelog');
export const fixupMode = args.includes('--fixup');
export const autosquash = args.includes('--autosquash');
export const rewordMode = args.includes('--reword');
export const rewordAll = args.includes('--all');
export const standupMode = args.includes('--standup');
export const standupAllBranches = args.includes('--all-branches');
export const lintCommitsMode = args.includes('--lint-commits');

/** Reads `--name value` or `--name=value` from argv. Null when absent; throws when the value is missing. */
export function flagValue(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === name) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) throw new Error(`${name} requires a value.`);
      return next;
    }
    if (arg.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1);
      if (!value) throw new Error(`${name} requires a value.`);
      return value;
    }
  }
  return null;
}

export const releaseNotesArgErrors = [];
function readFlag(name) {
  try {
    return flagValue(args, name);
  } catch (err) {
    releaseNotesArgErrors.push(err.message);
    return null;
  }
}
export const releaseNotesFromRef = readFlag('--from');
export const releaseNotesBranch = readFlag('--branch');
const maxCharsRaw = readFlag('--max-chars');
const maxCharsValid = maxCharsRaw !== null && /^[1-9]\d*$/.test(maxCharsRaw);
if (maxCharsRaw !== null && !maxCharsValid) releaseNotesArgErrors.push('--max-chars must be a positive integer.');
export const releaseNotesMaxChars = maxCharsValid ? Number(maxCharsRaw) : null;
export const releaseNotesCopy = args.includes('--copy');
export const releaseNotesOutput = readFlag('--output');
const storeRaw = readFlag('--store');
if (storeRaw !== null && !Object.hasOwn(STORE_PRESETS, storeRaw)) {
  releaseNotesArgErrors.push(`--store must be one of: ${Object.keys(STORE_PRESETS).join(', ')}.`);
}
export const releaseNotesStore = storeRaw !== null && Object.hasOwn(STORE_PRESETS, storeRaw) ? storeRaw : null;
const langRaw = readFlag('--lang');
export const releaseNotesLangs = langRaw
  ? langRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
export const prBase = readFlag('--base');
export const lintMessageFile = readFlag('--lint-message');
export const standupSince = readFlag('--since');
export const standupAuthor = readFlag('--author');
export const releaseVersion = readFlag('--release-version');
const failOnRaw = readFlag('--fail-on');
if (failOnRaw !== null && !['high', 'medium', 'low'].includes(failOnRaw)) {
  releaseNotesArgErrors.push('--fail-on must be one of: high, medium, low.');
}
/** Lowest review severity that makes `--review` exit 1 (null = never). */
export const failOn = ['high', 'medium', 'low'].includes(failOnRaw) ? failOnRaw : null;
/** Flags that only make sense with one mode, as [mode flag, [its flags]] — cli.mjs warns when they appear alone. */
export const scopedFlagGroups = [
  ['--bump', ['--apply', '--tag'], bumpMode],
  ['--changelog', ['--unreleased', '--rebuild', '--stdout'], changelogMode],
  ['--changelog or --reword', ['--all'], changelogMode || rewordMode],
  ['--changelog or --release', ['--release-version'], changelogMode || releaseMode],
  ['--release', ['--push', '--github', '--no-changelog'], releaseMode],
  ['--fixup', ['--autosquash'], fixupMode],
  ['--standup', ['--since', '--author', '--all-branches'], standupMode],
  ['hook', ['--pre-push'], hookMode],
  ['hook, --amend or --reword', ['--force'], hookMode || amendMode || rewordMode],
  ['--review', ['--fail-on'], reviewMode],
].map(([mode, flags, active]) => ({ mode, active, used: flags.filter((f) => args.some((a) => a === f || a.startsWith(`${f}=`))) }));
/** Pull-request-only flags on the command line (to warn when used without --pr). */
export const prFlagsUsed = ['--base', '--draft', '--create', '--as-bot'].filter((f) => args.some((a) => a === f || a.startsWith(`${f}=`)));
/** Release-notes-only flags on the command line (to warn when used without --release-notes). */
export const releaseNotesFlagsUsed = ['--from', '--branch', '--max-chars', '--copy', '--output', '--store', '--lang'].filter((f) =>
  args.some((a) => a === f || a.startsWith(`${f}=`))
);
export const noGroupDetection = args.includes('--no-group-detection');
export let breakingDetectionEnabled = !args.includes('--no-breaking-detection');
export const helpCommand = args[0] === 'help';
export const helpRequested =args.includes('--help') || args.includes('-h');
export const versionRequested = args.includes('--version') || args.includes('-v');

// True when nothing on the command line selects a mode or commit behavior —
// the plain `commitsmith` invocation. Used to decide whether, on top of an
// interactive staging prompt (see modes/interactive-stage.mjs), we also ask
// the user which mode/commit behavior to run, instead of silently defaulting.
export const bareInvocation =
  !shouldCommit && !splitMode && !splitHunksMode && !groupMode && !dryRun && !checkMode && !breakingMode && !prMode && !releaseNotesMode && !scanMode && !bumpMode && !changelogMode && !lintMessageFile && !hookMode && !amendMode && !reviewMode && !doctorMode && !releaseMode && !fixupMode && !rewordMode && !standupMode && !lintCommitsMode;

/** Applies the config file's `breakingDetection: false`, once config.mjs's loadConfig() has resolved it. */
export function applyFileConfigToArgs(fileConfig) {
  if (fileConfig.breakingDetection === false) breakingDetectionEnabled = false;
}

/**
 * Lets modes/interactive-stage.mjs set the mode/commit behavior chosen in its
 * prompts after the fact. cli.mjs's dispatch reads the exports above as live
 * ESM bindings, so mutating them here is visible to every importer.
 */
export function setRunOptions({ mode, shouldCommit: sc, autoYes: ay } = {}) {
  if (mode !== undefined) {
    splitMode = mode === 'split';
    splitHunksMode = mode === 'split-hunks';
    groupMode = mode === 'group';
  }
  if (sc !== undefined) shouldCommit = sc;
  if (ay !== undefined) {
    autoYes = ay;
    if (ay) shouldCommit = true;
  }
}
