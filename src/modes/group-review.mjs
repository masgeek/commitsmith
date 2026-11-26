import * as clack from '@clack/prompts';
import chalk from 'chalk';
import { getStagedDiff } from '../git.mjs';
import { generateMessageForDiffText } from '../generate.mjs';
import { isBreakingMessage } from '../parsing.mjs';

/** Groups are { files: string[], message: string, breaking: boolean, stale?: boolean }. */
export function printGroups(groups) {
  groups.forEach((g, i) => {
    console.log(`Group ${i + 1}: ${g.files.join(', ')}`);
    console.log(chalk.dim('——————————————————'));
    console.log(g.message);
    console.log(chalk.dim('——————————————————'));
    if (g.breaking) console.log(chalk.yellow('⚠ marked as a BREAKING CHANGE'));
    console.log('');
  });
}

const dropEmpty = (groups) => groups.filter((g) => g.files.length > 0);

/** Moves `file` into group `toIndex` (or a new group when toIndex === 'new'). Pure; marks touched groups stale. */
export function moveFile(groups, file, toIndex) {
  const next = groups.map((g) => ({ ...g, files: [...g.files] }));
  const from = next.findIndex((g) => g.files.includes(file));
  if (from === -1 || from === toIndex) return groups;

  next[from].files = next[from].files.filter((f) => f !== file);
  next[from].stale = true;
  if (toIndex === 'new') {
    next.push({ files: [file], message: '', breaking: false, stale: true });
  } else {
    next[toIndex].files.push(file);
    next[toIndex].stale = true;
  }
  return dropEmpty(next);
}

/** Merges group `j` into group `i`. Pure; the merged group is marked stale. */
export function mergeGroups(groups, i, j) {
  if (i === j) return groups;
  const next = groups.map((g) => ({ ...g, files: [...g.files] }));
  next[i].files.push(...next[j].files);
  next[i].stale = true;
  next[j].files = [];
  return dropEmpty(next);
}

/** Regenerates the commit message of every stale group from its files' staged diff. */
async function refreshStale(groups) {
  for (const g of groups) {
    if (!g.stale) continue;
    g.message = await generateMessageForDiffText(getStagedDiff(g.files), g.files.join(', '));
    g.breaking = isBreakingMessage(g.message);
    delete g.stale;
  }
  return groups;
}

const groupLabel = (g, i) => `Group ${i + 1}: ${g.files.join(', ')}`;

/**
 * Lets the user adjust the model's grouping before committing: move a file to
 * another (or a new) group, or merge two groups. Messages of changed groups
 * are regenerated. Returns the final groups.
 */
export async function reviewGroups(groups) {
  let current = groups;
  for (;;) {
    const options = [
      { value: 'ok', label: 'Looks good — continue' },
      { value: 'move', label: 'Move a file to another group' },
      ...(current.length > 1 ? [{ value: 'merge', label: 'Merge two groups' }] : []),
    ];
    const action = await clack.select({ message: 'Review the groups', options, initialValue: 'ok' });
    if (clack.isCancel(action) || action === 'ok') return current;

    if (action === 'move') {
      const file = await clack.select({
        message: 'Which file?',
        options: current.flatMap((g, i) => g.files.map((f) => ({ value: f, label: f, hint: `group ${i + 1}` }))),
      });
      if (clack.isCancel(file)) continue;
      const to = await clack.select({
        message: `Move ${file} to`,
        options: [
          ...current.map((g, i) => ({ value: i, label: groupLabel(g, i) })),
          { value: 'new', label: 'A new group' },
        ],
      });
      if (clack.isCancel(to)) continue;
      current = moveFile(current, file, to);
    } else {
      const picked = await clack.multiselect({
        message: 'Pick exactly two groups to merge',
        options: current.map((g, i) => ({ value: i, label: groupLabel(g, i) })),
        required: true,
      });
      if (clack.isCancel(picked) || picked.length !== 2) {
        clack.log.warn('Select exactly two groups.');
        continue;
      }
      current = mergeGroups(current, picked[0], picked[1]);
    }

    current = await refreshStale(current);
    console.log('');
    printGroups(current);
  }
}
