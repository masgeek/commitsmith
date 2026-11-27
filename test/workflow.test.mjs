import test from 'node:test';
import assert from 'node:assert/strict';
import { pickStyleExamples, styleLines, parseWorkspaceRoots, inferScope, scopeLines } from '../src/hints.mjs';
import { parseNumstat, analyzeStaged } from '../src/staged-check.mjs';
import { parseHunkRanges, parseBlameShas, rankCandidates } from '../src/modes/fixup.mjs';
import { keepTrailers, selectRewordTargets, isLinearChain } from '../src/modes/reword.mjs';
import { chooseVersion, releaseBody, releaseCommitMessage } from '../src/modes/release.mjs';
import { defaultSince, resolveAuthor } from '../src/modes/standup.mjs';
import { buildReleaseCreateArgs } from '../src/github.mjs';
import { parseStandup, formatStandup } from '../src/parsing.mjs';
import { ruleLines, DEFAULT_RULES } from '../src/rules.mjs';

// --- style learning -------------------------------------------------------

test('pickStyleExamples keeps conventional subjects, drops junk and duplicates, respects the limit', () => {
  const subjects = ['✨ feat(cli): add --pr', 'wip', 'Merge branch x', '✨ feat(cli): add --pr', 'fix(git): handle empty repo', 'docs: update readme'];
  assert.deepEqual(pickStyleExamples(subjects, 2), ['✨ feat(cli): add --pr', 'fix(git): handle empty repo']);
  assert.deepEqual(pickStyleExamples([], 5), []);
});

test('styleLines and ruleLines carry the hints; both are empty without them', () => {
  assert.equal(styleLines([]).length, 0);
  assert.match(styleLines(['fix: x']).join('\n'), /fix: x/);
  assert.equal(scopeLines(null).length, 0);
  const lines = ruleLines({ ...DEFAULT_RULES, scopeHint: 'cli', styleExamples: ['feat(cli): a'] }).join('\n');
  assert.match(lines, /scope "cli"/);
  assert.match(lines, /feat\(cli\): a/);
  assert.equal(ruleLines({ ...DEFAULT_RULES }).length, 0);
});

// --- scope inference ------------------------------------------------------

test('parseWorkspaceRoots reads pnpm-workspace.yaml and package.json workspaces', () => {
  const yaml = "packages:\n  - 'packages/*'\n  - \"apps/**\"\n  - '!packages/ignored'\n";
  assert.deepEqual(parseWorkspaceRoots(yaml, '').sort(), ['apps', 'packages']);
  assert.deepEqual(parseWorkspaceRoots('', JSON.stringify({ workspaces: ['libs/*'] })), ['libs']);
  assert.deepEqual(parseWorkspaceRoots('', JSON.stringify({ workspaces: { packages: ['tools/*'] } })), ['tools']);
  assert.deepEqual(parseWorkspaceRoots('', 'not json'), []);
});

test('inferScope picks a workspace package, a folder under src, or a file stem — only when files agree', () => {
  const ws = { workspaceRoots: ['packages'] };
  assert.equal(inferScope(['packages/api/src/a.ts', 'packages/api/b.ts'], ws), 'api');
  assert.equal(inferScope(['packages/api/a.ts', 'packages/web/a.ts'], ws), null);
  assert.equal(inferScope(['src/modes/a.mjs', 'src/modes/b.mjs']), 'modes');
  assert.equal(inferScope(['src/git.mjs', 'test/git.test.mjs']), 'git');
  assert.equal(inferScope(['src/git.mjs', 'src/cli.mjs']), null);
  assert.equal(inferScope(['README.md']), 'readme');
});

test('inferScope ignores lockfiles and honors an allowed-scope list', () => {
  assert.equal(inferScope(['src/git.mjs', 'pnpm-lock.yaml']), 'git');
  assert.equal(inferScope(['pnpm-lock.yaml']), null);
  assert.equal(inferScope(['src/git.mjs'], { allowedScopes: ['cli', 'core'] }), null);
  assert.equal(inferScope(['src/cli.mjs'], { allowedScopes: ['cli', 'core'] }), 'cli');
});

