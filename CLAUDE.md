# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`oco-lite` is a single-file, zero-dependency Node.js CLI (`oco-lite.mjs`) that generates git
commit messages by talking directly to a local [Ollama](https://ollama.com) instance's
`/api/generate` endpoint. There is no build step, no bundler, no test framework, and no other
source files — `oco-lite.mjs` is the entire implementation.

Deliberately plain JavaScript, not TypeScript — adding TS would require a build step and
shipping compiled output for a single-file CLI. If model-response parsing ever needs stronger
typing, JSDoc + `tsc --checkJS` is the planned next step, not a TS rewrite.

## Commands

```bash
# Syntax-check the script (this is the entire "test suite" — there is no test framework)
node --check oco-lite.mjs

# Validate package.json parses
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"

# Dry-run the npm package (catches a broken `files` list or `bin` path)
npm pack --dry-run

# Run locally against a repo with staged changes
node oco-lite.mjs [--split|--split-hunks|--group] [--commit|-y] [--no-breaking-detection]
```

These three commands are exactly what `.github/workflows/ci.yml` runs on every push/PR to
`main`. There are no unit tests — manual verification means staging changes in a scratch repo
and running the script against a live local Ollama instance.

### Release process

Versions are unprefixed (`1.0.0`, not `v1.0.0` — see `.npmrc`'s `tag-version-prefix=""`).

```bash
npm version patch   # or minor/major — bumps package.json, commits, tags
git push --follow-tags
```

Pushing the tag triggers `.github/workflows/publish.yml`, which publishes to npm via Trusted
Publishing (OIDC) — no long-lived `NPM_TOKEN`.

## Architecture

Everything lives in `oco-lite.mjs`, organized as a pipeline: **gather staged diff → build a
prompt → call Ollama → parse structured JSON → format a commit message → (optionally) commit.**

- **Diff gathering**: `getStagedDiff`/`getStagedFiles`/`getFileDiffs` shell out to `git` via
  `node:child_process`. `truncateDiff` caps what's sent to the model per `OCOLITE_MAX_DIFF` /
  `OCOLITE_GROUP_MAX_DIFF_PER_FILE`.
- **Prompting**: `buildPrompt` (single file/changeset) and `buildGroupingPrompt` (`--group` mode)
  both instruct the model to return *only* a JSON object (`format: 'json'` is also passed to
  Ollama) — this is the deliberate design choice that avoids prose-scraping, which is the main
  bug class this tool was built to avoid (see README "Why not OpenCommit?").
- **Parsing/formatting**: `parseModelJson` extracts the first `{...}` block; `formatCommitMessage`
  turns the parsed JSON into the final `<gitmoji> <type>(<scope>): <subject>` + bullet-point
  message, handling breaking-change annotation (💥 overrides the type's gitmoji, and the specific
  bullet gets `[BREAKING CHANGE: ...]` appended). `fallbackFromRawText` handles the case where the
  model doesn't return valid JSON at all.
- **Four run modes**, each its own function, dispatched from `main()`:
  - `runSingleMode` — one message for all staged changes.
  - `runSplitMode` — one message/commit per staged file (loops `generateMessageFor` per file).
  - `runSplitHunksMode` — the most involved mode: `git reset`s everything, splits each file's
    diff into `@@` hunks (`parseFileDiffIntoHunks`), then re-stages and commits one hunk at a
    time via `git apply --cached` (the same mechanism `git add -p` uses). Falls back to
    committing a file whole if a hunk fails to apply cleanly.
  - `runGroupMode` — sends *all* staged files' diffs in one request, asks the model to cluster
    them into logical groups (`parseGroupingResult`). Guarantees every staged file ends up in
    exactly one commit: files the model misses/duplicates get swept into a trailing
    `chore: update remaining files` group, and a totally unparseable grouping response falls back
    to `runSplitMode`. A single staged file falls back to `runSingleMode`.
- Commits are made with `execFileSync('git', ['commit', '-m', message, ...])` — using
  `execFileSync` (not `execSync`) with an args array for commit messages specifically, so
  multi-line messages with special characters don't go through shell interpolation.

All configuration is via environment variables (`OCOLITE_MODEL`, `OCOLITE_HOST`,
`OCOLITE_MAX_DIFF`, `OCOLITE_TIMEOUT_MS`, `OCOLITE_GROUP_MAX_DIFF_PER_FILE`) — there is no config
file, by design.

When changing prompt-building or parsing logic, keep in mind the model is expected to return
*only* JSON (no markdown fences, no commentary) — both prompts explicitly instruct this, and
`parseModelJson`/`parseGroupingResult` assume it.
