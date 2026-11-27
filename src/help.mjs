import chalk from 'chalk';

/**
 * Help system: `commitsmith --help` prints a short overview of every command;
 * `commitsmith help <command>`, `commitsmith <command> --help` and
 * `commitsmith --<flag> --help` print the full page for one command.
 */

export const GROUPS = ['Write commits', 'Review and safety', 'Versioning and releases', 'Pull requests', 'Setup and diagnostics'];

/** label = what the command looks like in the overview; options = [flag, description][]; examples = [command, comment][]. */
export const TOPICS = {
  commit: {
    group: 'Write commits',
    label: 'commitsmith',
    summary: 'generate a message for staged changes and commit (--split, --split-hunks, --group)',
    usage: ['commitsmith [--split | --split-hunks | --group] [--commit | -y]'],
    description:
      'Generates a conventional-commit message for your staged changes. By default one message covers everything staged; with nothing staged, a terminal run offers to stage files for you. Without --commit it only prints the message.',
    options: [
      ['--commit', 'Commit after a review menu: commit, edit in $EDITOR, change type or breaking flag, regenerate (optionally with an instruction), skip.'],
      ['-y', 'Commit without any confirmation.'],
      ['--split', 'One commit per file; related files are merged into one commit. Add --no-group-detection for strictly one per file.'],
      ['--split-hunks', 'One commit per diff hunk. Resets the index first; in a terminal you can pick and group hunks. Refuses if the same files have unstaged changes.'],
      ['--group', 'The model clusters related staged files into commits; in a terminal you can move files between groups before committing.'],
      ['--dry-run', 'With --split-hunks only: preview hunks and messages without staging or committing.'],
      ['--no-breaking-detection', 'Skip the breaking-change classification and the BREAKING CHANGE footer.'],
      ['--no-gitmoji', 'Drop the leading emoji from the message for this run.'],
      ['--no-secret-guard', 'Send diffs without redacting likely secrets (see: help scan).'],
      ['--no-style', 'Do not show the model this repository’s recent commits as style examples.'],
      ['--no-scope-hint', 'Do not infer the scope from the changed paths.'],
      ['--no-warnings', 'Skip the heads-up about oversized or mixed staged changes.'],
    ],
    examples: [
      ['commitsmith', 'preview a message for everything staged'],
      ['commitsmith --commit', 'generate, review, then commit'],
      ['commitsmith --group -y', 'let the model group files and commit each group'],
      ['commitsmith --split-hunks --dry-run', 'see how the hunks would be split'],
    ],
    notes: [
      'Breaking changes get a 💥 header and a final "BREAKING CHANGE: …" footer, checked by a second focused pass.',
      'A ticket in the branch name (feature/ABC-123-…) adds "Refs: ABC-123".',
      'Project rules (scopes, types, length, gitmoji) apply — see: help config.',
      'The model also sees your last few commit subjects (to match your style), and the scope is inferred from the changed paths (workspace package, folder under src/, or file name) when the files agree.',
      'A single commit of a very large or scattered change prints a warning suggesting --group or --split.',
    ],
    see: ['amend', 'fixup', 'reword', 'config'],
  },

  amend: {
    group: 'Write commits',
    label: '--amend',
    summary: "regenerate HEAD's message from its diff",
    usage: ['commitsmith --amend [-y [--force]]'],
    description:
      "Regenerates the message of the last commit from its own diff, shows the usual review menu and rewrites only the message. It refuses when changes are staged, because an amend would fold them in.",
    options: [
      ['-y', 'Amend without the review menu.'],
      ['--force', 'With -y, allow amending a commit that is already on a remote branch (needs a force-push afterwards).'],
    ],
    examples: [['commitsmith --amend', 'review a new message for HEAD']],
    notes: ['If HEAD is already pushed you are warned, and non-interactive runs need -y plus --force.'],
    see: ['commit'],
  },

  fixup: {
    group: 'Write commits',
    label: '--fixup',
    summary: 'attach staged changes to the earlier commit they belong to',
    usage: ['commitsmith --fixup [--autosquash] [-y]'],
    description:
      'Finds which earlier commit your staged changes belong to — git blame on the lines you changed, ranked by how many lines each commit owns — and records them as a "fixup!" commit for it. Only commits that are not pushed yet are candidates. No model is called.',
    options: [
      ['--autosquash', 'Also fold the fixup into its target right away with a non-interactive rebase (your unstaged changes are stashed and restored).'],
      ['-y', 'Take the top candidate without asking.'],
    ],
    examples: [
      ['commitsmith --fixup', 'pick the commit from a short list'],
      ['commitsmith --fixup --autosquash -y', 'fold it into the best match immediately'],
    ],
    notes: ['Brand-new files and code with no history cannot be attributed; make a normal commit for those.', 'Without a terminal and without -y it only prints the suggestion.'],
    see: ['reword', 'amend'],
  },

  reword: {
    group: 'Write commits',
    label: '--reword',
    summary: 'rewrite bad commit messages across a branch',
    usage: ['commitsmith --reword [--from <ref>] [--all] [-y] [--force]'],
    description:
      'Regenerates the messages of the commits on this branch that break your commit rules, each from its own diff, before you merge. The range is <default branch>..HEAD unless you pass --from. File contents never change: commits are re-created on the same trees with the same authors and dates, trailers such as Co-authored-by and Refs are kept, and the old tip is saved as a backup ref. A preview unless you confirm or pass -y.',
    options: [
      ['--from <ref>', 'Start the range after this ref instead of the default branch.'],
      ['--all', 'Reword every commit in the range, not just the ones that fail the rules.'],
      ['-y', 'Rewrite without the confirmation prompt.'],
      ['--force', 'Allow rewriting commits that are already on a remote branch (you then need git push --force-with-lease).'],
    ],
    examples: [
      ['commitsmith --reword', 'preview what would change on this branch'],
      ['commitsmith --reword -y', 'rewrite the failing messages'],
    ],
    notes: ['Needs a straight line of commits: merge commits in the range stop it. Commit signatures are not preserved.', 'The result prints the exact command that restores the old branch.'],
    see: ['lint-commits', 'amend', 'config'],
  },

  review: {
    group: 'Review and safety',
    label: '--review',
    summary: 'AI code review: problems ranked by severity, plus missing tests',
    usage: ['commitsmith --review [--from <ref> [--branch <ref>]] [--fail-on high|medium|low]'],
    description:
      'Reviews your staged (else unstaged) changes, or a range of commits, for real problems — bugs, security issues, data loss, unhandled errors — not style. Read-only. Large diffs are reviewed per file (first 30).',
    options: [
      ['--from <ref>', 'Review everything since this ref (tag, branch or commit) instead of your working changes.'],
      ['--branch <ref>', 'End of the range (default HEAD). Needs --from.'],
      ['--fail-on <level>', 'Exit 1 when a finding reaches this severity (default: never fail on findings).'],
    ],
    examples: [
      ['commitsmith --review', 'review what you are about to commit'],
      ['commitsmith --review --from main --fail-on high', 'CI gate for a branch'],
    ],
    notes: ['Exit codes: 0 ok · 1 a finding reached --fail-on · 2 part of the answer could not be parsed.'],
    see: ['breaking', 'check'],
  },

  breaking: {
    group: 'Review and safety',
    label: '--breaking',
    summary: 'dry run: detect breaking changes before you commit',
    usage: ['commitsmith --breaking [--from <ref> [--branch <ref>]]'],
    description:
      'Asks whether your changes break anything public — removed or renamed CLI flags, env vars, config keys, exported functions, routes, schemas, or changed defaults — and prints each finding with its impact and a ready-to-paste BREAKING CHANGE footer. Writes nothing.',
    options: [
      ['--from <ref>', 'Analyze everything since this ref instead of your staged (else unstaged) changes.'],
      ['--branch <ref>', 'End of the range (default HEAD). Needs --from.'],
    ],
    examples: [
      ['commitsmith --breaking', 'check staged changes'],
      ['commitsmith --breaking --from 1.0.0', 'would a release since 1.0.0 be breaking?'],
    ],
    notes: ['Exit codes: 0 none found · 1 breaking changes found · 2 part of the answer could not be parsed.'],
    see: ['check'],
  },

  check: {
    group: 'Review and safety',
    label: '--check',
    summary: "audit commit messages against their diffs (HEAD, or a whole range)",
    usage: ['commitsmith --check [--from <ref> [--branch <ref>]]'],
    description:
      "Re-classifies a commit's diff and warns when its message disagrees: a missed breaking-change flag, a wrong type, or a project-rule violation. Plain --check looks at HEAD; with --from it scans every non-merge commit in the range (the newest 50).",
    options: [
      ['--from <ref>', 'Scan every commit since this ref — a pre-release gate for unflagged breaking changes.'],
      ['--branch <ref>', 'End of the range (default HEAD). Needs --from.'],
    ],
    examples: [
      ['commitsmith --check', 'is the last commit message consistent?'],
      ['commitsmith --check --from 1.0.0', 'audit everything since the 1.0.0 tag'],
    ],
    notes: ['Read-only; exits 1 when issues are found, so it works as a CI check or a pre-push hook.'],
    see: ['breaking', 'hook'],
  },

  scan: {
    group: 'Review and safety',
    label: '--scan',
    summary: 'offline secret scan of your changes',
    usage: ['commitsmith --scan'],
    description:
      'Scans the added lines of your staged (else unstaged) changes for likely secrets — cloud API keys, tokens, private keys, credential assignments — and for sensitive files such as .env and *.pem. Offline: no model, no network. Never prints a full secret.',
    options: [],
    examples: [['commitsmith --scan', 'file:line, type and a masked sample for every hit']],
    notes: [
      'Exit 1 when anything is found, so it works as a pre-commit hook (see: help hook).',
      'Separately, every model request is passed through the secret guard: COMMITSMITH_SECRET_GUARD=redact (default) | block | off, or --no-secret-guard for one run.',
    ],
    see: ['hook'],
  },

  'lint-message': {
    group: 'Review and safety',
    label: '--lint-message',
    summary: 'check a commit message file (used by the commit-msg hook)',
    usage: ['commitsmith --lint-message <file>'],
    description:
      'Checks a message file the way the commit-msg hook does: "[emoji ]type(scope): subject", a known type, a subject within the length limit, plus your commitRules (allowed scopes and types, required scope). Merge, revert and fixup messages are exempt. Offline.',
    options: [],
    examples: [['commitsmith --lint-message .git/COMMIT_EDITMSG', 'lint the message being written']],
    notes: ['Exit 1 on violations. Rules are read straight from the config files — see: help config.'],
    see: ['hook', 'config'],
  },

  'lint-commits': {
    group: 'Review and safety',
    label: '--lint-commits',
    summary: 'check every commit message in a range (offline, for CI)',
    usage: ['commitsmith --lint-commits [--from <ref>] [--branch <ref>]'],
    description:
      'Checks each non-merge commit message in <ref>..<branch> against the commit rules (type, scope, subject length) — the CI counterpart of the commit-msg hook. The range defaults to the default branch..HEAD. Offline: no model, no config lookup beyond the rules.',
    options: [
      ['--from <ref>', 'Start of the range (in a pull request: the base commit).'],
      ['--branch <ref>', 'End of the range (default HEAD).'],
    ],
    examples: [['commitsmith --lint-commits --from origin/main', 'what a PR check runs']],
    notes: ['Exit 1 when any message fails. The repository ships a ready-made GitHub Action (action.yml) that runs this on pull requests — see the README.', 'Fix failures with: commitsmith --reword.'],
    see: ['reword', 'hook', 'check'],
  },

  hook: {
    group: 'Review and safety',
    label: 'hook',
    summary: 'install git hooks: secret scan, message lint, push gate',
    usage: ['commitsmith hook install [--pre-push] [--force]', 'commitsmith hook uninstall', 'commitsmith hook status'],
    description:
      'Manages git hooks that run commitsmith automatically. pre-commit runs --scan, commit-msg runs --lint-message; both are offline and fast. Optional pre-push runs --check --from @{u} and calls your model.',
    options: [
      ['install', 'Write the hooks (pre-commit and commit-msg).'],
      ['--pre-push', 'With install: also add the pre-push gate for unflagged breaking changes.'],
      ['--force', "With install: replace a hook you wrote yourself (it is backed up as <hook>.commitsmith-backup)."],
      ['uninstall', 'Remove only hooks commitsmith wrote; restores a backup if there is one.'],
      ['status', 'Show which hooks are installed, outdated, foreign or absent.'],
    ],
    examples: [['commitsmith hook install --pre-push', 'install all three hooks']],
    notes: [
      'Hooks do nothing when `commitsmith` is not on your PATH. Bypass once with `git commit --no-verify`.',
      'They respect core.hooksPath.',
    ],
    see: ['scan', 'lint-message', 'check'],
  },

  bump: {
    group: 'Versioning and releases',
    label: '--bump',
    summary: 'suggest the next semver from commits (offline)',
    usage: ['commitsmith --bump [--from <ref>] [--branch <ref>] [--apply] [--tag]'],
    description:
      'Reads the commits since the last tag and suggests the next version: a breaking change means major, feat/accessibility/removal minor, fix/perf/security/refactor/build (and unrecognized commits) patch; only docs/test/ci/style/chore means none. Offline and read-only unless you ask.',
    options: [
      ['--from <ref>', 'Use this ref as the base instead of the last tag.'],
      ['--branch <ref>', 'Target to compare (default HEAD).'],
      ['--apply', 'Write the new version into package.json (not committed).'],
      ['--tag', 'Create a local annotated tag with the same prefix style as the last tag (not pushed).'],
    ],
    examples: [
      ['commitsmith --bump', 'show the suggestion and why'],
      ['commitsmith --bump --apply --tag', 'update package.json and tag it'],
    ],
    notes: ['Nothing is committed or pushed.'],
    see: ['changelog', 'release-notes'],
  },

  changelog: {
    group: 'Versioning and releases',
    label: '--changelog',
    summary: 'full changelog: unreleased changes plus every tag (offline)',
    usage: ['commitsmith --changelog [--from <ref>] [--branch <ref>] [--release-version <v>] [--unreleased] [--all] [--output <file> | --stdout] [--rebuild]'],
    description:
      'Writes CHANGELOG.md (in the current directory) from git history: the unreleased changes first (commits since the newest tag), then every semver tag from newest to oldest with its date and the commits since the previous tag. Within each section breaking changes come first (with their footers), then commits grouped by type; ci, test, style and chore are hidden unless --all.',
    options: [
      ['--stdout', 'Print the changelog instead of writing a file.'],
      ['--output <file>', 'Write this file instead of CHANGELOG.md. Created if missing; otherwise [Unreleased] is refreshed and missing releases are inserted in order, while releases already in the file are left exactly as written.'],
      ['--unreleased', 'Only the unreleased section.'],
      ['--release-version <v>', 'Label the unreleased changes as this version (with today’s date) instead of [Unreleased] — use it when cutting a release.'],
      ['--from <ref>', 'Only history after this ref (tags up to it are left out).'],
      ['--branch <ref>', 'History up to this ref instead of HEAD.'],
      ['--all', 'Include ci, test, style and chore commits.'],
      ['--rebuild', 'Regenerate the whole file, replacing hand edits.'],
    ],
    examples: [
      ['commitsmith --changelog', 'create or refresh CHANGELOG.md'],
      ['commitsmith --changelog --release-version 1.1.0', 'cut 1.1.0: replaces [Unreleased]'],
      ['commitsmith --changelog --stdout', 'just print it'],
    ],
    notes: ['Offline: no model is called. Only semver tags (1.2.3 or v1.2.3) reachable from the target are listed.'],
    see: ['bump', 'release-notes'],
  },

  release: {
    group: 'Versioning and releases',
    label: '--release',
    summary: 'bump, changelog, commit, tag, push, GitHub Release in one go',
    usage: ['commitsmith --release [--release-version <v>] [--no-changelog] [--push] [--github [--draft] [--as-bot]] [-y]'],
    description:
      'Does the whole release: picks the next version from the commits since the last tag, writes it into package.json, adds a section to CHANGELOG.md, commits "chore(release): <tag>", and creates an annotated tag. With --push it pushes the branch and the tag; with --github it also creates the GitHub Release, using this version’s changelog section as the body. A preview until you confirm or pass -y; it refuses to start with uncommitted changes and never force-pushes.',
    options: [
      ['--release-version <v>', 'Release this version instead of the suggested one (must be newer than the current).'],
      ['--no-changelog', 'Skip CHANGELOG.md.'],
      ['--push', 'Push the branch and the tag to origin.'],
      ['--github', 'Create the GitHub Release for the pushed tag (needs --push and the gh CLI).'],
      ['--draft', 'With --github, create the release as a draft. Versions with a prerelease part are marked as pre-releases automatically.'],
      ['--as-bot', 'With --github, create the release as your GitHub App bot (see: help init github).'],
      ['-y', 'Perform every step without asking.'],
      ['--output <file>', 'Changelog file to update instead of CHANGELOG.md.'],
    ],
    examples: [
      ['commitsmith --release', 'preview the plan'],
      ['commitsmith --release -y --push --github', 'cut and publish a release'],
    ],
    notes: ['If your repository already tags releases in CI (for example on every merge to main), use --bump or --changelog instead so the two do not collide.', 'Offline unless --push or --github is used; no model is called.'],
    see: ['bump', 'changelog', 'release-notes'],
  },

  standup: {
    group: 'Versioning and releases',
    label: '--standup',
    summary: 'a short Done / In progress update from your recent commits',
    usage: ['commitsmith --standup [--since <when>] [--author <who|all>] [--all-branches] [--copy]'],
    description:
      'Summarizes what you did recently in plain language: your commits since the last working day (Monday looks back to Friday) plus the files you have uncommitted. The update goes to stdout, the header to stderr.',
    options: [
      ['--since <when>', 'How far back: anything git understands — "yesterday", "3 days ago", "2026-01-15".'],
      ['--author <who>', 'Report on someone else (a substring of name or email), or "all" for the whole team. Default: you (git user.email).'],
      ['--all-branches', 'Include commits on every local branch, not only the current one.'],
      ['--copy', 'Copy the update to the clipboard.'],
    ],
    examples: [
      ['commitsmith --standup', 'since the last working day'],
      ['commitsmith --standup --since "1 week ago" --all-branches --copy', 'a weekly summary, copied'],
    ],
    notes: [],
    see: ['release-notes'],
  },

  'release-notes': {
    group: 'Versioning and releases',
    label: '--release-notes',
    summary: 'user-facing release notes for store listings',
    usage: ['commitsmith --release-notes [--from <ref>] [--branch <ref>] [--max-chars <n>] [--store <preset>] [--lang <list>] [--output <file>] [--copy]'],
    description:
      'Writes short, plain-language release-note bullets from the commits and diff since the last tag, ready to paste into the Play Store, App Store or a release page. In a terminal you get a guided flow: pick the range, pick the destination, review and edit the bullets, add languages, then print, copy or save.',
    options: [
      ['--from <ref>', 'Base ref instead of the last tag reachable from the target.'],
      ['--branch <ref>', 'Target to compare (default HEAD).'],
      ['--max-chars <n>', 'Drop the least notable trailing bullets until the text fits.'],
      ['--store <preset>', 'Limit preset: play (500), app-store (4000) or github (none).'],
      ['--lang <list>', 'Also translate the bullets, e.g. fr,sw.'],
      ['--output <file>', 'Save the notes to a file.'],
      ['--copy', 'Copy the notes to the clipboard.'],
    ],
    examples: [['commitsmith --release-notes --store play --lang fr --copy', 'Play Store notes in two languages']],
    notes: ['Only the bullets go to stdout; progress goes to stderr, so redirecting to a file works. Describe your product with releaseNotesContext (see: help config).'],
    see: ['changelog', 'bump'],
  },

  pr: {
    group: 'Pull requests',
    label: '--pr',
    summary: 'generate a PR title and description; open or update it via gh',
    usage: ['commitsmith --pr [--base <branch>] [--create | -y] [--draft] [--as-bot]'],
    description:
      "Writes a pull request title and description from the branch's commits and diff, with Summary, Breaking changes (from commit footers) and Test plan sections. Preview only until you ask: --create pushes the branch if needed and opens the PR through the GitHub CLI.",
    options: [
      ['--base <branch>', "Branch to compare against and open the PR into (default: origin's default branch)."],
      ['--create', 'Push and open the PR (or update the open one). -y does the same.'],
      ['--draft', 'Open as a draft.'],
      ['--as-bot', 'Create it as a bot instead of your own login (see: help init github).'],
    ],
    examples: [
      ['commitsmith --pr', 'preview the title and description'],
      ['commitsmith --pr --create --draft', 'open a draft PR'],
    ],
    notes: [
      'If a PR is already open for the branch it is updated, not duplicated. It never force-pushes.',
      'Needs the GitHub CLI (`gh auth login`). A ticket in the branch name adds a "Refs:" line.',
    ],
    see: ['init github', 'review'],
  },

  init: {
    group: 'Setup and diagnostics',
    label: 'init',
    summary: 'interactive setup: provider, model, config file',
    usage: ['commitsmith init'],
    description:
      'Walks you through choosing a provider (Ollama, Ollama Cloud, OpenAI, Anthropic), host and model — with a live model list — and saves it to a project .commitsmithrc.json or your global config. API keys can go to the OS keychain.',
    options: [],
    examples: [['commitsmith init', 'first-time setup']],
    notes: ['A project config replaces your global one entirely, so give it its own provider and model.'],
    see: ['init github', 'use', 'doctor', 'config'],
  },

  'init github': {
    group: 'Setup and diagnostics',
    label: 'init github',
    summary: 'set up opening PRs as a GitHub App bot',
    usage: ['commitsmith init github'],
    description:
      'Guides you through creating a GitHub App, then asks for its App ID and private-key (.pem) file, verifies them against GitHub (including that the App is installed on this repo) and saves the settings. The key file can be copied into commitsmith’s config folder; its contents are never written into a config.',
    options: [],
    examples: [['commitsmith init github', 'then: commitsmith --pr --create --as-bot']],
    notes: ['The key path always goes in your global config; the App ID and defaults can be global or project-level.'],
    see: ['pr', 'doctor'],
  },

  use: {
    group: 'Setup and diagnostics',
    label: 'use',
    summary: 'switch quickly between configured providers',
    usage: ['commitsmith use'],
    description:
      'Switches to a provider you have already set up (local Ollama, or a cloud provider whose key is in your keychain) and asks only for the model. Everything else in your config is left alone.',
    options: [],
    examples: [['commitsmith use', 'pick another provider or model']],
    notes: [],
    see: ['init', 'doctor'],
  },

  doctor: {
    group: 'Setup and diagnostics',
    label: 'doctor',
    summary: 'check the whole setup and say what is wrong',
    usage: ['commitsmith doctor'],
    description:
      'Checks Node, provider, config file, API key, provider reachability, whether your model exists, the GitHub CLI, the GitHub App, secret-guard mode, commit rules, the ticket in your branch name, installed hooks, and whether commitsmith is on your PATH.',
    options: [],
    examples: [['commitsmith doctor', '✔ / ⚠ / ✖ per item']],
    notes: ['Exits 1 if anything is broken. Works outside a git repository too.'],
    see: ['init', 'hook'],
  },

  config: {
    group: 'Setup and diagnostics',
    label: 'help config',
    summary: 'environment variables and config-file keys',
    usage: ['commitsmith help config'],
    description:
      'Precedence: environment variable > config file > OS keychain (API key only) > built-in default. The config file is a cosmiconfig-style "commitsmith" config (.commitsmithrc.json, a "commitsmith" key in package.json, …) or your global config. A project config replaces the global one, except commitRules, ticket and GitHub App keys, which fall back to it.',
    options: [
      ['COMMITSMITH_PROVIDER', 'ollama (default) | ollama-cloud | openai | anthropic'],
      ['COMMITSMITH_MODEL / _HOST / _API_KEY', 'model, API host and key (keychain is used when no key is set)'],
      ['COMMITSMITH_MAX_DIFF / _TIMEOUT_MS', 'characters of diff sent (6000) and request timeout (60000)'],
      ['COMMITSMITH_GROUP_MAX_DIFF_PER_FILE', 'per-file diff budget in --group (1200)'],
      ['COMMITSMITH_FALLBACK_MODELS', 'comma-separated models to retry with'],
      ['COMMITSMITH_SECRET_GUARD', 'redact (default) | block | off'],
      ['COMMITSMITH_TICKET_FOOTER', 'footer word for ticket links (Refs)'],
      ['COMMITSMITH_STYLE_EXAMPLES', 'recent commit subjects shown to the model as style examples (8; 0 = off)'],
      ['config: inferScope, diffWarnings', 'false turns off scope inference from paths / the oversized-change warnings'],
      ['COMMITSMITH_RELEASE_NOTES_CONTEXT', 'one-line product description for release notes'],
      ['COMMITSMITH_PR_AS_BOT, _GH_TOKEN', 'open PRs as a bot; a bot account token'],
      ['COMMITSMITH_GH_APP_ID / _KEY_PATH / _INSTALLATION_ID', 'GitHub App credentials (id, .pem path, optional installation)'],
      ['config: commitRules', '{ scopes, requireScope, allowedTypes, maxSubjectLength, gitmoji }'],
      ['config: ticketLinks, ticketPattern, ticketFooter', 'ticket links from branch names'],
      ['config: breakingDetection, secretGuard, fallbackModels, …', 'same names in camelCase as the env vars'],
      ['config: githubAppId, githubAppKeyPath, githubAppInstallationId, prAsBot', 'GitHub App settings'],
    ],
    examples: [],
    notes: ['`commitsmith init` and `commitsmith doctor` are the easiest way to set up and verify all of this.'],
    see: ['init', 'doctor'],
  },
};

