# oco-lite

Minimal git commit message generator powered by a local [Ollama](https://ollama.com)
model, Ollama Cloud, OpenAI, Anthropic, or any OpenAI-compatible endpoint.

`oco-lite` talks to its model provider directly with a strict, structured
prompt — full control over the output format, no third-party prompt
templates or config-loading machinery in the way.

---

## Features

- Gitmoji-prefixed [Conventional Commits](https://www.conventionalcommits.org/)-style
  messages with a bulleted summary of concrete changes (see [Commit message
  format](#commit-message-format))
- Structured JSON model output (reliable to parse — no prose-scraping)
- **Breaking change detection** — flips the leading gitmoji to 💥 and
  annotates the relevant bullet inline
- Four granularities:
    - one message for all staged changes
    - `--split` — auto-detects edits spread across multiple files that belong
      to the same logical change and merges them into one commit; everything
      else still gets one commit per file (pass `--no-group-detection` for the
      old strict one-commit-per-file behavior)
    - one commit **per logical diff hunk** (`--split-hunks`)
    - `--group` — the same relatedness detection as `--split`, without the
      single-file fallback
- **Multiple providers** — local Ollama (default), Ollama Cloud, OpenAI, Anthropic,
  or any OpenAI-compatible endpoint (Groq, Together, OpenRouter, a self-hosted
  vLLM/LM Studio server, etc.) — see [Providers](#providers)
- `--check` — re-classifies the last commit's diff and warns if the message
  someone wrote by hand looks inconsistent (wrong type, missed breaking-change
  flag); exits non-zero, so it doubles as a CI/hook gate
- Streaming generation with live progress, and automatic fallback across
  `OCOLITE_FALLBACK_MODELS` if the primary model fails or times out
- Pre-flight checks (git repo detection, provider reachability)
- Request timeout handling — no hangs on a stuck call

---

## Requirements

- Node.js **18+** (uses native `fetch`)
- Git
- One of:
    - [Ollama](https://ollama.com) running locally with a pulled model (default provider):
      ```bash
      ollama pull qwen2.5-coder:7b
      ```
    - An [Ollama Cloud](https://ollama.com), [OpenAI](https://platform.openai.com), or
      [Anthropic](https://console.anthropic.com) API key — see [Providers](#providers)

---

## Providers

Set via `OCOLITE_PROVIDER` (env var or `provider` in a config file — see
[Configuration](#configuration)). Default: `ollama`.

| Provider | `OCOLITE_PROVIDER` | API key required | Default host |
|---|---|---|---|
| Local Ollama | `ollama` | no | `http://localhost:11434` |
| Ollama Cloud | `ollama-cloud` | yes (`OCOLITE_API_KEY`) | `https://ollama.com` |
| OpenAI (or any OpenAI-compatible endpoint) | `openai` | yes | `https://api.openai.com/v1` |
| Anthropic | `anthropic` | yes | `https://api.anthropic.com` |

```bash
# Local Ollama (default) — nothing to set
oco-lite

# Ollama Cloud — https://ollama.com/settings/keys
OCOLITE_PROVIDER=ollama-cloud OCOLITE_API_KEY=... OCOLITE_MODEL=qwen3-coder:480b-cloud oco-lite

# OpenAI
OCOLITE_PROVIDER=openai OCOLITE_API_KEY=sk-... OCOLITE_MODEL=gpt-4o-mini oco-lite

# Anthropic
OCOLITE_PROVIDER=anthropic OCOLITE_API_KEY=sk-ant-... OCOLITE_MODEL=claude-haiku-5-5 oco-lite

# Any OpenAI-compatible endpoint (Groq, Together, OpenRouter, a self-hosted
# vLLM/LM Studio server, etc.) — just point OCOLITE_PROVIDER=openai at it:
OCOLITE_PROVIDER=openai OCOLITE_HOST=https://api.groq.com/openai/v1 OCOLITE_API_KEY=... OCOLITE_MODEL=llama-3.3-70b-versatile oco-lite
```

`--split`/`--group` relatedness detection and `--check` use the same provider
and model as everything else — no separate configuration needed.

---

## Installation

### Option A — Install from npm (recommended)

```bash
npm install -g @masgeek/oco-lite
# or
pnpm add -g @masgeek/oco-lite
```

Verify:

```bash
oco-lite --help
```

### Option B — Local clone, installed globally via pnpm

```powershell
cd D:\Dev\js\oco-lite
pnpm add -g file:.
```

> `pnpm add -g .` (bare dot) fails on some pnpm/Windows setups with
> `ERR_PNPM_PACKAGE_MANAGER_ADD_RESOLVE_LATEST` (pnpm treats `.` as a
> registry package name instead of a local path). Use the explicit `file:`
> prefix as shown above. If that still fails, pack and install the
> tarball instead:
> ```powershell
> pnpm pack
> pnpm add -g ./oco-lite-1.0.0.tgz
> ```

This is a real install (not a live symlink) — after editing
`oco-lite.mjs`, re-run `pnpm add -g file:.` to pick up changes.

To remove either install method:

```bash
npm uninstall -g @masgeek/oco-lite
# or
pnpm remove -g oco-lite
```

### Option C — Install directly from GitHub (no npm publish needed)

Useful for trying an unpublished change, or if you don't want to wait for
a version bump on npm:

```bash
npm install -g github:masgeek/oco-lite
# or a specific branch/tag/commit:
npm install -g github:masgeek/oco-lite#main
npm install -g github:masgeek/oco-lite#1.2.0

# pnpm equivalent:
pnpm add -g github:masgeek/oco-lite
```

This clones and installs straight from the repo — no `.tgz`, no local
path juggling. Works the same as the npm-registry install once done;
`oco-lite` lands on your PATH either way.

### Option D — Git alias (no packaging)

```powershell
git config --global alias.aicommit '!node D:/Dev/js/oco-lite/oco-lite.mjs --commit'
git config --global alias.aicommit-split '!node D:/Dev/js/oco-lite/oco-lite.mjs --split --commit'
git config --global alias.aicommit-hunks '!node D:/Dev/js/oco-lite/oco-lite.mjs --split-hunks --commit'
git config --global alias.aicommit-group '!node D:/Dev/js/oco-lite/oco-lite.mjs --group --commit'
```

Then from any repo: `git aicommit`, `git aicommit-split`, `git aicommit-hunks`, `git aicommit-group`.

### Option E — Per-project npm script

Add to `package.json`:

```json
{
  "scripts": {
    "commit": "oco-lite",
    "commit:go": "oco-lite --commit",
    "commit:split": "oco-lite --split --commit",
    "commit:hunks": "oco-lite --split-hunks --commit",
    "commit:group": "oco-lite --group --commit",
    "commit:check": "oco-lite --check"
  }
}
```

(assumes the npm package is installed; use `node oco-lite.mjs` instead if running from a local clone)

This repo's own `package.json` ships these same scripts (`npm run commit`,
`commit:go`, `commit:split`, `commit:hunks`, `commit:group`, `commit:check`) for
working on `oco-lite` itself, plus `npm test`, which syntax-checks `oco-lite.mjs`
and every module under `src/` (see [Project structure](#project-structure)).

---

## Commit message format

```
<gitmoji> <type>(<scope>): <subject>

* <change 1>
* <change 2> [BREAKING CHANGE: only present if applicable]
```

Example:

```
♻️ refactor(RbacSeeder): extract permission logic into helper methods

* extracted permission seeding into seedPermissions()
* extracted ID resolution into resolvePermissionId()
* added return type hints
```

### Gitmoji mapping

| Gitmoji | Type | Meaning |
|---|---|---|
| ✨ | `feat` | new features |
| 🐛 | `fix` | bug fixes |
| 📝 | `docs` | documentation |
| 🎨 | `style` | formatting |
| ♻️ | `refactor` | code refactoring |
| ⚡ | `perf` | performance |
| ✅ | `test` | tests |
| 🛠️ | `build` | build system |
| 👷 | `ci` | CI/CD |
| 🔧 | `chore` | maintenance |
| 🔒 | `security` | security updates |
| ♿ | `accessibility` | accessibility improvements |
| 🗑️ | `removal` | feature or code removal |
| 💥 | *(overrides the type's emoji)* | commit flagged as a breaking change |

When a commit is flagged breaking, 💥 replaces the type's normal gitmoji as
the leading emoji, and the specific bullet responsible is annotated inline
with `[BREAKING CHANGE: <reason>]`. This applies in every generation mode —
default, `--split`, `--split-hunks`, and `--group`. `--check` reuses the same
classification to audit an existing commit message instead of generating one.

---

## Usage

```bash
oco-lite init                    # interactive setup — choose a provider/model, write a config file

git add <files>

oco-lite                        # print a message for all staged changes (no commit)
oco-lite --commit                # generate, confirm, then commit
oco-lite -y                      # generate and commit, no confirmation

oco-lite --split                 # auto-detect related files, merge them; one message per file otherwise
oco-lite --split --commit        # same, confirm and commit each resulting commit
oco-lite --split -y              # same, no confirmation prompts
oco-lite --split --no-group-detection -y  # strict one commit per staged file, no relatedness detection

oco-lite --split-hunks --commit  # one commit per logical diff hunk
oco-lite --split-hunks -y        # same, no confirmation prompts

oco-lite --group --commit        # cluster related staged files, one commit per group (no per-file fallback)
oco-lite --group -y              # same, no confirmation prompts

oco-lite --split-hunks --dry-run # preview hunks + messages, no staging or commits
oco-lite --check                 # re-classify HEAD's diff, warn if its message looks inconsistent
oco-lite --no-breaking-detection # skip breaking-change classification
oco-lite --help                  # usage summary
```

At any confirmation prompt (`[y/N/e]`), answer `e` to open the generated message
in `$GIT_EDITOR`/`$EDITOR` (falls back to `notepad`/`vi`) before committing.

### Which mode should I use?

| Mode | Granularity | Use when |
|---|---|---|
| default | one commit for everything staged | quick, single logical change across files |
| `--split` | merges related files into one commit each, one commit per file for everything else | several files staged together, some of which belong to the same feature/fix and some don't (e.g. a migration + model + seeder for one feature, plus an unrelated typo fix elsewhere) — the common case |
| `--split --no-group-detection` | strict one commit per file | you specifically want no relatedness detection, e.g. for a quick skim-and-commit workflow |
| `--split-hunks` | one commit per diff hunk | one file with several distinct, unrelated edits (e.g. multiple refactors in one seeder/class) |
| `--group` | one commit per detected group of related files, no per-file fallback for a single staged file | same relatedness detection as `--split`, when you want to be explicit about expecting groups |
| `--check` | read-only — classifies HEAD's existing diff | verifying (by hand, in CI, or in a hook) that someone's handwritten commit message didn't miss a breaking-change flag or use the wrong type |

---

## `--split` / `--group` relatedness detection — how it works and its limits

1. Sends **all** staged files' diffs to the model in a single request, each
   truncated to `OCOLITE_GROUP_MAX_DIFF_PER_FILE` characters
2. The model returns a JSON list of groups, each with its own file list,
   type, scope, subject, bullet-point changes, and breaking-change flag —
   files are clustered together only when they implement the same logical
   change. Each group's breaking-change flag is assessed independently, so a
   breaking rename split across two files is still flagged 💥 even though
   the change touches multiple files.
3. Every staged file is guaranteed to end up in exactly one commit:
    - if the model misses or duplicates a file, leftover files are swept
      into a trailing `🔧 chore: update remaining files` group rather than
      silently dropped
    - if the model's response doesn't parse into a valid grouping at all,
      `--split` automatically falls back to a strict one-commit-per-file
      split, and `--group` does the same
4. For `--split`, if only one file is staged there's nothing to detect
   relatedness among, so it skips straight to a one-commit-per-file split
   (trivially, a single commit). `--group` falls back to the default
   single-commit mode instead in that case.
5. Pass `--no-group-detection` to `--split` to skip this step entirely and
   always get the strict one-commit-per-file behavior from before this
   feature existed.

**Caveats:**

- Sends every staged file's diff in one request, so it's more sensitive to
  `OCOLITE_TIMEOUT_MS` and model context length on large changesets than
  the other modes. Lower `OCOLITE_GROUP_MAX_DIFF_PER_FILE` if you're
  staging many files at once.
- Grouping quality depends on the model actually recognizing the
  relationship between files (e.g. a migration and the model it backs) —
  weaker models may under- or over-group. Review the printed groups before
  confirming each commit.

---

## `--split-hunks` — how it works and its limits

1. Unstages everything (`git reset`)
2. Parses each file's staged diff into individual `@@` hunks
3. Re-stages one hunk at a time via `git apply --cached` — the same
   underlying mechanism `git add -p` uses
4. Generates a message scoped to just that hunk and commits it before
   moving to the next

**Caveats:**

- New, deleted, and binary files can't be meaningfully split — they're
  committed whole, as a single commit, automatically.
- If a hunk's patch fails to apply cleanly during the sequential process
  (rare — usually adjacent/overlapping context conflicts), that file falls
  back to committing all its remaining changes as one commit. A warning is
  printed; nothing is lost.
- If the script is interrupted mid-run, you may end up with some hunks
  committed and the rest left **unstaged** in your working tree. Just
  `git add` and re-run.

Test on a low-stakes branch or file before trusting it on real work, or use
`--dry-run` (below) to preview without touching the index at all.

### `--dry-run`

`oco-lite --split-hunks --dry-run` previews the detected hunks and their
generated messages without running `git reset`, `git apply --cached`, or any
commit — your staged changes are left exactly as they were. Only supported
with `--split-hunks` (the only mode that mutates the index as part of
generating messages); passing it with other modes prints a warning and is
otherwise ignored.

---

## `--check`

`oco-lite --check` re-sends HEAD's existing diff to the model and compares
its classification against the commit message that was actually written —
useful for catching commits made by hand (bypassing `oco-lite`) that forgot a
💥/`BREAKING CHANGE` flag or used a mismatched type. Read-only: it never
touches the index or rewrites history, and it exits non-zero when it finds an
issue, so it works as a CI check or a post-commit/pre-push hook gate.

---

## Configuration

Environment variables take precedence over a config file, which takes
precedence over built-in defaults.

### `oco-lite init`

The fastest way to set up a project: an interactive wizard that asks for a
provider, model, host, breaking-change preference, and optional fallback
models, then writes a project-local `.oco-literc.json`. It never writes an
API key to disk — if the chosen provider needs one, it prints the right
`export`/`$env:` command for your shell instead.

```bash
oco-lite init
```

Safe to run before Ollama is reachable, outside a git repo, and right after
installing. Re-run it any time to overwrite the config (it asks first).

| Variable | Default | Description |
|---|---|---|
| `OCOLITE_PROVIDER` | `ollama` | `ollama` \| `ollama-cloud` \| `openai` \| `anthropic` — see [Providers](#providers) |
| `OCOLITE_API_KEY` | *(none)* | required for every provider except local `ollama` |
| `OCOLITE_MODEL` | provider-dependent | model to use (see [Providers](#providers) for each provider's default) |
| `OCOLITE_HOST` | provider's standard API base URL | override to point `openai` at a compatible endpoint, or any provider at a proxy |
| `OCOLITE_MAX_DIFF` | `6000` | Max characters of diff sent per request (larger diffs are truncated) |
| `OCOLITE_TIMEOUT_MS` | `60000` | Per-request inactivity timeout, in milliseconds (resets on every streamed chunk) |
| `OCOLITE_GROUP_MAX_DIFF_PER_FILE` | `1200` | Max characters of *each file's* diff sent during `--split`/`--group` relatedness detection (all staged files are sent together in one request) |
| `OCOLITE_FALLBACK_MODELS` | *(none)* | comma-separated models to try, in order, on the same provider, if the primary model fails or times out |

### Config file

Looked up via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) under
the name `oco-lite` — any of `.oco-literc`, `.oco-literc.json`, `.oco-literc.yaml`,
`.oco-literc.js`, `oco-lite.config.js`, or an `"oco-lite"` key in `package.json`,
searched upward from the current directory. Lets a team commit shared
non-secret defaults instead of everyone setting env vars locally.

```json
{
  "oco-lite": {
    "provider": "ollama",
    "model": "qwen2.5-coder:7b",
    "maxDiff": 6000,
    "timeoutMs": 60000,
    "groupMaxDiffPerFile": 1200,
    "fallbackModels": ["qwen2.5-coder:1.5b"],
    "breakingDetection": true
  }
}
```

Keys mirror the env vars above (camelCase, without the `OCOLITE_` prefix).
**Don't commit an `apiKey` in a config file** — set `OCOLITE_API_KEY` in your
shell or CI secrets instead; the config file is meant for team-shared,
non-secret settings only.

Set env vars persistently on Windows (per-user):

```powershell
[System.Environment]::SetEnvironmentVariable('OCOLITE_MODEL', 'qwen2.5-coder:7b', 'User')
```

(requires a fresh terminal to take effect)

---

## Why not OpenCommit?

[OpenCommit](https://github.com/di-sukharev/opencommit) is a fine, more
full-featured tool. `oco-lite` is a smaller, more opinionated alternative for
anyone who wants:

- **Structured JSON output from the model**, not prose-scraping — the
  commit type, scope, subject, bullet points, and breaking-change flag all
  come back as explicit fields, parsed directly, rather than extracted from
  free text with regexes/templates.
- **A provider-agnostic core from the start** — the same prompt and parsing
  pipeline runs identically against local Ollama, Ollama Cloud, OpenAI, or
  Anthropic; switching is one env var, not a different prompt module.
- **Commit-granularity control** OpenCommit doesn't offer — splitting by
  file, by diff hunk, or by detected logical grouping across files (see
  [Which mode should I use?](#which-mode-should-i-use)).
- **A `--check` mode** to audit commits made by hand against the same
  breaking-change/type classification, usable as a CI or hook gate.
- **No prompt-module or config-loading machinery** to configure — `oco-lite`
  owns the full prompt → response → format pipeline directly.

---

## Why not TypeScript?

Deliberately plain JavaScript. Adding TypeScript would mean a build step
(`tsc`) and shipping compiled output instead of the source files directly —
more moving parts than it's worth. If the model-response parsing ever needs
stronger type-checking, JSDoc annotations (checkable via `tsc --checkJS`, no
build step) are the planned next step rather than a full TS rewrite.

---

## Project structure

```
oco-lite.mjs              executable entry point — just wires up src/cli.mjs
src/
  cli.mjs                 top-level dispatch (which mode to run)
  cli-args.mjs             parses process.argv into flags
  config.mjs               env vars + config file → resolved settings (provider, model, host, ...)
  constants.mjs            gitmoji map, allowed commit types
  die.mjs                  fail-fast helper
  git.mjs                  all git plumbing (diff, staged files, hunks, commit, last-commit lookup)
  prompts.mjs               the two model prompts (single-diff, grouping)
  parsing.mjs               model JSON → formatted commit message
  generate.mjs              diff text → generated message (ties prompts/parsing/providers together)
  ui.mjs                    printHelp, the edit-in-$EDITOR confirmation prompt
  providers/
    stream.mjs               shared SSE/NDJSON streaming + timeout handling
    ollama.mjs, openai.mjs, anthropic.mjs   one per provider's wire format
    index.mjs                 provider dispatch + model-fallback retry loop
  modes/
    single.mjs, split.mjs, group.mjs, split-hunks.mjs, check.mjs, init.mjs   one per CLI mode
```

No build step — Node runs the `.mjs` files directly, both from a local clone
and from the published npm package (`src/` is included in `files`).

---

## Release process

Versions are unprefixed (`1.0.0`, not `v1.0.0`) — see `.npmrc`
(`tag-version-prefix=""`).

```bash
npm version patch   # or minor/major — bumps package.json, commits, tags
git push --follow-tags
```

Pushing the tag triggers `.github/workflows/publish.yml`, which publishes
to npm automatically via **Trusted Publishing (OIDC)** — no long-lived
`NPM_TOKEN` secret involved. `.github/workflows/ci.yml` runs on every push
and PR: installs dependencies, syntax-checks every module (`npm test`), runs
a `--help` smoke test (exercises the full import graph), validates
`package.json`, and does a dry run of `npm pack`.

> First-ever publish only: npm's Trusted Publisher config must point at an
> *existing* package, so the very first release has to be published
> manually with a token before Trusted Publishing can be configured on
> npmjs.com for this package.

---

## Troubleshooting

**"Cannot reach Ollama at http://localhost:11434"**
Ollama isn't running. Start it with `ollama serve`, or set `OCOLITE_HOST`
if it's running elsewhere, or `OCOLITE_PROVIDER=openai`/`anthropic`/`ollama-cloud`
to use a cloud provider instead.

**"OCOLITE_API_KEY ... is required for provider ..."**
Set `OCOLITE_API_KEY` for any provider other than local `ollama` (OpenAI,
Anthropic, and Ollama Cloud all require one).

**Message still splits into multiple commits for one file**
Use `--split-hunks` instead of the default mode — it separates by logical
diff hunk rather than relying on the model to compress everything into one
message.

**Request timed out**
Increase `OCOLITE_TIMEOUT_MS`, reduce `OCOLITE_MAX_DIFF`, switch to a
smaller/faster model via `OCOLITE_MODEL`, or set `OCOLITE_FALLBACK_MODELS`
to retry with a backup model automatically.

**`git commit failed`**
Usually a pre-commit hook or lint-staged failure unrelated to `oco-lite` —
check the git output printed above the error; it's passed through via
`stdio: 'inherit'`.

---

## License

MIT — see [`LICENSE`](./LICENSE).