// --- staged-diff sanity warnings -----------------------------------------

test('parseNumstat reads counts and flags binary files', () => {
  assert.deepEqual(parseNumstat('3\t1\tsrc/a.mjs\n-\t-\timg.png\n'), [
    { file: 'src/a.mjs', added: 3, deleted: 1, binary: false },
    { file: 'img.png', added: 0, deleted: 0, binary: true },
  ]);
  assert.deepEqual(parseNumstat(''), []);
});

test('analyzeStaged is quiet for a small focused change', () => {
  assert.deepEqual(analyzeStaged(parseNumstat('5\t2\tsrc/git.mjs\n10\t0\ttest/git.test.mjs\n')), []);
});

test('analyzeStaged warns about size, scattered areas, generated output, orphan lockfiles and binaries', () => {
  const big = analyzeStaged([{ file: 'src/a.mjs', added: 900, deleted: 0, binary: false }]);
  assert.match(big.join(' '), /Large change/);

  const scattered = ['a/x.mjs', 'b/x.mjs', 'c/x.mjs', 'd/x.mjs'].map((file) => ({ file, added: 1, deleted: 0, binary: false }));
  assert.match(analyzeStaged(scattered).join(' '), /4 unrelated areas/);

  const rest = analyzeStaged([
    { file: 'dist/app.js', added: 1, deleted: 0, binary: false },
    { file: 'pnpm-lock.yaml', added: 1, deleted: 0, binary: false },
    { file: 'src/x.mjs', added: 1, deleted: 0, binary: false },
    { file: 'logo.png', added: 0, deleted: 0, binary: true },
  ]).join('\n');
  assert.match(rest, /generated output/);
  assert.match(rest, /pnpm-lock\.yaml changed alongside source/);
  assert.match(rest, /Binary file/);

  // lockfile + its manifest is the normal case
  const ok = analyzeStaged(['package.json', 'pnpm-lock.yaml', 'src/x.mjs'].map((file) => ({ file, added: 1, deleted: 0, binary: false })));
  assert.deepEqual(ok, []);
});

// --- fixup ----------------------------------------------------------------

test('parseHunkRanges reads old-side ranges, maps insertions to the preceding line, skips new files', () => {
  const diff = [
    'diff --git a/src/a.mjs b/src/a.mjs',
    '--- a/src/a.mjs',
    '+++ b/src/a.mjs',
    '@@ -10,2 +10,3 @@ fn',
    '@@ -20 +21 @@',
    '@@ -30,0 +31,2 @@',
    'diff --git a/new.mjs b/new.mjs',
    '--- /dev/null',
    '+++ b/new.mjs',
    '@@ -0,0 +1,5 @@',
    'diff --git a/top.mjs b/top.mjs',
    '--- a/top.mjs',
    '+++ b/top.mjs',
    '@@ -0,0 +1,2 @@',
  ].join('\n');
  assert.deepEqual(parseHunkRanges(diff), [
    { file: 'src/a.mjs', start: 10, count: 2 },
    { file: 'src/a.mjs', start: 20, count: 1 },
    { file: 'src/a.mjs', start: 30, count: 1 },
  ]);
});

test('parseBlameShas and rankCandidates rank commits by owned lines and honor the allowed set', () => {
  const a = 'a'.repeat(40);
  const b = 'b'.repeat(40);
  const zero = '0'.repeat(40);
  const porcelain = [`${a} 1 1 2`, 'author x', '\tline', `${a} 2 2`, '\tline', `${b} 3 3 1`, '\tline', `${zero} 4 4 1`, '\tline'].join('\n');
  const shas = parseBlameShas(porcelain);
  assert.deepEqual(shas, [a, a, b]);
  assert.deepEqual(rankCandidates(shas), [{ sha: a, lines: 2 }, { sha: b, lines: 1 }]);
  assert.deepEqual(rankCandidates(shas, new Set([b])), [{ sha: b, lines: 1 }]);
});

// --- reword ---------------------------------------------------------------

