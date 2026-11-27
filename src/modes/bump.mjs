import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { getCommitsDetailed, getLastTag, resolveCommit, pushRefs } from '../git.mjs';
import { computeBump, bumpVersion, parseVersionTag } from '../conventional.mjs';
import { releaseNotesFromRef, releaseNotesBranch, bumpApply, bumpTag, bumpJson, releasePush, releaseGithub } from '../cli-args.mjs';
import { resolveGhToken, publishTagRelease } from './release-tags.mjs';
import { die } from '../die.mjs';

/** Current version from package.json text, or null. */
export function readPackageVersion(text) {
  try {
    const v = JSON.parse(text)?.version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** package.json text with its top-level "version" replaced (formatting untouched), or null when there is none. */
export function setPackageVersion(text, next) {
  const current = readPackageVersion(text);
  if (!current) return null;
  const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`("version"\\s*:\\s*")${escaped}(")`), `$1${next}$2`);
}

function readPackageJson() {
  try {
    return fs.readFileSync('package.json', 'utf8');
  } catch {
    return null;
  }
}

/**
 * Shared by --bump and --changelog: which commits are in the release (since
 * the last tag reachable from the target, or --from), what version we are at,
 * and what bump they call for. Validates refs first.
 */
export function resolveRelease() {
  const targetRef = releaseNotesBranch || 'HEAD';
  if (!resolveCommit(targetRef)) die(`--branch: "${targetRef}" is not a valid ref in this repo.`);
  if (releaseNotesFromRef && !resolveCommit(releaseNotesFromRef)) die(`--from: "${releaseNotesFromRef}" is not a valid ref in this repo.`);

  // Unlike release notes, a target sitting exactly on a tag means "nothing since": no fallback to the previous tag.
  const baseRef = releaseNotesFromRef || getLastTag(targetRef);
  const commits = getCommitsDetailed(baseRef, targetRef);

  const tagInfo = parseVersionTag(baseRef);
  const pkgText = readPackageJson();
  const current = tagInfo?.version ?? (pkgText && readPackageVersion(pkgText)) ?? '0.0.0';
  const { level, reasons } = computeBump(commits);

  return { baseRef, targetRef, commits, current, prefix: tagInfo?.prefix ?? '', level, reasons, next: bumpVersion(current, level), pkgText };
}

/** Machine-readable view of a resolved release (for CI): tag/next are null when nothing is releasable. */
export function bumpSummary(r) {
  const releasable = r.commits.length > 0 && r.level !== 'none';
  return {
    current: r.current,
    base: r.baseRef ?? null,
    commits: r.commits.length,
    level: releasable ? r.level : 'none',
    breaking: releasable && r.level === 'major',
    next: releasable ? r.next : null,
    tag: releasable ? `${r.prefix}${r.next}` : null,
    reasons: r.reasons.map((c) => ({ type: c.type, scope: c.scope, description: c.description, breaking: c.breaking, sha: c.sha })),
  };
}

const describe =(c) => `${c.breaking ? '💥 ' : ''}${c.type}${c.scope ? `(${c.scope})` : ''}: ${c.description}${c.sha ? ` (${c.sha.slice(0, 7)})` : ''}`;

/**
 * `--bump [--from <ref>] [--branch <ref>] [--apply] [--tag]`: suggests the next
 * semver version from the commits since the last tag (breaking → major,
 * feat → minor, fix and other code changes → patch, only docs/test/ci/chore →
 * none). Offline and read-only unless asked: `--apply` writes the version into
 * package.json, `--tag` creates a local annotated tag. Never commits or pushes.
 */
export async function runBumpMode() {
  const r = resolveRelease();
  if (bumpJson) return console.log(JSON.stringify(bumpSummary(r), null, 2));
  const since =r.baseRef ? `since ${r.baseRef}` : '(no tags yet — whole history)';

  console.log(`Current version: ${r.current}${r.baseRef ? ` (from ${r.baseRef})` : ''}`);
  console.log(`Commits ${since}: ${r.commits.length}\n`);

  if (r.commits.length === 0) {
    console.log('Nothing to release.');
    return;
  }
  if (r.level === 'none') {
    console.log(chalk.yellow('No releasable changes — only docs, tests, CI, style or chore commits. Keep the current version.'));
    return;
  }

  console.log(chalk.bold(`Suggested bump: ${r.level} → ${r.next}\n`));
  console.log('Because of:');
  r.reasons.slice(0, 8).forEach((c) => console.log(`  ${describe(c)}`));
  if (r.reasons.length > 8) console.log(`  …and ${r.reasons.length - 8} more`);

  if (releasePush && !bumpTag) die('--push needs --tag: it pushes the tag that --bump --tag creates.');
  if (releaseGithub && !(bumpTag && releasePush)) die('--github needs --tag --push: the GitHub Release is created for the tag you just pushed.');
  if (!bumpApply && !bumpTag) {
    console.log('\nRun again with --apply to write it into package.json, and/or --tag to create the git tag.');
    return;
  }

  // Check gh and the bot token before changing anything, so a missing login can't leave a half-done release.
  const ghToken = releaseGithub ? await resolveGhToken() : null;

  if (bumpApply) {
    if (!r.pkgText) die('--apply needs a package.json in the current directory.');
    const updated = setPackageVersion(r.pkgText, r.next);
    if (!updated) die('Could not find a top-level "version" in package.json.');
    fs.writeFileSync('package.json', updated, 'utf8');
    console.log(`\nUpdated package.json → ${r.next} (not committed).`);
  }
  if (bumpTag) {
    const tag = `${r.prefix}${r.next}`;
    if (resolveCommit(`refs/tags/${tag}`)) die(`Tag "${tag}" already exists.`);
    try {
      execFileSync('git', ['tag', '-a', tag, '-m', tag], { stdio: 'ignore' });
    } catch {
      die(`Could not create the tag "${tag}".`);
    }
    if (releasePush) {
      pushRefs([`refs/tags/${tag}`]); // only the tag, never forced
      console.log(`\nCreated tag ${tag} and pushed it to origin.`);
      if (releaseGithub) {
        try {
          console.log(chalk.green(`✔ GitHub Release: ${publishTagRelease({ tag, token: ghToken })}`));
        } catch (err) {
          die(`The tag is pushed but creating the GitHub Release failed: ${err.message}. Retry with: commitsmith --release-tags -y`);
        }
      }
    } else {
      console.log(`\nCreated local tag ${tag} (not pushed). Push it with: git push origin ${tag}  (or re-run with --tag --push)`);
    }
  }
}
