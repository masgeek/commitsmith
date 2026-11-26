import fs from 'node:fs';
import { loadConfig } from '../config.mjs';
import { getBaseTag, getReleaseCommits, getReleaseNotesDiff, resolveCommit, truncateDiff } from '../git.mjs';
import { buildReleaseNotesPrompt, buildTranslationPrompt } from '../prompts.mjs';
import { parseReleaseNotes, limitReleaseNotes, formatReleaseNotes } from '../parsing.mjs';
import { callModel } from '../providers/index.mjs';
import { copyToClipboard } from '../clipboard.mjs';
import { STORE_PRESETS } from '../constants.mjs';
import {
  releaseNotesFromRef,
  releaseNotesBranch,
  releaseNotesMaxChars,
  releaseNotesCopy,
  releaseNotesOutput,
  releaseNotesStore,
  releaseNotesLangs,
} from '../cli-args.mjs';
import { die } from '../die.mjs';
import {
  pickReleaseRange,
  pickStorePreset,
  promptLanguages,
  reviewNotes,
  chooseOutputAction,
} from './release-notes-interactive.mjs';

/**
 * Resolves and validates the ref range and gathers the model input. Pure git
 * (plus the range picker when interactive), no network — cli.mjs runs it
 * *before* the provider reachability check so a bad ref or missing tag fails
 * fast.
 */
export async function prepareReleaseNotes({ interactive = false } = {}) {
  const { MAX_DIFF } = await loadConfig();

  let from = releaseNotesFromRef;
  let branch = releaseNotesBranch;
  if (interactive && !from && !branch) ({ from, branch } = await pickReleaseRange());

  const targetRef = branch || 'HEAD';
  if (!resolveCommit(targetRef)) die(`--branch: "${targetRef}" is not a valid ref in this repo.`);

  let baseRef = from;
  if (baseRef) {
    if (!resolveCommit(baseRef)) die(`--from: "${baseRef}" is not a valid ref in this repo.`);
  } else {
    baseRef = getBaseTag(targetRef);
    if (!baseRef) {
      die(`No release-notes base ref found: no git tag reachable from "${targetRef}". Pass --from <ref> (e.g. --from v1.0.0).`);
    }
  }

  const commits = getReleaseCommits(baseRef, targetRef);
  const diff = truncateDiff(getReleaseNotesDiff(baseRef, targetRef), MAX_DIFF);
  if (commits.length === 0 && !diff.trim()) {
    die(`No changes between "${baseRef}" and "${targetRef}" — nothing to summarize.`);
  }

  const commitsText = truncateDiff(
    commits
      .map(({ subject, body }) => {
        const detail = body.replace(/\s+/g, ' ').slice(0, 200);
        return detail ? `- ${subject} (${detail})` : `- ${subject}`;
      })
      .join('\n'),
    MAX_DIFF
  );

  return { baseRef, targetRef, commitsText, diff };
}

/** --max-chars wins, then --store, then (interactive) a prompt; otherwise no limit. */
async function resolveMaxChars(interactive) {
  if (releaseNotesMaxChars) return releaseNotesMaxChars;
  if (releaseNotesStore) return STORE_PRESETS[releaseNotesStore].maxChars;
  return interactive ? pickStorePreset() : null;
}

/** Renders one language section, trimming to maxChars and warning on stderr. */
function fitSection(notes, maxChars, label) {
  const { notes: kept, fits } = limitReleaseNotes(notes, maxChars);
  const tag = label ? ` [${label}]` : '';
  if (kept.length < notes.length) {
    console.error(`(dropped ${notes.length - kept.length} note(s)${tag} to fit ${maxChars} chars)`);
  }
  if (!fits) console.error(`Warning${tag}: the shortest note still exceeds ${maxChars} chars.`);
  return formatReleaseNotes(kept);
}

/**
 * Prints user-facing release notes for the prepared range, for pasting into
 * store consoles (Play Store, App Store, etc.). Read-only: never touches the
 * index or history. Bullets go to stdout; everything else to stderr, so
 * `commitsmith --release-notes > notes.txt` yields just the notes. When
 * `interactive`, offers store presets, review/edit/regenerate, extra
 * languages, and an output menu.
 */
export async function runReleaseNotesMode({ baseRef, targetRef, commitsText, diff }, { interactive = false } = {}) {
  const { RELEASE_NOTES_CONTEXT } = await loadConfig();
  const maxChars = await resolveMaxChars(interactive);

  console.error(`Release notes for changes since ${baseRef} (compared against ${targetRef}):\n`);

  async function generate(feedback = '') {
    let raw;
    try {
      raw = await callModel(
        buildReleaseNotesPrompt({ commitsText, diff, context: RELEASE_NOTES_CONTEXT, maxChars, feedback }),
        `release notes for ${baseRef}`
      );
    } catch (err) {
      die(err.message);
    }
    const parsed = parseReleaseNotes(raw);
    if (!parsed) die('Model returned empty release notes. Try again or check COMMITSMITH_MODEL.');
    return parsed;
  }

  let notes = await generate();
  if (interactive) notes = await reviewNotes(notes, generate);

  const languages = releaseNotesLangs.length > 0 ? releaseNotesLangs : interactive ? await promptLanguages() : [];

  const sections = [{ label: languages.length > 0 ? 'en' : null, text: fitSection(notes, maxChars, languages.length > 0 ? 'en' : null) }];
  for (const language of languages) {
    let translated;
    try {
      translated = parseReleaseNotes(await callModel(buildTranslationPrompt(notes, language), `${language} translation`));
    } catch (err) {
      console.error(`Skipping ${language}: ${err.message}`);
      continue;
    }
    if (!translated) {
      console.error(`Skipping ${language}: the model returned nothing usable.`);
      continue;
    }
    sections.push({ label: language, text: fitSection(translated, maxChars, language) });
  }

  const text = sections.length === 1 && !sections[0].label ? sections[0].text : sections.map((s) => `[${s.label}]\n${s.text}`).join('\n\n');

  let copy = releaseNotesCopy;
  let file = releaseNotesOutput;
  if (interactive && !copy && !file) ({ copy, file } = await chooseOutputAction());

  console.log(text);

  if (file) {
    try {
      fs.writeFileSync(file, `${text}\n`, 'utf8');
      console.error(`\nSaved to ${file}.`);
    } catch (err) {
      console.error(`\nCould not write ${file}: ${err.message}`);
    }
  }
  if (copy) console.error(copyToClipboard(text) ? '\nCopied to clipboard.' : '\nCould not copy: no clipboard tool found.');
}