const GLOBAL_OPTIONS = [
  ['--no-interactive', 'Never prompt (automatic when piped or CI is set). --interactive forces prompts on a terminal.'],
  ['--no-breaking-detection', 'Skip breaking-change classification.'],
  ['--no-gitmoji', 'Generate messages without the leading emoji.'],
  ['--no-secret-guard', 'Do not redact likely secrets from what is sent to the model.'],
  ['-h, --help [command]', 'Show this overview, or the page for one command.'],
  ['-v, --version', 'Print the installed version.'],
];

/** flag → topic, for `commitsmith --pr --help` and friends. */
const FLAG_TOPICS = {
  '--split': 'commit',
  '--split-hunks': 'commit',
  '--group': 'commit',
  '--commit': 'commit',
  '-y': 'commit',
  '--dry-run': 'commit',
  '--amend': 'amend',
  '--fixup': 'fixup',
  '--autosquash': 'fixup',
  '--reword': 'reword',
  '--lint-commits': 'lint-commits',
  '--release': 'release',
  '--push': 'release',
  '--github': 'release',
  '--standup': 'standup',
  '--review': 'review',
  '--breaking': 'breaking',
  '--check': 'check',
  '--scan': 'scan',
  '--lint-message': 'lint-message',
  '--bump': 'bump',
  '--changelog': 'changelog',
  '--release-notes': 'release-notes',
  '--pr': 'pr',
};

