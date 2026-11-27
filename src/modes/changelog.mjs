import fs from 'node:fs';
import {
  formatChangelogSection,
  buildReleaseRanges,
  renderChangelog,
  mergeChangelogSections,
} from '../conventional.mjs';
import { getCommitsDetailed, listVersionTags, isStrictAncestor, resolveCommit } from '../git.mjs';
import {
  releaseNotesFromRef,
  releaseNotesBranch,
  releaseNotesOutput,
  releaseVersion,
  changelogAll,
  changelogUnreleasedOnly,
  changelogRebuild,
  changelogStdout,
} from '../cli-args.mjs';

/** Where the changelog is written when --output isn't given. */
export const DEFAULT_CHANGELOG_FILE = 'CHANGELOG.md';
import { die } from '../die.mjs';

/**
 * Builds the changelog sections, newest first: the unreleased changes (commits
 * since the newest tag) followed by one section per semver tag, each holding
 * the commits since the previous tag. `from` limits the history to what came
 * after that ref. Pure apart from `commitsFor(base)`, which returns the commits
 * in base..target (base null = the start of history).
 */
export function buildChangelogSections({ tags, from = null, commitsFor, all = false, unreleasedLabel = null, today }) {
  const included = from ? tags.filter((t) => isStrictAncestor(from, t.tag)) : tags;
  const releases = buildReleaseRanges(included, from);

  const unreleasedBase = included[0]?.tag ?? from;
  const sections = [
    {
      unreleased: true,
      version: unreleasedLabel,
      markdown: formatChangelogSection({ version: unreleasedLabel, date: today, commits: commitsFor(unreleasedBase, null), all }),
    },
  ];
  for (const r of releases) {
    sections.push({
      unreleased: false,
      version: r.version,
      markdown: formatChangelogSection({ version: r.version, date: r.date, commits: commitsFor(r.base, r.tag), all }),
    });
  }
  return sections;
}

/**
 * `--changelog [--from <ref>] [--branch <ref>] [--release-version <v>] [--all]
 *  [--unreleased] [--rebuild] [--output <file>] [--stdout]`
 *
 * Writes CHANGELOG.md (or --output <file>); --stdout prints instead. A full
 * changelog from git history: the unreleased changes first, then every
 * semver tag newest to oldest with its date and the commits since the previous
 * tag — breaking changes (with their footers) first, then commits by type;
 * ci/test/style/chore are hidden unless --all. Offline, no model.
 *  --release-version v   label the unreleased changes as v (today's date) instead of [Unreleased]
 *  --unreleased          only the unreleased section
 *  --from <ref>          only history after that ref
 *  --stdout              print instead of writing a file
 *  --output <file>       write this file instead of CHANGELOG.md: created if missing; otherwise [Unreleased] is refreshed
 *                        and missing releases are inserted, while releases already in the file
 *                        are left as written (--rebuild regenerates the whole file)
 */
export function runChangelogMode() {
  const targetRef = releaseNotesBranch || 'HEAD';
  if (!resolveCommit(targetRef)) die(`--branch: "${targetRef}" is not a valid ref in this repo.`);
  if (releaseNotesFromRef && !resolveCommit(releaseNotesFromRef)) die(`--from: "${releaseNotesFromRef}" is not a valid ref in this repo.`);

  const tags = listVersionTags(targetRef);
  const sections = buildChangelogSections({
    tags,
    from: releaseNotesFromRef,
    commitsFor: (base, tag) => getCommitsDetailed(base, tag ?? targetRef),
    all: changelogAll,
    unreleasedLabel: releaseVersion,
    today: new Date().toISOString().slice(0, 10),
  });

  if (tags.length === 0 && !releaseNotesFromRef) {
    console.error('No version tags found — the whole history is shown as unreleased.');
  }

  const wanted = changelogUnreleasedOnly ? sections.slice(0, 1) : sections;

  if (changelogStdout) {
    console.log(changelogUnreleasedOnly ? wanted[0].markdown : renderChangelog(wanted).trimEnd());
    return;
  }

  const file = releaseNotesOutput || DEFAULT_CHANGELOG_FILE;
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') die(`Could not read ${file}: ${err.code || err.message}`);
  }

  const content = changelogRebuild || !existing.trim() ? renderChangelog(wanted) : mergeChangelogSections(existing, wanted);
  try {
    fs.writeFileSync(file, content, 'utf8');
  } catch (err) {
    die(`Could not write ${file}: ${err.code || err.message}`);
  }
  const releases = wanted.filter((s) => !s.unreleased).length;
  console.error(
    `${existing.trim() ? (changelogRebuild ? 'Rebuilt' : 'Updated') : 'Created'} ${file}: ` +
      `${releaseVersion ? `[${releaseVersion}]` : '[Unreleased]'} plus ${releases} release${releases === 1 ? '' : 's'}.`
  );
}
