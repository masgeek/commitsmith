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
  assert.equal(retypeMessage(msg, { breaking: true }), '💥 feat(api): add thing\n\n* one\n\nBREAKING CHANGE: add thing');
  assert.equal(retypeMessage('💥 feat: x', { breaking: false }), '✨ feat: x');
  assert.equal(retypeMessage('no header here', { type: 'fix' }), 'no header here');
  // the BREAKING CHANGE footer follows the flag
  assert.equal(
    retypeMessage('✨ feat: add x', { breaking: true, breakingReason: 'x replaces y' }),
    '💥 feat: add x\n\nBREAKING CHANGE: x replaces y'
  );
  assert.equal(retypeMessage('✨ feat: add x', { breaking: true }), '💥 feat: add x\n\nBREAKING CHANGE: add x');
  assert.equal(
    retypeMessage('💥 feat: add x\n\n* a\n\nBREAKING CHANGE: r', { breaking: false }),
    '✨ feat: add x\n\n* a'
  );
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

import { findCommitIssues } from '../src/modes/check.mjs';
import { parseBreakingResult, mergeBreakingResults, breakingFooter } from '../src/parsing.mjs';
import { splitFileDiffs } from '../src/git.mjs';
import { buildBreakingPrompt, buildPullRequestPrompt } from '../src/prompts.mjs';
import { parsePullRequest, extractBreakingNotes, formatPullRequestBody, formatCommitsForPrompt } from '../src/parsing.mjs';
import { buildPrCreateArgs, buildPrEditArgs, parseOpenPr } from '../src/github.mjs';

test('parseOpenPr and buildPrEditArgs support updating an existing PR', () => {
  assert.deepEqual(parseOpenPr('[{"url":"https://github.com/o/r/pull/7","number":7}]'), {
    url: 'https://github.com/o/r/pull/7',
    number: 7,
  });
  assert.equal(parseOpenPr('[]'), null);
  assert.equal(parseOpenPr('not json'), null);
  assert.equal(parseOpenPr('[{"url":"x"}]'), null);
  assert.deepEqual(buildPrEditArgs({ number: 7, title: 'T' }), ['pr', 'edit', '7', '--title', 'T', '--body-file', '-']);
});
import { collectBreakingNotes, withBreakingPrefix } from '../src/modes/pull-request.mjs';

test('parsePullRequest cleans the title and lists, and rejects a missing title', () => {
  const raw = '{"title":"\\"feat(cli): add --pr.\\"","summary":["- adds pr mode"," "],"testPlan":["run it"]}';
  assert.deepEqual(parsePullRequest(raw), { title: 'feat(cli): add --pr', summary: ['adds pr mode'], testPlan: ['run it'] });
  assert.equal(parsePullRequest('{"title":"  "}'), null);
  assert.equal(parsePullRequest('nothing'), null);
});

test('extractBreakingNotes / collectBreakingNotes read commit footers and 💥 subjects', () => {
  const commits = [
    { subject: '💥 feat: a', body: '* x\n\nBREAKING CHANGE: key renamed' },
    { subject: '💥 feat: b', body: '' },
    { subject: '✨ feat: c', body: 'BREAKING CHANGE: key renamed' },
    { subject: '🐛 fix: d', body: '' },
  ];
  assert.deepEqual(extractBreakingNotes(commits), ['key renamed']); // deduplicated
  assert.deepEqual(collectBreakingNotes(commits), ['key renamed', 'Breaking change in: 💥 feat: b']);
  assert.deepEqual(collectBreakingNotes([commits[3]]), []);
});