const ALIASES = {
  split: 'commit',
  group: 'commit',
  hunks: 'commit',
  'split-hunks': 'commit',
  commit: 'commit',
  hooks: 'hook',
  lint: 'lint-message',
  'stand-up': 'standup',
  releasenotes: 'release-notes',
  notes: 'release-notes',
  'pull-request': 'pr',
  github: 'init github',
  setup: 'init',
  env: 'config',
  configuration: 'config',
  settings: 'config',
};

/** "--Release_Notes" / "release notes" → a topic key, or null when there is no such topic. */
export function normalizeTopic(input) {
  const spaced = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^-+/, '')
    .replace(/[_\s]+/g, ' ');
  for (const key of [spaced, spaced.replace(/ /g, '-')]) {
    if (Object.hasOwn(TOPICS, key)) return key;
    if (Object.hasOwn(ALIASES, key)) return ALIASES[key];
  }
  return null;
}

/**
 * Decides what help to show from the command line:
 *  `help <topic>`                 → that topic ({ unknown } for a bad one)
 *  `<command> --help`             → init / init github / use / hook / doctor
 *  `--<flag> … --help`            → the command that flag belongs to
 *  anything else                  → { topic: null } (the overview)
 */
export function resolveHelp(args) {
  if (args[0] === 'help') {
    const words = args.slice(1).filter((a) => a !== '-h' && a !== '--help');
    if (words.length === 0) return { topic: null };
    const topic = normalizeTopic(words.join(' '));
    return topic ? { topic } : { unknown: words.join(' ') };
  }
  if (args[0] === 'init') return { topic: args[1] === 'github' ? 'init github' : 'init' };
  if (['use', 'hook', 'doctor'].includes(args[0])) return { topic: args[0] };
  for (const a of args) if (Object.hasOwn(FLAG_TOPICS, a)) return { topic: FLAG_TOPICS[a] };
  return { topic: null };
}

