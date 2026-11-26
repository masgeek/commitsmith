import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeInteractive } from '../src/tty.mjs';
import { loadPrefs, savePrefs } from '../src/prefs.mjs';
import { retypeMessage, isBreakingMessage } from '../src/parsing.mjs';
import { moveFile, mergeGroups } from '../src/modes/group-review.mjs';
import { hunkSummary, batchLabel, planHunkBatches } from '../src/modes/hunk-picker.mjs';
import { buildPrompt, buildReleaseNotesPrompt, buildTranslationPrompt } from '../src/prompts.mjs';

test('computeInteractive: needs a TTY, no CI, no --no-interactive; --interactive overrides CI only', () => {
  assert.equal(computeInteractive({ isTTY: true }), true);
  assert.equal(computeInteractive({ isTTY: false }), false);
  assert.equal(computeInteractive({ isTTY: true, ci: 'true' }), false);
  assert.equal(computeInteractive({ isTTY: true, ci: 'false' }), true);
  assert.equal(computeInteractive({ isTTY: true, ci: 'true', force: true }), true);
  assert.equal(computeInteractive({ isTTY: false, force: true }), false);
  assert.equal(computeInteractive({ isTTY: true, noInteractive: true, force: true }), false);
});

test('prefs round-trip and tolerate missing/corrupt files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oco-prefs-'));
  const file = path.join(dir, 'sub', 'state.json');
  try {
    assert.deepEqual(loadPrefs(file), {});
    savePrefs({ mode: 'split' }, file);
    savePrefs({ releaseStore: 'play' }, file);
    assert.deepEqual(loadPrefs(file), { mode: 'split', releaseStore: 'play' });
    fs.writeFileSync(file, 'not json');
    assert.deepEqual(loadPrefs(file), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('retypeMessage swaps type and gitmoji, keeps scope and body, toggles breaking', () => {
  const msg = '✨ feat(api): add thing\n\n* one';
  assert.equal(retypeMessage(msg, { type: 'fix' }), '🐛 fix(api): add thing\n\n* one');
  assert.equal(retypeMessage(msg, { breaking: true }), '💥 feat(api): add thing\n\n* one');
  assert.equal(retypeMessage('💥 feat: x', { breaking: false }), '✨ feat: x');
  assert.equal(retypeMessage('no header here', { type: 'fix' }), 'no header here');
  assert.equal(isBreakingMessage('💥 feat: x'), true);
  assert.equal(isBreakingMessage('✨ feat: x'), false);
});

const G = () => [
  { files: ['a', 'b'], message: 'm1', breaking: false },
  { files: ['c'], message: 'm2', breaking: false },
];

test('moveFile moves between groups, to a new group, drops emptied groups, marks stale', () => {
  const moved = moveFile(G(), 'b', 1);
  assert.deepEqual(moved.map((g) => g.files), [['a'], ['c', 'b']]);
  assert.ok(moved[0].stale && moved[1].stale);

  const toNew = moveFile(G(), 'c', 'new');
  assert.deepEqual(toNew.map((g) => g.files), [['a', 'b'], ['c']]); // c was alone: old group emptied, new created

  const emptied = moveFile(G(), 'c', 0);
  assert.deepEqual(emptied.map((g) => g.files), [['a', 'b', 'c']]);
});

test('mergeGroups merges j into i and does not mutate the input', () => {
  const input = G();
  const merged = mergeGroups(input, 0, 1);
  assert.deepEqual(merged.map((g) => g.files), [['a', 'b', 'c']]);
  assert.equal(merged[0].stale, true);
  assert.deepEqual(input[0].files, ['a', 'b']);
});

test('hunk helpers: summary counts, batch labels, non-interactive plan is one batch per hunk', async () => {
  const hunk = '@@ -1,2 +1,3 @@ fn\n ctx\n-old\n+new\n+more';
  assert.deepEqual(hunkSummary(hunk), { head: '@@ -1,2 +1,3 @@ fn', add: 2, del: 1, firstChange: '-old' });
  assert.equal(batchLabel('f.js', [1], 3), 'f.js (hunk 2/3)');
  assert.equal(batchLabel('f.js', [0, 2], 3), 'f.js (hunks 1, 3/3)');
  assert.deepEqual(await planHunkBatches(['h0', 'h1', 'h2'], false), [[0], [1], [2]]);
  assert.deepEqual(await planHunkBatches(['h0'], true), [[0]]);
});

test('prompts include user feedback and translation request', () => {
  assert.match(buildPrompt('diff', 'mention the API'), /Additional instruction from the user.*mention the API/);
  assert.doesNotMatch(buildPrompt('diff'), /Additional instruction/);
  assert.match(buildReleaseNotesPrompt({ commitsText: '- x', diff: '', feedback: 'shorter' }), /shorter/);
  const t = buildTranslationPrompt(['Added dark mode'], 'French');
  assert.match(t, /French/);
  assert.match(t, /- Added dark mode/);
});