test('formatPullRequestBody builds sections; withBreakingPrefix adds 💥 once', () => {
  const body = formatPullRequestBody({ summary: ['a'], testPlan: ['t'], breaking: ['b'] });
  assert.match(body, /^## Summary\n\n- a\n\n## .*Breaking changes\n\n- b\n\n## Test plan\n\n- \[ \] t$/);
  assert.equal(formatPullRequestBody({ summary: ['a'], testPlan: [] }), '## Summary\n\n- a');
  assert.equal(withBreakingPrefix('feat: x', ['b']), '💥 feat: x');
  assert.equal(withBreakingPrefix('💥 feat: x', ['b']), '💥 feat: x');
  assert.equal(withBreakingPrefix('feat: x', []), 'feat: x');
});

test('buildPrCreateArgs passes the body on stdin and adds --draft only when asked', () => {
  const args = buildPrCreateArgs({ base: 'develop', head: 'feat/x', title: 'T', draft: false });
  assert.deepEqual(args, ['pr', 'create', '--base', 'develop', '--head', 'feat/x', '--title', 'T', '--body-file', '-']);
  assert.equal(buildPrCreateArgs({ base: 'b', head: 'h', title: 'T', draft: true }).at(-1), '--draft');
});

test('PR prompt includes commits, diff and feedback; commit list formatter trims bodies', () => {
  const p = buildPullRequestPrompt({ commitsText: '- c1', diff: 'DIFFX', feedback: 'be brief' });
  assert.match(p, /- c1/);
  assert.match(p, /DIFFX/);
  assert.match(p, /be brief/);
  assert.equal(formatCommitsForPrompt([{ subject: 's', body: 'a\nb' }]), '- s (a b)');
});

test('parseBreakingResult: breaking verdict with findings, non-breaking, and no JSON', () => {
  const raw = JSON.stringify({
    breaking: true,
    findings: [{ file: 'src/config.mjs', what: 'maxDiff renamed', impact: 'old configs ignored' }, { what: '' }],
  });
  assert.deepEqual(parseBreakingResult(raw), {
    breaking: true,
    findings: [{ file: 'src/config.mjs', what: 'maxDiff renamed', impact: 'old configs ignored' }],
  });
  assert.deepEqual(parseBreakingResult('{"breaking":false,"findings":[{"what":"x"}]}'), { breaking: false, findings: [] });
  assert.equal(parseBreakingResult('no json here'), null);
});

test('parseBreakingResult: a breaking verdict is never silent even without findings', () => {
  const r = parseBreakingResult('{"breaking":true,"findings":[]}');
  assert.equal(r.breaking, true);
  assert.equal(r.findings.length, 1);
});

test('mergeBreakingResults and breakingFooter combine per-file results', () => {
  const a = { breaking: true, findings: [{ file: 'a', what: 'w1', impact: 'i1' }] };
  const b = { breaking: false, findings: [] };
  const c = { breaking: true, findings: [{ file: 'a', what: 'w1', impact: 'i1' }, { file: 'b', what: 'w2', impact: '' }] };
  const merged = mergeBreakingResults([a, b, c]);
  assert.equal(merged.breaking, true);
  assert.equal(merged.findings.length, 2); // duplicate dropped
  assert.equal(breakingFooter(merged.findings), 'BREAKING CHANGE: i1; w2');
  assert.equal(mergeBreakingResults([b]).breaking, false);
});

test('splitFileDiffs splits per file; buildBreakingPrompt embeds the diff', () => {
  const diff = 'diff --git a/a b/a\n+x\ndiff --git a/b b/b\n+y\n';
  assert.equal(splitFileDiffs(diff).length, 2);
  assert.match(buildBreakingPrompt('DIFFBODY'), /DIFFBODY/);
});

test('findCommitIssues: flags an unmarked breaking change', () => {
  const issues = findCommitIssues('✨ feat: rename config key', { breaking: true, breakingReason: 'config key renamed', type: 'feat' });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /BREAKING CHANGE.*config key renamed/);
});

test('findCommitIssues: accepts a marked breaking change (gitmoji or text)', () => {
  assert.deepEqual(findCommitIssues('💥 feat: rename key', { breaking: true, type: 'feat' }), []);
  assert.deepEqual(findCommitIssues('feat: x\n\nBREAKING CHANGE: key renamed', { breaking: true }), []);
});

test('findCommitIssues: flags a breaking marker the model disagrees with, and type mismatches', () => {
  assert.equal(findCommitIssues('💥 feat: x', { breaking: false, type: 'feat' }).length, 1);
  const mismatch = findCommitIssues('✨ feat: x', { breaking: false, type: 'fix' });
  assert.equal(mismatch.length, 1);
  assert.match(mismatch[0], /"fix".*"feat"/);
  assert.deepEqual(findCommitIssues('🐛 fix: x', { breaking: false, type: 'fix' }), []);
});