function wrap(text, width, indent) {
  const pad = ' '.repeat(indent);
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => pad + l).join('\n');
}

function table(rows, indent = 2, width = 78, minLabelWidth = 0) {
  const labelWidth = Math.min(Math.max(minLabelWidth, ...rows.map(([l]) => l.length)), 34);
  return rows
    .map(([label, text]) => {
      if (label.length > labelWidth) return `${' '.repeat(indent)}${chalk.bold(label)}\n${wrap(text, width - indent - labelWidth - 2, indent + labelWidth + 2)}`;
      const body = wrap(text, width - indent - labelWidth - 2, indent + labelWidth + 2).slice(indent + labelWidth + 2);
      return `${' '.repeat(indent)}${chalk.bold(label.padEnd(labelWidth))}  ${body}`;
    })
    .join('\n');
}

/** Short overview of every command, grouped; each line points at `help <command>`. */
export function renderOverview() {
  const out = [
    `${chalk.bold('commitsmith')} — commit messages, reviews and releases backed by a local or cloud model`,
    '',
    'Usage: commitsmith [command] [options]        (also installed as: csmith, csm)',
  ];
  const labelWidth = Math.max(...Object.values(TOPICS).map((t) => t.label.length)); // one shared column across groups
  for (const group of GROUPS) {
    const rows = Object.values(TOPICS)
      .filter((t) => t.group === group)
      .map((t) => [t.label, t.summary]);
    out.push('', chalk.bold(group), table(rows, 2, 78, labelWidth));
  }
  out.push('', chalk.bold('Options for every command'), table(GLOBAL_OPTIONS));
  out.push('', `Run ${chalk.bold('commitsmith help <command>')} (or ${chalk.bold('commitsmith <command> --help')}) for the full page, e.g. commitsmith help pr.`);
  return out.join('\n');
}

