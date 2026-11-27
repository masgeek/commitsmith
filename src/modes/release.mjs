import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as clack from '@clack/prompts';
import chalk from 'chalk';
import semver from 'semver';
import { loadConfig } from '../config.mjs';
import {
  getCurrentBranch,
  getCommitsDetailed,
  getRemoteUrl,
  getStagedFiles,
  hasTrackedChanges,
  listVersionTags,
  resolveCommit,
  pushRefs,
} from '../git.mjs';
import { compareVersions, mergeChangelogSections, renderChangelog } from '../conventional.mjs';
import { buildChangelogSections } from './changelog.mjs';
import { resolveRelease, setPackageVersion } from './bump.mjs';
import { checkGh, createGithubRelease } from '../github.mjs';
import { resolveBotToken } from '../github-auth.mjs';
import { isInteractive } from '../tty.mjs';
import { releaseNotesBranch, releaseNotesFromRef, releaseNotesOutput, releaseVersion, releasePush, releaseGithub, noChangelog, prDraft, prAsBot, autoYes } from '../cli-args.mjs';
import { die } from '../die.mjs';

const CHANGELOG_FILE = 'CHANGELOG.md';

export const releaseCommitMessage = (tag) => `chore(release): ${tag}`;

/** A changelog section's body without its "## [version] - date" heading — the text for a GitHub Release. */
export function releaseBody(sectionMarkdown) {
  return String(sectionMarkdown ?? '')
    .replace(/^## .*\n+/, '')
    .trim();
}

/** The version to release: --release-version when valid and newer than `current`, else the suggested bump. Throws on a bad override. */
export function chooseVersion({ current, suggested, override }) {
  if (!override) return suggested;
  const v = semver.valid(override.replace(/^v/, ''));
  if (!v) throw new Error(`--release-version "${override}" is not a valid semantic version.`);
  if (compareVersions(v, current) <= 0) throw new Error(`--release-version ${v} must be newer than the current version ${current}.`);
  return v;
}

function git(args) {
  try {
    execFileSync('git', args, { stdio: 'inherit' });
  } catch {
    die(`git ${args[0]} failed.`);
  }
}

/**
 * `--release [--release-version <v>] [--no-changelog] [--push] [--github [--draft] [--as-bot]] [-y]`
 *
 * One command for the whole release: suggests the version from the commits
 * since the last tag (or takes --release-version), writes it into package.json,
 * updates CHANGELOG.md, commits "chore(release): <tag>", creates an annotated
 * tag, and with --push pushes the branch and the tag, with --github also
 * creates the GitHub Release (body = this version's changelog section).
 * A preview unless -y (or you confirm in a terminal). Never forces a push,
 * and refuses to start with uncommitted changes. Offline apart from push/gh.
 */
export async function runReleaseMode() {
  if (releaseNotesBranch) die('--release works on the checked-out branch; drop --branch.');
  if (releaseGithub && !releasePush) die('--github needs --push: the GitHub Release is created for a tag that is already on the remote.');

  const branch = getCurrentBranch();
  if (!branch) die('Detached HEAD: check out the branch you want to release from.');

  const r = resolveRelease();
  if (r.commits.length === 0) return console.log('Nothing to release: no commits since the last tag.');
  if (r.level === 'none' && !releaseVersion) {
    return console.log(chalk.yellow('No releasable changes (only docs, tests, CI, style or chore). Use --release-version <v> to release anyway.'));
  }

  let next;
  try {
    next = chooseVersion({ current: r.current, suggested: r.next, override: releaseVersion });
  } catch (err) {
    die(err.message);
  }
  const tag = `${r.prefix}${next}`;
  if (resolveCommit(`refs/tags/${tag}`)) die(`Tag "${tag}" already exists.`);

  const hasPkg = Boolean(r.pkgText && setPackageVersion(r.pkgText, next));
  const steps = [
    hasPkg ? `set package.json version → ${next}` : null,
    noChangelog ? null : `update ${CHANGELOG_FILE} with a [${next}] section`,
    `commit "${releaseCommitMessage(tag)}" and tag ${tag}`,
    releasePush ? `push ${branch} and ${tag} to origin` : null,
    releaseGithub ? `create the GitHub Release ${tag}${prDraft ? ' (draft)' : ''}` : null,
  ].filter(Boolean);

  console.log(`Releasing ${r.current} → ${chalk.bold(next)}  (${r.level === 'none' ? 'forced' : r.level}; ${r.commits.length} commit(s) since ${r.baseRef ?? 'the start'})\n`);
  steps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log();

  if (hasTrackedChanges() || getStagedFiles().length > 0) {
    die('You have uncommitted changes. The release commit must contain only the version and changelog — commit or stash first.');
  }

  // Everything that can fail cheaply is checked before the first change.
  let token = null;
  if (releaseGithub) {
    const { GITHUB_BOT } = await loadConfig();
    if (prAsBot || GITHUB_BOT.asDefault) {
      try {
        token = await resolveBotToken({ bot: GITHUB_BOT, remoteUrl: getRemoteUrl('origin') });
      } catch (err) {
        die(err.message);
      }
    }
    const gh = checkGh(token);
    if (!gh.ok) die(gh.reason);
  }

  if (!autoYes) {
    if (!isInteractive()) return console.log('Preview only. Re-run with -y to perform these steps.');
    const go = await clack.confirm({ message: 'Perform these steps?', initialValue: false });
    if (clack.isCancel(go) || !go) return console.log('Aborted. Nothing changed.');
  }

  const files = [];
  if (hasPkg) {
    fs.writeFileSync('package.json', setPackageVersion(r.pkgText, next), 'utf8');
    files.push('package.json');
  }

  // The new version's changelog section (also the GitHub Release body).
  const sections = buildChangelogSections({
    tags: listVersionTags('HEAD'),
    from: releaseNotesFromRef,
    commitsFor: (base, to) => getCommitsDetailed(base, to ?? 'HEAD'),
    unreleasedLabel: next,
    today: new Date().toISOString().slice(0, 10),
  });
  if (!noChangelog) {
    const file = releaseNotesOutput || CHANGELOG_FILE;
    let existing = '';
    try {
      existing = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') die(`Could not read ${file}: ${err.code || err.message}`);
    }
    fs.writeFileSync(file, existing.trim() ? mergeChangelogSections(existing, sections) : renderChangelog(sections), 'utf8');
    files.push(file);
  }

  if (files.length > 0) {
    git(['add', '--', ...files]);
    git(['commit', '-m', releaseCommitMessage(tag)]);
  }
  git(['tag', '-a', tag, '-m', tag]);
  console.log(chalk.green(`\n✔ Committed and tagged ${tag}.`));

  if (releasePush) pushRefs([branch, tag]);

  if (releaseGithub) {
    try {
      const url = createGithubRelease({
        tag,
        title: tag,
        notes: releaseBody(sections[0].markdown),
        prerelease: Boolean(semver.prerelease(next)),
        draft: prDraft,
        token,
      });
      console.log(chalk.green(`✔ GitHub Release: ${url}`));
    } catch (err) {
      die(`The tag is pushed but creating the GitHub Release failed: ${err.message}`);
    }
  } else if (!releasePush) {
    console.log(`Not pushed. Publish it with: git push origin ${branch} ${tag}`);
  }
}
