import * as clack from '@clack/prompts';
import chalk from 'chalk';
import {
  getStagedFiles,
  getStagedZeroContextDiff,
  blameRange,
  listCommitsBrief,
  resolveCommit,
  getDefaultBranch,
  getLastTag,
  isStrictAncestor,
  commitFixup,
  autosquashFrom,
} from '../git.mjs';
import { isInteractive } from '../tty.mjs';
import { autoYes, autosquash } from '../cli-args.mjs';
import { die } from '../die.mjs';

const MAX_RANGES = 200;

/**
 * Old-side line ranges touched by a zero-context staged diff, as
 * { file, start, count }[]. Pure insertions are attributed to the line they
 * follow (that is the code they extend); brand-new files have no old lines.
 */
export function parseHunkRanges(diffText) {
  const ranges = [];
  let file = null;
  for (const line of String(diffText ?? '').split('\n')) {
    if (line.startsWith('--- ')) {
      file = line === '--- /dev/null' ? null : line.replace(/^--- a\//, '');
    } else if (line.startsWith('@@') && file) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+/);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (count > 0) ranges.push({ file, start, count });
      else if (start > 0) ranges.push({ file, start, count: 1 });
    }
  }
  return ranges;
}

const ZERO_SHA = /^0{40}$/;

/** The commit sha behind every line of `git blame --porcelain` output (uncommitted lines skipped). */
export function parseBlameShas(porcelain) {
  const shas = [];
  for (const line of String(porcelain ?? '').split('\n')) {
    const m = line.match(/^([0-9a-f]{40}) \d+ \d+/);
    if (m && !ZERO_SHA.test(m[1])) shas.push(m[1]);
  }
  return shas;
}

/** Counts blamed lines per commit and ranks them most-touched first: { sha, lines }[]. Only shas in `allowed` (when given) count. */
export function rankCandidates(shas, allowed = null) {
  const counts = new Map();
  for (const sha of shas) {
    if (allowed && !allowed.has(sha)) continue;
    counts.set(sha, (counts.get(sha) ?? 0) + 1);
  }
  return [...counts].map(([sha, lines]) => ({ sha, lines })).sort((a, b) => b.lines - a.lines);
}

/**
 * The ref below which commits count as already shared or released: the
 * upstream (else origin/<default branch>) or the last version tag, whichever
 * is newer; null when there is neither (whole history).
 */
function sharedBase() {
  const def = getDefaultBranch();
  const remote = resolveCommit('@{upstream}') ? '@{upstream}' : def && resolveCommit(`origin/${def}`) ? `origin/${def}` : null;
  const tag = getLastTag('HEAD');
  if (remote && tag) return isStrictAncestor(remote, tag) ? tag : remote;
  return remote || tag || null;
}

/**
 * `--fixup [--autosquash] [-y]`: finds the earlier, not-yet-pushed commit that
 * the staged changes belong to (`git blame` on the lines they change, ranked by
 * how many lines each commit owns) and records them as a `fixup!` commit for
 * it. --autosquash then folds it in with a non-interactive rebase. No model.
 */
export async function runFixupMode() {
  if (getStagedFiles().length === 0) die('Nothing staged. Stage the follow-up change with `git add` first.');
  if (!resolveCommit('HEAD')) die('There are no commits to fix up yet.');

  const ranges = parseHunkRanges(getStagedZeroContextDiff());
  if (ranges.length === 0) die('The staged changes only add new files or lines with nothing before them — there is no earlier commit to attribute them to.');

  const shas = ranges.slice(0, MAX_RANGES).flatMap((r) => parseBlameShas(blameRange(r.file, r.start, r.count)));
  const own = listCommitsBrief(sharedBase());
  const subjects = new Map(own.map((c) => [c.sha, c.subject]));
  const candidates = rankCandidates(shas, new Set(subjects.keys()));

  if (candidates.length === 0) {
    const touched = rankCandidates(shas).length;
    die(
      touched > 0
        ? 'The lines you changed belong to commits that are already pushed or released (tagged); a fixup would rewrite shared history. Make a normal commit instead.'
        : 'Could not blame the changed lines (new or untracked code?).'
    );
  }

  const total = candidates.reduce((n, c) => n + c.lines, 0);
  console.log('Staged changes touch lines from:\n');
  candidates.slice(0, 5).forEach((c, i) => {
    const pct = Math.round((c.lines / total) * 100);
    console.log(`  ${i === 0 ? '→' : ' '} ${c.sha.slice(0, 7)}  ${subjects.get(c.sha)}  ${chalk.dim(`(${pct}% of touched lines)`)}`);
  });
  console.log();

  let target = candidates[0];
  if (!autoYes) {
    if (!isInteractive()) return console.log(`Suggested: git commit --fixup=${target.sha.slice(0, 7)}  (re-run with -y to do it)`);
    const pick = await clack.select({
      message: 'Fix up which commit?',
      options: [
        ...candidates.slice(0, 5).map((c) => ({ value: c.sha, label: `${c.sha.slice(0, 7)} ${subjects.get(c.sha)}` })),
        { value: null, label: 'Cancel' },
      ],
      initialValue: target.sha,
    });
    if (clack.isCancel(pick) || !pick) return console.log('Aborted. Nothing committed.');
    target = candidates.find((c) => c.sha === pick);
  }

  commitFixup(target.sha);
  if (autosquash) {
    autosquashFrom(target.sha);
    console.log(chalk.green(`\n✔ Folded into ${target.sha.slice(0, 7)}.`));
  } else {
    console.log(chalk.dim(`\nFold it in later with: git rebase -i --autosquash ${target.sha.slice(0, 7)}^   (or re-run with --autosquash)`));
  }
}
