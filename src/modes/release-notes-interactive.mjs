import fs from 'node:fs';
import * as clack from '@clack/prompts';
import { listTags, listBranches, getBaseTag } from '../git.mjs';
import { STORE_PRESETS } from '../constants.mjs';
import { loadPrefs, savePrefs } from '../prefs.mjs';
import { formatReleaseNotes } from '../parsing.mjs';

/** Release notes are read-only, so cancelling any prompt just exits cleanly. */
function unlessCancelled(value) {
  if (clack.isCancel(value)) {
    clack.cancel('Cancelled.');
    process.exit(0);
  }
  return value;
}

const OTHER = '__other__';

async function pickRef(message, options, initialValue) {
  const choice = unlessCancelled(
    await clack.select({ message, options: [...options, { value: OTHER, label: 'Other (type a ref)' }], initialValue })
  );
  if (choice !== OTHER) return choice;
  return unlessCancelled(await clack.text({ message: 'Ref (tag, branch or commit)', validate: (v) => (v?.trim() ? undefined : 'Required') })).trim();
}

/**
 * Asks which range to summarize. Returns { from, branch }; nulls mean "use the
 * defaults" (last tag → HEAD), which is what the first option picks.
 */
export async function pickReleaseRange() {
  const baseTag = getBaseTag('HEAD');
  const mode = unlessCancelled(
    await clack.select({
      message: 'Which changes should the notes cover?',
      options: [
        {
          value: 'default',
          label: baseTag ? `Since ${baseTag} → HEAD` : 'Choose a range (no tag found)',
          hint: baseTag ? 'default' : undefined,
        },
        { value: 'pick', label: 'Pick a range…' },
      ],
      initialValue: baseTag ? 'default' : 'pick',
    })
  );
  if (mode === 'default') return { from: null, branch: null };

  const tags = listTags();
  const branches = listBranches();
  const from = await pickRef(
    'From (base)',
    tags.map((t) => ({ value: t, label: t, hint: 'tag' })).concat(branches.map((b) => ({ value: b, label: b, hint: 'branch' }))),
    tags[0]
  );
  const branch = await pickRef(
    'To (target)',
    [{ value: 'HEAD', label: 'HEAD', hint: 'current checkout' }].concat(branches.map((b) => ({ value: b, label: b, hint: 'branch' }))),
    'HEAD'
  );
  return { from, branch: branch === 'HEAD' ? null : branch };
}

/** Asks for a destination preset (sets the character limit). Returns maxChars or null; remembers the choice. */
export async function pickStorePreset() {
  const prefs = loadPrefs();
  const options = [
    ...Object.entries(STORE_PRESETS).map(([value, p]) => ({
      value,
      label: p.label,
      hint: p.maxChars ? `${p.maxChars} chars` : 'no limit',
    })),
    { value: 'none', label: 'No limit' },
  ];
  const store = unlessCancelled(
    await clack.select({
      message: 'Where will these notes be pasted?',
      options,
      initialValue: options.some((o) => o.value === prefs.releaseStore) ? prefs.releaseStore : 'none',
    })
  );
  savePrefs({ releaseStore: store });
  return STORE_PRESETS[store]?.maxChars ?? null;
}

/** Asks for extra languages (comma-separated). Returns a list; remembers the answer. */
export async function promptLanguages() {
  const prefs = loadPrefs();
  const raw = unlessCancelled(
    await clack.text({
      message: 'Also generate in other languages? (comma-separated, blank for none)',
      placeholder: 'e.g. French, Swahili',
      defaultValue: '',
      initialValue: prefs.releaseLangs ?? '',
    })
  );
  savePrefs({ releaseLangs: raw.trim() });
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const PRESET_FEEDBACK = {
  shorter: 'Make the notes shorter and more concise; fewer, tighter bullets.',
  detailed: 'Make the notes more detailed and specific; a little longer is fine.',
};

/**
 * Review loop over the generated bullets: untick/edit bullets, regenerate
 * (optionally shorter, more detailed, or with a custom instruction). Feedback
 * accumulates across regenerations. Returns the approved notes.
 */
export async function reviewNotes(initial, regenerate) {
  let notes = initial;
  const feedback = [];

  for (;;) {
    console.error(`\n${formatReleaseNotes(notes)}\n`);
    const action = unlessCancelled(
      await clack.select({
        message: 'Release notes',
        options: [
          { value: 'ok', label: 'Looks good' },
          { value: 'edit', label: 'Untick or edit bullets' },
          { value: 'regen', label: 'Regenerate' },
          { value: 'shorter', label: 'Regenerate — shorter' },
          { value: 'detailed', label: 'Regenerate — more detailed' },
          { value: 'custom', label: 'Regenerate with an instruction…' },
        ],
        initialValue: 'ok',
      })
    );
    if (action === 'ok') return notes;

    if (action === 'edit') {
      const kept = unlessCancelled(
        await clack.multiselect({
          message: 'Keep these bullets',
          options: notes.map((n, i) => ({ value: i, label: n })),
          initialValues: notes.map((_, i) => i),
          required: true,
        })
      );
      notes = kept.map((i) => notes[i]);
      for (;;) {
        const which = unlessCancelled(
          await clack.select({
            message: 'Edit a bullet?',
            options: [{ value: -1, label: 'Done' }, ...notes.map((n, i) => ({ value: i, label: n }))],
            initialValue: -1,
          })
        );
        if (which === -1) break;
        const text = unlessCancelled(await clack.text({ message: 'Bullet text', initialValue: notes[which] }));
        if (text.trim()) notes[which] = text.trim();
      }
      continue;
    }

    if (action === 'custom') {
      const text = unlessCancelled(
        await clack.text({ message: 'Instruction for the model', placeholder: 'e.g. focus on the login changes, friendlier tone' })
      );
      if (text.trim()) feedback.push(text.trim());
    } else if (PRESET_FEEDBACK[action]) {
      feedback.push(PRESET_FEEDBACK[action]);
    }
    notes = await regenerate(feedback.join(' '));
  }
}

/** Asks what to do with the final text. Returns { copy, file } (file null = don't save). */
export async function chooseOutputAction() {
  const action = unlessCancelled(
    await clack.select({
      message: 'What next?',
      options: [
        { value: 'print', label: 'Print only' },
        { value: 'copy', label: 'Print and copy to clipboard' },
        { value: 'save', label: 'Print and save to a file' },
      ],
      initialValue: 'print',
    })
  );
  if (action !== 'save') return { copy: action === 'copy', file: null };

  const file = unlessCancelled(await clack.text({ message: 'File path', initialValue: 'RELEASE_NOTES.md' })).trim() || 'RELEASE_NOTES.md';
  if (fs.existsSync(file)) {
    const overwrite = unlessCancelled(await clack.confirm({ message: `${file} exists. Overwrite?`, initialValue: false }));
    if (!overwrite) return { copy: false, file: null };
  }
  return { copy: false, file };
}
