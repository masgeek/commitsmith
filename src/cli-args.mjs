import { STORE_PRESETS } from './constants.mjs';

export const args = process.argv.slice(2);
export const noInteractive = args.includes('--no-interactive');
export const forceInteractive = args.includes('--interactive');
export const initMode = args[0] === 'init';
export const useMode = args[0] === 'use';
export let shouldCommit = args.includes('--commit') || args.includes('-y');
export let autoYes = args.includes('-y');
export let splitMode = args.includes('--split');
export let splitHunksMode = args.includes('--split-hunks');
export let groupMode = args.includes('--group');
export let dryRun = args.includes('--dry-run');
export const checkMode = args.includes('--check');
export const releaseNotesMode = args.includes('--release-notes');

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
/** Release-notes-only flags on the command line (to warn when used without --release-notes). */
export const releaseNotesFlagsUsed = ['--from', '--branch', '--max-chars', '--copy', '--output', '--store', '--lang'].filter((f) =>
  args.some((a) => a === f || a.startsWith(`${f}=`))
);
export const noGroupDetection = args.includes('--no-group-detection');
export let breakingDetectionEnabled = !args.includes('--no-breaking-detection');
export const helpRequested = args.includes('--help') || args.includes('-h');
export const versionRequested = args.includes('--version') || args.includes('-v');

// True when nothing on the command line selects a mode or commit behavior —
// the plain `commitsmith` invocation. Used to decide whether, on top of an
// interactive staging prompt (see modes/interactive-stage.mjs), we also ask
// the user which mode/commit behavior to run, instead of silently defaulting.
export const bareInvocation =
  !shouldCommit && !splitMode && !splitHunksMode && !groupMode && !dryRun && !checkMode && !releaseNotesMode;

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
