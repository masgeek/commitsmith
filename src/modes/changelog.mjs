import fs from 'node:fs';
import { formatChangelogSection, insertChangelogSection } from '../conventional.mjs';
import { releaseNotesOutput, releaseVersion, changelogAll } from '../cli-args.mjs';
import { die } from '../die.mjs';
import { resolveRelease } from './bump.mjs';

/**
 * `--changelog [--from <ref>] [--branch <ref>] [--release-version <v>] [--all] [--output <file>]`:
 * builds a Keep-a-Changelog-style section from the commits since the last tag —
 * breaking changes (with their footers) first, then commits grouped by type;
 * ci/test/style/chore are hidden unless `--all`. The heading version is
 * `--release-version`, else the suggested next version, else "Unreleased".
 * Offline, no model. Prints to stdout, or with `--output` inserts/replaces the
 * section in that file (created if missing).
 */
export function runChangelogMode() {
  const r = resolveRelease();
  if (r.commits.length === 0) die(`No commits since ${r.baseRef ?? 'the start'} — nothing to put in a changelog.`);

  const version = releaseVersion || (r.level === 'none' ? null : r.next);
  const section = formatChangelogSection({
    version,
    date: new Date().toISOString().slice(0, 10),
    commits: r.commits,
    all: changelogAll,
  });

  if (!releaseNotesOutput) {
    console.log(section);
    return;
  }

  let existing = '';
  try {
    existing = fs.readFileSync(releaseNotesOutput, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') die(`Could not read ${releaseNotesOutput}: ${err.code || err.message}`);
  }
  try {
    fs.writeFileSync(releaseNotesOutput, insertChangelogSection(existing, section), 'utf8');
  } catch (err) {
    die(`Could not write ${releaseNotesOutput}: ${err.code || err.message}`);
  }
  console.error(`${existing ? 'Updated' : 'Created'} ${releaseNotesOutput} with the ${version ? `[${version}]` : '[Unreleased]'} section.`);
}
