import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { die } from './die.mjs';
import { sortVersionTags } from './conventional.mjs';

export function assertGitRepo() {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  } catch {
    die('Not inside a git repository.');
  }
}

/** pathspec: a single path, an array of paths, or null for everything staged. */
export function getStagedDiff(pathspec) {
  const paths = Array.isArray(pathspec) ? pathspec : pathspec ? [pathspec] : [];
  const args = paths.length > 0 ? ['diff', '--staged', '--no-color', '--', ...paths] : ['diff', '--staged', '--no-color'];
  let diff;
  try {
    diff = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  } catch {
    die('Failed to run `git diff --staged`.');
  }
  if (!diff.trim()) die('No staged changes found. Run `git add <files>` first.');
  return diff;
}

export function getStagedFiles() {
  try {
    return execFileSync('git', ['diff', '--staged', '--name-only'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Unstaged + untracked working-tree changes, for the interactive staging prompt. */
export function getWorkingTreeChanges() {
  let output;
  try {
    output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2).trim();
      const rest = line.slice(3);
      const arrowIdx = rest.indexOf(' -> ');
      const file = arrowIdx === -1 ? rest : rest.slice(arrowIdx + 4);
      return { status, file };
    });
}

export function truncateDiff(diff, maxChars) {
  if (diff.length <= maxChars) return diff;
  return diff.slice(0, maxChars) + '\n[... diff truncated ...]';
}

/** Split one file's unified diff into { header, hunks[] }. Returns null for binary/mode-only diffs. */
export function parseFileDiffIntoHunks(fileDiff) {
  const lines = fileDiff.split('\n');
  const firstHunkIdx = lines.findIndex((l) => l.startsWith('@@'));
  if (firstHunkIdx === -1) return null;

  const header = lines.slice(0, firstHunkIdx).join('\n');
  const body = lines.slice(firstHunkIdx);

  const hunks = [];
  let current = [];
  for (const line of body) {
    if (line.startsWith('@@') && current.length > 0) {
      hunks.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) hunks.push(current.join('\n'));

  return { header, hunks };
}

/** Splits a multi-file unified diff into one string per file. */
export function splitFileDiffs(diffText) {
  return diffText.split(/(?=^diff --git )/m).filter((p) => p.trim().length > 0);
}

export function getFileDiffs() {
  return splitFileDiffs(getStagedDiff(null));
}

/** Unstaged changes to tracked files (what `git diff` shows) — used by `--breaking` when nothing is staged. */
export function getWorkingTreeDiff() {
  try {
    return execFileSync('git', ['diff', '--no-color'], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  } catch {
    die('Failed to run `git diff`.');
  }
}

export function extractPathFromFileDiff(fileDiff) {
  const match = fileDiff.match(/^diff --git a\/(.+?) b\/(.+)$/m);
  return match ? match[2] : null;
}

export function commitWithMessage(message, pathspec) {
  const args = pathspec ? ['commit', '-m', message, '--', pathspec] : ['commit', '-m', message];
  try {
    execFileSync('git', args, { stdio: 'inherit' });
  } catch {
    die(`git commit failed${pathspec ? ` for ${pathspec}` : ''}.`);
  }
}

/** Used by --check mode to re-classify the most recent commit. */
export function getLastCommitMessage() {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%B'], { encoding: 'utf8' }).trim();
  } catch {
    die('Could not read the last commit message. Is there at least one commit?');
  }
}

export function getLastCommitDiff() {
  try {
    return execFileSync('git', ['show', '--no-color', '--pretty=format:', 'HEAD'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch {
    die('Could not read the last commit diff.');
  }
}

const GIT_QUIET = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };

/** Resolves a ref to a commit SHA, or null when it does not exist (or looks like an option). */
export function resolveCommit(ref) {
  if (!ref || ref.startsWith('-')) return null;
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], GIT_QUIET).trim() || null;
  } catch {
    return null;
  }
}

/** Most recent tags first (by creation date), for the interactive range picker. */
export function listTags(limit = 15) {
  try {
    return execFileSync('git', ['tag', '--sort=-creatordate'], GIT_QUIET).split('\n').filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}

/** Most recently committed local and remote branches, for the interactive range picker. */
export function listBranches(limit = 15) {
  try {
    return execFileSync(
      'git',
      ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
      GIT_QUIET
    )
      .split('\n')
      .filter((b) => b && !b.endsWith('/HEAD') && b !== 'origin')
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Returns the closest tag reachable from a ref (default HEAD), or null when there is none. */
export function getLastTag(ref = 'HEAD') {
  if (ref.startsWith('-')) return null;
  try {
    return execFileSync('git', ['describe', '--tags', '--abbrev=0', ref], GIT_QUIET).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Release-notes base tag for a target ref: the closest tag reachable from it,
 * or — when the target sits exactly on that tag — the tag before it, so a
 * freshly tagged release still has a non-empty window.
 */
export function getBaseTag(targetRef = 'HEAD') {
  const tag = getLastTag(targetRef);
  if (!tag) return null;
  if (resolveCommit(tag) === resolveCommit(targetRef)) return getLastTag(`${tag}^`);
  return tag;
}

/** Non-merge commits in baseRef..targetRef as { subject, body }[] — the primary --release-notes input. */
export function getReleaseCommits(baseRef, targetRef = 'HEAD') {
  let out;
  try {
    out = execFileSync('git', ['log', '--no-merges', '--format=%s%x1f%b%x1e', `${baseRef}..${targetRef}`], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch {
    die(`Could not read commits between "${baseRef}" and "${targetRef}".`);
  }
  return out
    .split('\x1e')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const [subject, body = ''] = e.split('\x1f');
      return { subject: subject.trim(), body: body.trim() };
    });
}

// Noise that never belongs in user-facing release notes.
const RELEASE_NOTES_EXCLUDES = [
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/*.test.*',
  'test/**',
  'tests/**',
  '.github/**',
].map((p) => `:(exclude,glob)${p}`);

/**
 * Changes the target introduced since it diverged from the base (merge-base,
 * three-dot), minus lockfiles/tests/CI — used by --release-notes as a
 * supplement to the commit list.
 */
export function getReleaseNotesDiff(baseRef, targetRef = 'HEAD') {
  try {
    return execFileSync(
      'git',
      ['diff', '--no-color', `${baseRef}...${targetRef}`, '--', '.', ...RELEASE_NOTES_EXCLUDES],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 }
    );
  } catch {
    die(`Could not get the diff between "${baseRef}" and "${targetRef}". Are both valid refs in this repo?`);
  }
}

/** Non-merge commit SHAs in baseRef..targetRef, oldest first — used by `--check --from`. */
export function listCommitShas(baseRef, targetRef = 'HEAD') {
  try {
    return execFileSync('git', ['log', '--no-merges', '--reverse', '--format=%H', `${baseRef}..${targetRef}`], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    die(`Could not list commits between "${baseRef}" and "${targetRef}".`);
  }
}

/** Full message of a commit. */
export function getCommitMessage(sha) {
  try {
    return execFileSync('git', ['log', '-1', '--pretty=%B', sha], { encoding: 'utf8' }).trim();
  } catch {
    die(`Could not read the message of commit ${sha.slice(0, 7)}.`);
  }
}

/** Diff introduced by a single commit (no header). */
export function getCommitDiff(sha) {
  try {
    return execFileSync('git', ['show', '--no-color', '--pretty=format:', sha], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch {
    die(`Could not read the diff of commit ${sha.slice(0, 7)}.`);
  }
}

/** Current branch name, or null on a detached HEAD. */
export function getCurrentBranch() {
  try {
    return execFileSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], GIT_QUIET).trim() || null;
  } catch {
    return null;
  }
}

/** The remote's default branch (from origin/HEAD), else the first of main/master/develop that exists locally. */
export function getDefaultBranch() {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'], GIT_QUIET).trim();
    if (ref) return ref.replace(/^origin\//, '');
  } catch {
    // no origin/HEAD — fall through to local guesses
  }
  return ['main', 'master', 'develop'].find((b) => resolveCommit(`refs/heads/${b}`)) ?? null;
}

/** Diff the target added since diverging from base, minus lockfiles only (tests/CI matter in a PR). */
export function getBranchDiff(baseRef, targetRef = 'HEAD') {
  const lockExcludes = ['**/*.lock', '**/package-lock.json', '**/pnpm-lock.yaml'].map((p) => `:(exclude,glob)${p}`);
  try {
    return execFileSync('git', ['diff', '--no-color', `${baseRef}...${targetRef}`, '--', '.', ...lockExcludes], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    });
  } catch {
    die(`Could not get the diff between "${baseRef}" and "${targetRef}". Are both valid refs in this repo?`);
  }
}

/** Pushes a branch to origin, setting upstream. Never forces. */
export function pushBranch(branch) {
  try {
    execFileSync('git', ['push', '-u', 'origin', branch], { stdio: 'inherit' });
  } catch {
    die(`git push failed for "${branch}".`);
  }
}

/** True when the branch has an upstream and nothing local is unpushed. */
export function isBranchPushed(branch) {
  try {
    const upstream = execFileSync('git', ['rev-parse', '--abbrev-ref', `${branch}@{u}`], GIT_QUIET).trim();
    if (!upstream) return false;
    return execFileSync('git', ['rev-list', '--count', `${upstream}..${branch}`], GIT_QUIET).trim() === '0';
  } catch {
    return false;
  }
}

/** URL of a remote (default origin), or null when it doesn't exist. */
export function getRemoteUrl(name = 'origin') {
  try {
    return execFileSync('git', ['remote', 'get-url', name], GIT_QUIET).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Non-merge commits as { sha, subject, body }[], newest first. With a base ref
 * it is baseRef..targetRef; with `null` it is the whole history up to targetRef
 * (a repo with no tags yet) — used by --bump and --changelog.
 */
export function getCommitsDetailed(baseRef, targetRef = 'HEAD') {
  let out;
  try {
    out = execFileSync('git', ['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', baseRef ? `${baseRef}..${targetRef}` : targetRef], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 50,
    });
  } catch {
    die(baseRef ? `Could not read commits between "${baseRef}" and "${targetRef}".` : `Could not read the history of "${targetRef}".`);
  }
  return out
    .split('\x1e')
    .map((e) => e.trim())
    .filter(Boolean)
    .map((e) => {
      const [sha, subject = '', body = ''] = e.split('\x1f');
      return { sha: sha.trim(), subject: subject.trim(), body: body.trim() };
    });
}

/** Staged diff if anything is staged, else the unstaged diff; null when neither has changes. */
export function getWorkingDiffPreferStaged() {
  if (getStagedFiles().length > 0) return { source: 'staged changes', diff: getStagedDiff(null) };
  const diff = getWorkingTreeDiff();
  return diff.trim() ? { source: 'unstaged working-tree changes', diff } : null;
}

/** Absolute path of the repository's hooks directory (honors core.hooksPath and worktrees). */
export function getHooksDir() {
  try {
    return path.resolve(process.cwd(), execFileSync('git', ['rev-parse', '--git-path', 'hooks'], GIT_QUIET).trim());
  } catch {
    return die('Could not locate the git hooks directory.');
  }
}

/** True when the commit is already contained in a remote-tracking branch (amending it would rewrite published history). */
export function isCommitPublished(ref = 'HEAD') {
  try {
    return execFileSync('git', ['branch', '-r', '--contains', ref], GIT_QUIET).trim().length > 0;
  } catch {
    return false;
  }
}

/** Rewrites only the message of HEAD (`git commit --amend -m`); the caller must ensure nothing is staged. */
export function amendCommitMessage(message) {
  try {
    execFileSync('git', ['commit', '--amend', '-m', message], { stdio: 'inherit' });
  } catch {
    die('git commit --amend failed.');
  }
}

/**
 * Semver tags reachable from `targetRef`, newest version first, as
 * { tag, version, date } (date = the tag's creation date, YYYY-MM-DD).
 * Non-semver tags are ignored.
 */
export function listVersionTags(targetRef = 'HEAD') {
  let out;
  try {
    out = execFileSync('git', ['for-each-ref', `--merged=${targetRef}`, '--format=%(refname:short)%09%(creatordate:short)', 'refs/tags'], GIT_QUIET);
  } catch {
    return [];
  }
  return sortVersionTags(
    out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [tag, date = ''] = line.split('\t');
        return { tag, date };
      })
  );
}

/** True when `ancestor` is reachable from `descendant` (and they are different commits). */
export function isStrictAncestor(ancestor, descendant) {
  const a = resolveCommit(ancestor);
  const d = resolveCommit(descendant);
  if (!a || !d || a === d) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, d], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const BIG = { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, stdio: ['ignore', 'pipe', 'ignore'] };

/** Subjects of the last `n` non-merge commits on HEAD, newest first ([] in an empty repo). */
export function getRecentSubjects(n = 30) {
  try {
    return execFileSync('git', ['log', `-${Number(n) || 30}`, '--no-merges', '--format=%s'], BIG).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** `git diff --staged --numstat` text ('' on failure). */
export function getStagedNumstat() {
  try {
    return execFileSync('git', ['diff', '--staged', '--numstat'], BIG);
  } catch {
    return '';
  }
}

/** Zero-context staged diff (just the hunk headers matter), used to find which old lines a change touches. */
export function getStagedZeroContextDiff() {
  try {
    return execFileSync('git', ['diff', '--staged', '-U0', '--no-color', '--no-renames'], BIG);
  } catch {
    return '';
  }
}

/** `git blame --porcelain` of `count` lines of `file` at HEAD, starting at line `start` ('' when it can't be blamed). */
export function blameRange(file, start, count) {
  try {
    return execFileSync('git', ['blame', '--porcelain', '-L', `${start},${start + count - 1}`, 'HEAD', '--', file], BIG);
  } catch {
    return '';
  }
}

/** { sha, subject }[] for non-merge commits in baseRef..HEAD (the whole history when baseRef is null), newest first. */
export function listCommitsBrief(baseRef) {
  const range = baseRef ? `${baseRef}..HEAD` : 'HEAD';
  try {
    return execFileSync('git', ['log', '--no-merges', '--format=%H%x1f%s', range], BIG)
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [sha, subject = ''] = l.split('\x1f');
        return { sha, subject };
      });
  } catch {
    return [];
  }
}

/** user.email from git config, or ''. */
export function getUserEmail() {
  try {
    return execFileSync('git', ['config', 'user.email'], BIG).trim();
  } catch {
    return '';
  }
}

/**
 * Non-merge commits since a date spec git understands ("yesterday", "3 days
 * ago", "2026-01-01"), as { sha, subject, body }[] newest first. `author`
 * filters by name/email substring; `allBranches` includes every local branch.
 */
export function getCommitsSince({ since, author = '', allBranches = false }) {
  const args = ['log', '--no-merges', `--since=${since}`, '--format=%H%x1f%s%x1f%b%x1e'];
  if (author) args.push(`--author=${author}`, '--regexp-ignore-case', '--fixed-strings');
  if (allBranches) args.push('--branches');
  try {
    return execFileSync('git', args, BIG)
      .split('\x1e')
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => {
        const [sha, subject = '', body = ''] = e.split('\x1f');
        return { sha: sha.trim(), subject: subject.trim(), body: body.trim() };
      });
  } catch {
    return die(`Could not read the history since "${since}".`);
  }
}

/** Parents, authorship, tree and full message of every commit in baseRef..HEAD, oldest first (for rewriting). */
export function getCommitsForRewrite(baseRef) {
  const fmt = ['%H', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%T', '%B'].join('%x1f') + '%x1e';
  let out;
  try {
    out = execFileSync('git', ['log', '--reverse', `--format=${fmt}`, `${baseRef}..HEAD`], BIG);
  } catch {
    return die(`Could not read the commits in ${baseRef}..HEAD.`);
  }
  return out
    .split('\x1e')
    .map((e) => e.replace(/^\n/, ''))
    .filter((e) => e.trim())
    .map((e) => {
      const [sha, parents, an, ae, ad, cn, ce, cd, tree, message = ''] = e.split('\x1f');
      return {
        sha,
        parents: parents.split(' ').filter(Boolean),
        author: { name: an, email: ae, date: ad },
        committer: { name: cn, email: ce, date: cd },
        tree,
        message: message.replace(/\s+$/, ''),
      };
    });
}

/**
 * Rewrites the messages of a linear run of commits (oldest first) without a
 * rebase: each commit is re-created with `git commit-tree` on the same tree,
 * parent chain and author/committer, so file contents never change — only the
 * messages and therefore the hashes. `messages` maps old sha → new message.
 * Returns the new tip sha.
 */
export function rewriteMessages(commits, messages, baseSha) {
  let parent = baseSha;
  for (const c of commits) {
    const message = messages.get(c.sha) ?? c.message;
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: c.author.name,
      GIT_AUTHOR_EMAIL: c.author.email,
      GIT_AUTHOR_DATE: c.author.date,
      GIT_COMMITTER_NAME: c.committer.name,
      GIT_COMMITTER_EMAIL: c.committer.email,
      GIT_COMMITTER_DATE: c.committer.date,
    };
    try {
      parent = execFileSync('git', ['commit-tree', c.tree, ...(parent ? ['-p', parent] : []), '-F', '-'], {
        input: `${message}\n`,
        encoding: 'utf8',
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (err) {
      return die(`git commit-tree failed: ${(err.stderr ? err.stderr.toString().trim() : '') || err.message}`);
    }
  }
  return parent;
}

/** Moves a branch to `newSha` only if it still points at `oldSha` (compare-and-swap), after saving `oldSha` under a backup ref. */
export function moveBranchSafely(branch, oldSha, newSha, backupRef) {
  try {
    execFileSync('git', ['update-ref', backupRef, oldSha], { stdio: 'ignore' });
    execFileSync('git', ['update-ref', '-m', 'commitsmith: reword', `refs/heads/${branch}`, newSha, oldSha], { stdio: 'ignore' });
  } catch {
    die(`Could not update ${branch} (it moved while rewording?). Nothing was changed except the backup ref ${backupRef}.`);
  }
}

/** True when the working tree has uncommitted changes to tracked files. */
export function hasTrackedChanges() {
  try {
    return execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], BIG).trim().length > 0;
  } catch {
    return false;
  }
}

/** `git commit --fixup=<sha>` for the staged changes. */
export function commitFixup(sha) {
  try {
    execFileSync('git', ['commit', `--fixup=${sha}`], { stdio: 'inherit' });
  } catch {
    die('git commit --fixup failed.');
  }
}

/** Folds fixup!/squash! commits into their targets: a non-interactive `rebase -i --autosquash` from just before `sha`. */
export function autosquashFrom(sha) {
  const hasParent = Boolean(resolveCommit(`${sha}^`));
  try {
    execFileSync('git', ['rebase', '-i', '--autosquash', '--autostash', ...(hasParent ? [`${sha}^`] : ['--root'])], {
      stdio: 'inherit',
      env: { ...process.env, GIT_SEQUENCE_EDITOR: 'true' },
    });
  } catch {
    die('The autosquash rebase stopped (conflict?). Resolve it with `git rebase --continue`, or undo with `git rebase --abort`.');
  }
}

/** Tag names that exist on origin (empty when there is no reachable remote). */
export function listRemoteTags() {
  try {
    return execFileSync('git', ['ls-remote', '--tags', '--refs', 'origin'], BIG)
      .split('\n')
      .map((l) => l.split('\trefs/tags/')[1])
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Pushes the current branch and/or a tag to origin (never forced). */
export function pushRefs(refs) {
  try {
    execFileSync('git', ['push', 'origin', ...refs], { stdio: 'inherit' });
  } catch {
    die(`git push origin ${refs.join(' ')} failed.`);
  }
}
