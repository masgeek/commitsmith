import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileDiffIntoHunks, extractPathFromFileDiff } from '../src/git.mjs';

test('extractPathFromFileDiff reads the "b/" path from a diff header', () => {
  const diff = 'diff --git a/src/old.mjs b/src/new.mjs\nindex 123..456 100644\n--- a/src/old.mjs\n+++ b/src/new.mjs\n';
  assert.equal(extractPathFromFileDiff(diff), 'src/new.mjs');
});

test('extractPathFromFileDiff returns null when there is no diff header', () => {
  assert.equal(extractPathFromFileDiff('not a diff'), null);
});

test('parseFileDiffIntoHunks returns null for a binary/mode-only diff (no @@ hunk)', () => {
  const diff = 'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n';
  assert.equal(parseFileDiffIntoHunks(diff), null);
});

test('parseFileDiffIntoHunks splits a single-hunk diff into header + one hunk', () => {
  const diff = [
    'diff --git a/file.txt b/file.txt',
    'index 123..456 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1,2 +1,2 @@',
    '-old line',
    '+new line',
    ' context',
  ].join('\n');

  const result = parseFileDiffIntoHunks(diff);
  assert.ok(result);
  assert.equal(result.hunks.length, 1);
  assert.match(result.header, /^diff --git/);
  assert.match(result.hunks[0], /^@@ -1,2 \+1,2 @@/);
});

test('parseFileDiffIntoHunks splits a multi-hunk diff into separate hunks', () => {
  const diff = [
    'diff --git a/file.txt b/file.txt',
    'index 123..456 100644',
    '--- a/file.txt',
    '+++ b/file.txt',
    '@@ -1,2 +1,2 @@',
    '-old line one',
    '+new line one',
    '@@ -10,2 +10,2 @@',
    '-old line two',
    '+new line two',
  ].join('\n');

  const result = parseFileDiffIntoHunks(diff);
  assert.equal(result.hunks.length, 2);
  assert.match(result.hunks[0], /old line one/);
  assert.match(result.hunks[1], /old line two/);
});

// ---- release-notes git helpers (run against a throwaway temp repo) ----
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCommit, getLastTag, getBaseTag, getReleaseCommits, getReleaseNotesDiff } from '../src/git.mjs';

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'oco-rn-'));
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  const commit = (file, content, msg) => {
    mkdirSync(join(dir, file, '..'), { recursive: true });
    writeFileSync(join(dir, file), content);
    git('add', '-A');
    git('commit', '-q', '-m', msg);
  };
  return { dir, git, commit };
}

test('release-notes git helpers: tags, commits and filtered diff', () => {
  const { dir, git, commit } = makeRepo();
  const prevCwd = process.cwd();
  try {
    commit('a.txt', '1', 'feat: first');
    git('tag', 'v1');
    commit('b.txt', 'x', 'feat: add b');
    commit('pnpm-lock.yaml', 'lock', 'chore: lock');
    commit('test/a.test.mjs', 't', 'test: add test');
    commit('.github/ci.yml', 'ci', 'ci: add ci');
    process.chdir(dir);

    assert.equal(resolveCommit('v1')?.length, 40);
    assert.equal(resolveCommit('nope'), null);
    assert.equal(resolveCommit('--output=x'), null);

    assert.equal(getLastTag('HEAD'), 'v1');
    assert.equal(getBaseTag('HEAD'), 'v1');

    const commits = getReleaseCommits('v1', 'HEAD');
    assert.deepEqual(commits.map((c) => c.subject), ['ci: add ci', 'test: add test', 'chore: lock', 'feat: add b']);

    const diff = getReleaseNotesDiff('v1', 'HEAD');
    assert.match(diff, /b\.txt/);
    assert.doesNotMatch(diff, /pnpm-lock|a\.test\.mjs|ci\.yml/);

    // HEAD exactly on a tag → falls back to the previous tag (none here → null)
    git('tag', 'v2');
    assert.equal(getBaseTag('HEAD'), 'v1');
    assert.equal(getBaseTag('v1'), null);
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listCommitShas / getCommitMessage / getCommitDiff read a commit range', async () => {
  const { listCommitShas, getCommitMessage, getCommitDiff } = await import('../src/git.mjs');
  const { dir, git, commit } = makeRepo();
  const prevCwd = process.cwd();
  try {
    commit('a.txt', '1', 'feat: first');
    git('tag', 'base');
    commit('b.txt', 'x', 'feat: add b');
    commit('c.txt', 'y', 'fix: add c');
    process.chdir(dir);

    const shas = listCommitShas('base', 'HEAD');
    assert.equal(shas.length, 2);
    assert.equal(getCommitMessage(shas[0]), 'feat: add b'); // oldest first
    assert.equal(getCommitMessage(shas[1]), 'fix: add c');
    assert.match(getCommitDiff(shas[0]), /b\.txt/);
    assert.doesNotMatch(getCommitDiff(shas[0]), /c\.txt/);
  } finally {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});
