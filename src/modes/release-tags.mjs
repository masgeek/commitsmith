import * as clack from '@clack/prompts';
import chalk from 'chalk';
import semver from 'semver';
import { loadConfig } from '../config.mjs';
import { getCommitsDetailed, getRemoteUrl, listRemoteTags, listVersionTags, resolveCommit } from '../git.mjs';
import { buildChangelogSections } from './changelog.mjs';
import { releaseBody } from './release.mjs';
import { checkGh, createGithubRelease, listReleaseTags } from '../github.mjs';
import { resolveBotToken } from '../github-auth.mjs';
import { isInteractive } from '../tty.mjs';
import { releaseNotesBranch, rewordAll, prDraft, prAsBot, autoYes } from '../cli-args.mjs';
import { die } from '../die.mjs';

/**
 * Which tags to publish: `tags` is newest-first ({ tag, version }[]), `released`
 * the tag names that already have a GitHub Release. By default only the newest
 * tag, and only when it has no release yet; with `all` every tag without one,
 * oldest first (a backfill). Each entry says whether it should be marked the
 * repository's "latest" release: only the newest, and never a prerelease.
 */
export function planReleases(tags, released, all = false) {
  const have = new Set(released);
  const missing = tags.filter((t) => !have.has(t.tag));
  const picked = all ? [...missing].reverse() : missing.length > 0 && missing[0] === tags[0] ? [tags[0]] : [];
  return picked.map((t) => ({ ...t, latest: t === tags[0] && !semver.prerelease(t.version) }));
}

/**
 * Checks that `gh` works and resolves the bot token when --as-bot (or the
 * prAsBot setting) asks for it. Exits with a clear message otherwise. Returns
 * the token (null = use your own gh login).
 */
export async function resolveGhToken() {
  const { GITHUB_BOT } = await loadConfig();
  let token = null;
  if (prAsBot || GITHUB_BOT.asDefault) {
    try {
      token = await resolveBotToken({ bot: GITHUB_BOT, remoteUrl: getRemoteUrl('origin') });
    } catch (err) {
      die(err.message);
    }
  }
  const gh = checkGh(token);
  if (!gh.ok) die(gh.reason);
  return token;
}

/** Creates the GitHub Release for one (already pushed) tag from its changelog section; returns the release URL. */
export function publishTagRelease({ tag, token = null, target = 'HEAD', latest = undefined }) {
  const tags = listVersionTags(target);
  const entry = tags.find((t) => t.tag === tag);
  if (!entry) throw new Error(`"${tag}" is not a version tag reachable from ${target}.`);
  const sections = buildChangelogSections({
    tags,
    commitsFor: (base, to) => getCommitsDetailed(base, to ?? target),
    unreleasedLabel: null,
    today: new Date().toISOString().slice(0, 10),
  });
  const section = sections.find((s) => !s.unreleased && s.version === entry.version);
  return createGithubRelease({
    tag,
    title: tag,
    notes: section ? releaseBody(section.markdown) : '',
    prerelease: Boolean(semver.prerelease(entry.version)),
    draft: prDraft,
    latest,
    token,
  });
}

/**
 * `--release-tags [--all] [--draft] [--as-bot] [-y]`: publishes GitHub
 * Releases for tags that have none — the follow-up to `--bump --tag --push`
 * (or any tag you pushed). Notes are each tag's changelog section (breaking
 * changes first), built from git history; no model. Default: the newest tag
 * if it has no release; --all backfills every tag without one. Only tags that
 * are already on origin qualify. A preview until -y or a terminal confirmation.
 */
export async function runReleaseTagsMode() {
  const target = releaseNotesBranch || 'HEAD';
  if (!resolveCommit(target)) die(`--branch: "${target}" is not a valid ref in this repo.`);

  const token = await resolveGhToken();

  const tags = listVersionTags(target);
  if (tags.length === 0) return console.log('No version tags found — create one first (commitsmith --bump --tag --push).');

  let released;
  try {
    released = listReleaseTags(token);
  } catch (err) {
    die(`Could not list the existing releases: ${err.message}`);
  }

  const onRemote = new Set(listRemoteTags());
  const plan = planReleases(tags, released, rewordAll);
  const unpushed = plan.filter((p) => !onRemote.has(p.tag));
  const todo = plan.filter((p) => onRemote.has(p.tag));
  unpushed.forEach((p) => console.warn(chalk.yellow(`⚠ ${p.tag} is not on origin yet — push it first (git push origin ${p.tag}).`)));

  if (todo.length === 0) {
    if (plan.length === 0) {
      const older = tags.filter((t) => !released.includes(t.tag)).length;
      console.log(
        tags[0] && released.includes(tags[0].tag)
          ? `${tags[0].tag} already has a release.${older > 0 ? ` ${older} older tag(s) have none — use --all to backfill them.` : ''}`
          : 'Nothing to publish.'
      );
    }
    return;
  }

  console.log(`Releases to create${prDraft ? ' (as drafts)' : ''}:\n`);
  todo.forEach((p) => console.log(`  ${p.tag}${p.latest ? '  (latest)' : ''}${semver.prerelease(p.version) ? '  (pre-release)' : ''}`));
  console.log();

  if (!autoYes) {
    if (!isInteractive()) return console.log('Preview only. Re-run with -y to create them.');
    const go = await clack.confirm({ message: `Create ${todo.length} GitHub release(s)?`, initialValue: false });
    if (clack.isCancel(go) || !go) return console.log('Aborted. Nothing created.');
  }

  const sections = buildChangelogSections({
    tags,
    commitsFor: (base, to) => getCommitsDetailed(base, to ?? target),
    unreleasedLabel: null,
    today: new Date().toISOString().slice(0, 10),
  });

  let failed = 0;
  for (const p of todo) {
    const section = sections.find((s) => !s.unreleased && s.version === p.version);
    try {
      const url = createGithubRelease({
        tag: p.tag,
        title: p.tag,
        notes: section ? releaseBody(section.markdown) : '',
        prerelease: Boolean(semver.prerelease(p.version)),
        draft: prDraft,
        // A single release is left to GitHub; a backfill must pin which one is "latest".
        latest: todo.length > 1 ? p.latest : undefined,
        token,
      });
      console.log(chalk.green(`✔ ${p.tag}: ${url}`));
    } catch (err) {
      failed++;
      console.error(chalk.red(`✖ ${p.tag}: ${err.message}`));
    }
  }
  if (failed > 0) process.exitCode = 1;
}
