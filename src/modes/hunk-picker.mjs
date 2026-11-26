import * as clack from '@clack/prompts';

/** One-line description of a hunk for pickers: its @@ header, +/- counts and first changed line. */
export function hunkSummary(hunk) {
  const lines = hunk.split('\n');
  const body = lines.slice(1);
  const add = body.filter((l) => l.startsWith('+')).length;
  const del = body.filter((l) => l.startsWith('-')).length;
  const firstChange = (body.find((l) => /^[+-]/.test(l)) ?? '').slice(0, 60);
  return { head: lines[0].slice(0, 60), add, del, firstChange };
}

/** Label for a batch of hunks (0-based indexes) of a file with `total` hunks. */
export function batchLabel(filePath, batch, total) {
  return batch.length === 1
    ? `${filePath} (hunk ${batch[0] + 1}/${total})`
    : `${filePath} (hunks ${batch.map((i) => i + 1).join(', ')}/${total})`;
}

const separate = (indexes) => indexes.map((i) => [i]);

function hunkOption(hunks, i) {
  const { head, add, del, firstChange } = hunkSummary(hunks[i]);
  return { value: i, label: `#${i + 1}  ${head}`, hint: `+${add} -${del}  ${firstChange}`.trim() };
}

/**
 * Decides how a file's hunks become commits. Returns an array of batches
 * (each an ascending array of 0-based hunk indexes; one commit per batch).
 * Non-interactive (or a single hunk): every hunk is its own batch — the
 * historical behavior. Interactive: pick which hunks to include (the rest
 * stay unstaged in the working tree), then commit them separately, together,
 * or in custom groups.
 */
export async function planHunkBatches(hunks, interactive) {
  const all = hunks.map((_, i) => i);
  if (!interactive || hunks.length <= 1) return separate(all);

  const selected = await clack.multiselect({
    message: 'Hunks to commit (unticked ones stay unstaged)',
    options: all.map((i) => hunkOption(hunks, i)),
    initialValues: all,
    required: false,
  });
  if (clack.isCancel(selected) || selected.length === 0) return [];
  if (selected.length === 1) return [selected];

  const layout = await clack.select({
    message: 'How should they be committed?',
    options: [
      { value: 'separate', label: 'One commit per hunk' },
      { value: 'together', label: 'One commit for all selected hunks' },
      { value: 'custom', label: 'Custom grouping…' },
    ],
    initialValue: 'separate',
  });
  if (clack.isCancel(layout) || layout === 'separate') return separate(selected);
  if (layout === 'together') return [[...selected].sort((a, b) => a - b)];

  const batches = [];
  let remaining = [...selected].sort((a, b) => a - b);
  while (remaining.length > 1) {
    const pick = await clack.multiselect({
      message: `Hunks for commit ${batches.length + 1} (the rest go to later commits)`,
      options: remaining.map((i) => hunkOption(hunks, i)),
      initialValues: [remaining[0]],
      required: true,
    });
    if (clack.isCancel(pick)) break;
    batches.push([...pick].sort((a, b) => a - b));
    remaining = remaining.filter((i) => !pick.includes(i));
  }
  return [...batches, ...separate(remaining)];
}