test('keepTrailers re-attaches trailers the new message lacks, without duplicating', () => {
  const old = 'old subject\n\nbody\n\nCo-authored-by: A <a@x.io>\nRefs: ABC-1';
  assert.equal(keepTrailers(old, 'feat: new'), 'feat: new\n\nCo-authored-by: A <a@x.io>\nRefs: ABC-1');
  assert.equal(keepTrailers(old, 'feat: new\n\nRefs: ABC-1'), 'feat: new\n\nRefs: ABC-1\n\nCo-authored-by: A <a@x.io>');
  assert.equal(keepTrailers('plain', 'feat: new'), 'feat: new');
});

test('selectRewordTargets picks failing messages (all with --all); isLinearChain detects merges and gaps', () => {
  const commits = [
    { sha: '1', parents: ['0'], message: 'feat(cli): fine' },
    { sha: '2', parents: ['1'], message: 'fixed stuff' },
  ];
  assert.deepEqual(selectRewordTargets(commits, {}).map((c) => c.sha), ['2']);
  assert.equal(selectRewordTargets(commits, {}, true).length, 2);
  assert.equal(isLinearChain(commits), true);
  assert.equal(isLinearChain([commits[0], { sha: '3', parents: ['x'], message: '' }]), false);
  assert.equal(isLinearChain([{ sha: '1', parents: ['a', 'b'], message: '' }]), false);
});

// --- release ----------------------------------------------------------------

test('chooseVersion takes the suggestion, or a valid newer override', () => {
  assert.equal(chooseVersion({ current: '1.2.3', suggested: '1.3.0', override: null }), '1.3.0');
  assert.equal(chooseVersion({ current: '1.2.3', suggested: '1.3.0', override: 'v2.0.0' }), '2.0.0');
  assert.throws(() => chooseVersion({ current: '1.2.3', suggested: '1.3.0', override: 'nope' }), /valid semantic version/);
  assert.throws(() => chooseVersion({ current: '1.2.3', suggested: '1.3.0', override: '1.2.3' }), /newer/);
});

test('releaseBody drops the heading; the release commit message is conventional; gh args use stdin notes', () => {
  assert.equal(releaseBody('## [1.3.0] - 2026-11-27\n\n### ✨ Features\n\n- a'), '### ✨ Features\n\n- a');
  assert.equal(releaseCommitMessage('v1.3.0'), 'chore(release): v1.3.0');
  const args = buildReleaseCreateArgs({ tag: 'v1.3.0', prerelease: true, draft: true });
  assert.deepEqual(args.slice(0, 3), ['release', 'create', 'v1.3.0']);
  for (const flag of ['--notes-file', '--verify-tag', '--prerelease', '--draft']) assert.ok(args.includes(flag), flag);
  assert.ok(!buildReleaseCreateArgs({ tag: 't' }).includes('--draft'));
});

// --- standup ----------------------------------------------------------------

test('defaultSince skips the weekend on Monday; resolveAuthor handles me/all/name', () => {
  assert.equal(defaultSince(new Date('2026-11-23T10:00:00')), '3 days ago'); // Monday
  assert.equal(defaultSince(new Date('2026-11-24T10:00:00')), '1 day ago');
  assert.equal(defaultSince(new Date('2026-11-22T10:00:00')), '2 days ago'); // Sunday
  assert.equal(resolveAuthor(null, 'me@x.io'), 'me@x.io');
  assert.equal(resolveAuthor('all', 'me@x.io'), '');
  assert.equal(resolveAuthor('sam', 'me@x.io'), 'sam');
});

test('parseStandup / formatStandup round-trip and reject empty answers', () => {
  const parsed = parseStandup('{"done":["- Added PR support","Fixed bug"],"inProgress":["Docs"]}');
  assert.deepEqual(parsed, { done: ['Added PR support', 'Fixed bug'], inProgress: ['Docs'] });
  assert.equal(formatStandup(parsed), 'Done:\n- Added PR support\n- Fixed bug\n\nIn progress:\n- Docs');
  assert.equal(formatStandup({ done: ['x'], inProgress: [] }), 'Done:\n- x');
  assert.equal(parseStandup('{"done":[],"inProgress":[]}'), null);
  assert.equal(parseStandup('no json'), null);
});
