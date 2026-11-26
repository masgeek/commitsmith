# AGENTS.md

## Purpose
commitsmith — a pnpm-based Node.js CLI (`node commitsmith.mjs`) that generates conventional-commit
messages for staged git changes, using a local (Ollama) or cloud (Ollama Cloud, OpenAI, Anthropic)
provider. Entry point `commitsmith.mjs` is a thin wrapper; all logic lives under `src/`
(`src/cli.mjs` dispatches, `src/modes/*` are the run modes).

## Key Commands
- `npm test` — syntax check (`scripts/check-syntax.mjs` runs `node --check` on `commitsmith.mjs` + every `src/**/*.mjs`) then unit tests (`node --test "test/**/*.test.mjs"`). `test:syntax` / `test:unit` split the halves.
- Run the tool: `node commitsmith.mjs` — default is one commit for everything staged; flags: `--split` (per-file), `--split-hunks` (per-`@@` hunk), `--group` (model clusters files), `--commit`/`-y` to commit, `--check`, `--dry-run` (split-hunks only — it's ignored elsewhere, per a warning in `cli.mjs`).
- `node commitsmith.mjs init` / `use` — interactive setup / quick provider switch; package.json aliases exist too: `commit`, `commit:go`, `commit:split`, `commit:hunks`, `commit:group`, `commit:check`.
- If nothing is staged, the CLI prompts to stage files (`modes/interactive-stage.mjs`) — on a bare `commitsmith` run it also asks which mode and commit behavior (ask/auto/preview) to use.
- `node commitsmith.mjs --release-notes [--from <ref>] [--branch <ref>] [--max-chars <n>] [--copy]` — print user-facing release notes (bullets on stdout, header/progress on stderr) for the changes since the last git tag reachable from the target (or `--from <ref>`), target = HEAD or `--branch <ref>`; read-only, for pasting into store consoles (Play Store, App Store). Package.json alias: `release-notes`.

## Modes
- Single (default) — one commit for all staged changes. Split — merges related files into one commit each, strict per-file otherwise (`--no-group-detection` forces strict).
- Split-Hunks — resets the index and applies each hunk with `git apply --cached` (via `execFileSync` arrays — never interpolate file paths into shell strings).
- Group — sends all staged diffs in one request; missing/duplicate files swept into a trailing `chore: update …` commit; falls back to Split on an unparseable response.
- Breaking (`--breaking [--from <ref> [--branch <ref>]]`) — read-only dry run: asks the model (`buildBreakingPrompt`) only whether the staged/unstaged/range diff has breaking changes, prints findings + a `BREAKING CHANGE:` footer; exit 1 = breaking, 2 = unparseable answer. `prepareBreakingInput()` validates before the provider check; big diffs are analyzed per file. `--check --from <ref>` scans every commit in a range for unflagged breaking changes.
- Pull request (`--pr [--base <branch>] [--create|-y] [--draft]`) — `preparePullRequest()` (git only, runs before the provider check) → `runPullRequestMode()` in `src/modes/pull-request.mjs`: PR title/body from `getReleaseCommits` + `getBranchDiff` via `buildPullRequestPrompt`; breaking notes come from commit footers (`collectBreakingNotes`). Preview unless `--create`/`-y`; creating shells out to `gh` via `src/github.mjs` (body on stdin, array args), pushes with `pushBranch` (never forces). `preparePullRequest()` also calls `findOpenPr()` (the one network call in prepare; null if `gh` is missing): an open PR is updated with `gh pr edit` (`updatePullRequest`) instead of duplicated. `gh` calls are not unit-tested; `buildPrCreateArgs`/`buildPrEditArgs`/`parseOpenPr` and the parsers are.
- Release Notes — prints user-facing bullets since the last tag (or `--from <ref>`), compared against HEAD or `--branch <ref>`; `prepareReleaseNotes()` validates refs *before* the provider check (see `cli.mjs`); input = commit list (`getReleaseCommits`) + filtered three-dot diff (`getReleaseNotesDiff`); base via `getBaseTag()` in `src/git.mjs`; prompt `buildReleaseNotesPrompt({commitsText, diff, context, maxChars})`; `COMMITSMITH_RELEASE_NOTES_CONTEXT` / `releaseNotesContext` config key.

## Configuration
Precedence: **env var > config file > OS keychain (API key only) > built-in default**.
- `loadConfig()` in `src/config.mjs` is async + memoized — nothing reads the config file or keychain until the first call, so importing `config.mjs` has no side effects.
- Config file keys are camelCase: `provider`, `apiKey`, `model`, `host`, `maxDiff` (6000), `timeoutMs` (60000), `groupMaxDiffPerFile` (1200), `fallbackModels`, `breakingDetection`.
- Env vars: `COMMITSMITH_PROVIDER`, `COMMITSMITH_MODEL`, `COMMITSMITH_HOST`, `COMMITSMITH_API_KEY`, `COMMITSMITH_MAX_DIFF`, `COMMITSMITH_TIMEOUT_MS`, `COMMITSMITH_GROUP_MAX_DIFF_PER_FILE`, `COMMITSMITH_FALLBACK_MODELS`.
- Per-provider model/host defaults (`DEFAULT_MODELS` / `DEFAULT_HOSTS`) live in `src/config.mjs`.

## Release & CI (as the workflows are today)
- Push anywhere → `.github/workflows/ci-check.yml` ("CI", Node 22 & 24): `pnpm install --frozen-lockfile`, `pnpm test`, a `node commitsmith.mjs --help` smoke test, `package.json` validation, `pnpm audit --production`, `pnpm pack`. All must pass.
- After CI succeeds on `main` → `bump-version.yml`: generates the semver tag + GitHub Release (only when `src/` or `package.json` changed).
- On a release being published → `publish-npm.yml`: pins `package.json` version to the tag, runs `pnpm test` + `--help` smoke, then `npm stage publish --provenance --access public`; a human must run `npm stage approve` (or npmjs.com with 2FA) before it goes live — the Trusted Publisher is configured stage-only on purpose. First-ever npm publish is manual.
- `next-release.yml`: when CI succeeds on the `develop` branch, it opens a PR titled "Release: <first line of commit message>" targeting `main`.

## Gotchas Agents Might Miss
- Generated commit messages get a second breaking-change pass: `addBreakingFooterIfNeeded()` in `src/generate.mjs` (also called per group in `src/modes/group.mjs`) runs `buildBreakingPrompt` on messages not already marked 💥 and adds the `BREAKING CHANGE:` footer via `retypeMessage`. It adds one model call per message, is skipped when `breakingDetectionEnabled` is false, and is not unit-tested (needs a model); the pure parts (`parseBreakingResult`, `retypeMessage`, `breakingReason`) are.
- Interactivity is gated by `isInteractive()` in `src/tty.mjs` (TTY on stdin+stdout, `CI` unset, no `--no-interactive`). Never call clack from a path that can run non-interactively; `confirmWithEdit` (`src/ui.mjs`) declines instead of prompting. Remembered choices live in `src/prefs.mjs` (`state.json`, separate from config). Pure helpers (`moveFile`/`mergeGroups`, `planHunkBatches`, `retypeMessage`, `computeInteractive`) are covered by `test/interactive.test.mjs`; the clack flows themselves are not.
- `test/git.test.mjs` covers `parseFileDiffIntoHunks` / `extractPathFromFileDiff`; `test/parsing.test.mjs` covers `parseModelJson` / `formatCommitMessage` / `fallbackFromRawText` / `parseGroupingResult`. Green `npm test` = parsing and hunk logic didn't regress, not "the CLI works end to end."
- `src/cli-args.mjs` mode/commit flags (`shouldCommit`, `autoYes`, `splitMode`, `splitHunksMode`, `groupMode`, `dryRun`) are mutable live ESM bindings — `setRunOptions()` changes them after the fact in interactive mode.
- `--no-breaking-detection` disables the 💥 breaking-change classification (default on); config-file key `breakingDetection: false` does the same.
- All git shell-out goes through `execFileSync` with argument arrays (`src/git.mjs`, `src/modes/split-hunks.mjs`).
- Model must return **pure JSON**; `formatCommitMessage` falls back to the first line (`fallbackFromRawText`) if not.
- `npm pack --dry-run` locally is a cheap check for the `files` list and `bin` entry before any release.