/** Full help page for one topic key. */
export function renderTopic(key) {
  const t = TOPICS[key];
  const title = key === 'commit' ? 'commitsmith' : key === 'config' ? 'configuration' : t.label;
  const out = [`${chalk.bold(title)} — ${t.summary}`, ''];
  out.push(chalk.bold('Usage'), ...t.usage.map((u) => `  ${u}`), '', wrap(t.description, 78, 0));
  if (t.options.length > 0) out.push('', chalk.bold(key === 'config' ? 'Settings' : 'Options'), table(t.options));
  if (t.examples.length > 0) {
    out.push('', chalk.bold('Examples'));
    const width = Math.max(...t.examples.map(([c]) => c.length));
    t.examples.forEach(([cmd, note]) => out.push(`  ${cmd.padEnd(width)}  ${chalk.dim(`# ${note}`)}`));
  }
  if (t.notes.length > 0) out.push('', chalk.bold('Notes'), ...t.notes.map((n) => `  - ${wrap(n, 74, 4).slice(4)}`));
  if (t.see?.length > 0) out.push('', `See also: ${t.see.map((s) => `commitsmith help ${s}`).join(' · ')}`);
  return out.join('\n');
}

/** Prints the overview or one command's page for the given command line; an unknown topic lists the valid ones and exits 1. */
export function printHelp(args = process.argv.slice(2)) {
  const { topic, unknown } = resolveHelp(args);
  if (unknown) {
    console.error(`No help for "${unknown}". Topics: ${Object.keys(TOPICS).join(', ')}.\n`);
    console.log(renderOverview());
    process.exitCode = 1;
    return;
  }
  console.log(topic ? renderTopic(topic) : renderOverview());
}
