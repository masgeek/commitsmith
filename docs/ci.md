# Using commitsmith in CI

← Back to the [README](../README.md)

Everything below is non-interactive: when `CI` is set (or stdin/stdout isn't a terminal, or
you pass `--no-interactive`) commitsmith never prompts. Checks fail through their **exit
code**, so they work as gates in any CI system. Commands marked *offline* need no model, no
API key and no config beyond the optional `commitRules`.

- [Command cheat sheet](#command-cheat-sheet)
- [Exit codes](#exit-codes)
- [Pull-request checks](#pull-request-checks)
- [Releasing from CI](#releasing-from-ci)
- [Releasing from your machine](#releasing-from-your-machine)
- [Model settings in CI](#model-settings-in-ci)
- [How this repository does it](#how-this-repository-does-it)

## Command cheat sheet

| Command | Offline | What it does | Fails (exit ≠ 0) when |
|---|---|---|---|
| `commitsmith --lint-commits [--from <ref>]` | yes | Checks every commit message in `<ref>..HEAD` (default: default branch..HEAD) against your `commitRules`. | any message breaks the rules (`1`) |
| `commitsmith --lint-message <file>` | yes | Checks one message file (what the `commit-msg` hook runs). | the message breaks the rules (`1`) |
| `commitsmith --scan` | yes | Looks for likely secrets in staged (else unstaged) changes. | a likely secret is found (`1`) |
| `commitsmith --check --from <ref>` | no | Audits each commit's message against its diff (missed breaking-change flag, wrong type). Newest 50 commits. | an inconsistency is found |
| `commitsmith --breaking --from <ref>` | no | AI dry run: does the range break anything public? | breaking changes found (`1`), answer unparseable (`2`) |
| `commitsmith --review --from <ref> --fail-on high` | no | AI code review of the range. | a finding reaches the level (`1`), unparseable (`2`) |
| `commitsmith --bump --json` | yes | Prints the next version as JSON: `current`, `level`, `breaking`, `next`, `tag` (null = nothing releasable), `reasons`. | never |
| `commitsmith --bump --tag --push [--github]` | yes¹ | Creates the tag from the suggested version, pushes it (tag only, never forced), optionally creates the GitHub Release. | tag exists, push or release fails |
| `commitsmith --changelog --stdout` | yes | Prints the changelog (unreleased + every tag). Add `--unreleased --release-version <v>` for one section. | never |
| `commitsmith --release -y [--push] [--github]` | yes¹ | Bump, `CHANGELOG.md`, release commit, tag, push, GitHub Release. | uncommitted changes, push or release fails |
| `commitsmith --release-tags [--all] -y` | yes¹ | Creates GitHub Releases for tags that have none. | a release can't be created |

¹ Offline except for the `git push` and `gh` calls you ask for.

`--from` accepts any ref: a tag, a branch (`origin/main`) or a commit SHA. In a pull
request, use the base commit (`${{ github.event.pull_request.base.sha }}`).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Nothing wrong (also: nothing to do) |
| `1` | The check found a problem (rule violation, secret, breaking change, finding at `--fail-on`), or the action failed |
| `2` | `--breaking` / `--review`: part of the model's answer couldn't be parsed — treat as "inconclusive" |

Bad input (unknown ref, missing `gh`, no git repo) also exits `1` with a one-line message on
stderr.

## Pull-request checks

### The ready-made action

The repository ships a composite action (`action.yml` at the root) that lints every commit in
the pull request, with an optional AI breaking-change review:

```yaml
# .github/workflows/commits.yml
name: Commits
on: pull_request
jobs:
  commitsmith:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }          # full history is required
      - uses: masgeek/commitsmith@main    # pin a tag or SHA in real projects
        with:
          breaking: warn                  # off (default) | warn | fail — needs a provider
          provider: anthropic
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

| Input | Default | |
|---|---|---|
| `base` | the PR base commit | What the range starts from. |
| `lint-commits` | `true` | Run `--lint-commits`. |
| `breaking` | `off` | `warn` reports, `fail` fails the job. |
| `version` | `latest` | commitsmith version (npm version or dist-tag). |
| `node-version` | `22` | Node.js version. |
| `provider`, `model`, `api-key` | — | For the breaking-change review only. |

Rules come from `.commitsmithrc.json` in the repository:

```json
{ "commitRules": { "allowedTypes": ["feat", "fix", "docs", "chore"], "scopes": ["cli", "api"], "maxSubjectLength": 72 } }
```

### Without the action

The same checks as plain steps:

```yaml
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Commit messages
        run: npx --yes @masgeek/commitsmith --lint-commits --from ${{ github.event.pull_request.base.sha }}
      - name: Secrets in the diff
        run: npx --yes @masgeek/commitsmith --scan          # staged/unstaged only; use a pre-commit hook for the real gate
      - name: Breaking changes
        env:
          COMMITSMITH_PROVIDER: anthropic
          COMMITSMITH_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: npx --yes @masgeek/commitsmith --breaking --from ${{ github.event.pull_request.base.sha }}
```

When a commit fails the lint, fix it locally with `commitsmith --reword` (rewrites the
messages on your branch) or `--amend` (just the last one).

## Releasing from CI

Releases are driven by the commit messages. The rules are the same everywhere:

| Commits since the last tag | Release |
|---|---|
| a breaking change — `💥` header, `type!:`, or a `BREAKING CHANGE:` footer | **major** |
| `feat`, `accessibility`, `removal` | **minor** |
| `fix`, `perf`, `security`, `refactor`, `build` (and unrecognized commits in commitsmith) | **patch** |
| only `docs`, `test`, `ci`, `style`, `chore` | no release |

You have three ways to apply them; pick one per repository.

### 1. The tag action (what this repository uses)

[`masgeek/github-tag-action`](https://github.com/masgeek/github-tag-action) is a fork of the
popular tag action that understands gitmoji commits. No AI, no commitsmith install:

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: masgeek/github-tag-action@release
        id: tag
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}   # use a GitHub App token to trigger other workflows
          tag_prefix: ""                # "v" for v1.2.3 tags
          create_annotated_tag: true
          default_bump: "false"         # nothing releasable → no tag
          gitmoji: true                 # ✨ feat(x): …  and  💥 …  are understood
          extended_release_rules: true  # accessibility/removal → minor; security/refactor/build → patch
          fetch_all_tags: true
          create_release: true          # GitHub Release with the changelog as its body
```

Outputs: `new_tag`, `new_version`, `previous_tag`, `release_type`, `changelog`, `breaking`,
`released`. Add `dry_run: true` to see the result without tagging.

### 2. The release action (uses commitsmith itself)

`release/action.yml` runs commitsmith's own `--bump` and `--changelog`, pushes the tag and
creates the release:

```yaml
permissions:
  contents: write
steps:
  - uses: actions/checkout@v4
  - uses: masgeek/commitsmith/release@main    # pin a tag or SHA in real projects
    id: release
    with:
      dry-run: "false"
```

| Input | Default | |
|---|---|---|
| `token` | `github.token` | Pushes the tag and creates the release. Releases made with the default token don't trigger other workflows — pass a GitHub App or PAT token if they should. |
| `dry-run` | `false` | Only compute the version and notes. |
| `draft` | `false` | Create the release as a draft. |
| `title-prefix` | `Version ` | Release title = prefix + tag. |
| `version` / `cli` | `latest` / — | Which commitsmith to run (npm version, or a custom command such as `node commitsmith.mjs`). |
| `setup-node`, `node-version` | `true`, `22` | Install Node first. |

Outputs: `released`, `tag`, `level`, `breaking`, `notes-file`. The tag keeps the prefix of the
previous tag (`v` or none).

### 3. Plain commands in your own job

Needs `permissions: contents: write` on the job.

```yaml
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Decide the version
        id: bump
        run: |
          npx --yes @masgeek/commitsmith --bump --json | tee bump.json
          echo "tag=$(node -p "JSON.parse(require('fs').readFileSync('bump.json','utf8')).tag ?? ''")" >> "$GITHUB_OUTPUT"
      - name: Tag, push and publish
        if: steps.bump.outputs.tag != ''
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: npx --yes @masgeek/commitsmith --bump --tag --push --github
```

`--bump --json` never changes anything; `--bump --tag --push --github` creates the tag from
the same calculation, pushes only that tag, and creates the GitHub Release from its
changelog section. If the release step fails after the push, `commitsmith --release-tags -y`
creates it later.

### Publishing to npm afterwards

Trigger your publish workflow on `release: published`. Because releases made with the
default `GITHUB_TOKEN` don't start other workflows, create the release with a GitHub App or
PAT token.

## Releasing from your machine

| Goal | Command |
|---|---|
| See what the next version would be | `commitsmith --bump` |
| Tag it and push the tag | `commitsmith --bump --tag --push` |
| …and publish the GitHub Release | `commitsmith --bump --tag --push --github` |
| The whole thing: `package.json`, `CHANGELOG.md`, release commit, tag, push, release | `commitsmith --release -y --push --github` |
| Publish releases for tags that have none | `commitsmith --release-tags -y` (`--all` backfills every tag) |
| Preview any of the above | leave out `-y` (the release commands are previews until confirmed) |

Don't combine local releases with a CI workflow that also tags every merge — they will
collide on the same version.

## Model settings in CI

Only `--check`, `--breaking`, `--review` and the other message-generating commands call a
model. Configure it with environment variables (secrets belong in your CI's secret store):

| Variable | Meaning |
|---|---|
| `COMMITSMITH_PROVIDER` | `ollama-cloud`, `openai` or `anthropic` (a local `ollama` isn't available on hosted runners) |
| `COMMITSMITH_MODEL` | model name (provider default when unset) |
| `COMMITSMITH_API_KEY` | the provider's API key |
| `COMMITSMITH_SECRET_GUARD` | `redact` (default) or `block` — keeps likely secrets out of what is sent |

Large ranges cost one model call per commit (`--check` looks at the newest 50), so prefer
running them on pull requests, not on every push.

## How this repository does it

| Workflow | Trigger | Does |
|---|---|---|
| `ci-check.yml` | every push and PR | `pnpm test`, `--help` smoke test, `package.json` validation, `pnpm audit --production`, `pnpm pack` |
| `bump-version.yml` | CI succeeded on `main` | tags and releases with `masgeek/github-tag-action@release` (rules above, App token) |
| `publish-npm.yml` | release published | stages the npm publish; a maintainer approves it |
| `next-release.yml` | CI succeeded on `develop` | opens a "Release: …" PR into `main` |

See [Release process](../README.md#release-process) in the README for the full picture.
