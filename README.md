# commitsmith

Minimal git commit message generator powered by a local [Ollama](https://ollama.com)
model, Ollama Cloud, OpenAI, Anthropic, or any OpenAI-compatible endpoint.

`commitsmith` talks to its model provider directly with a strict, structured
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
- `--release-notes` — prints user-facing release-note bullets for the changes
  since the last git tag (or `--from <ref>`), compared against HEAD or a
  specified `--branch <ref>` — for pasting into store listings (Play Store,
  App Store, etc.); see [Release notes](#release-notes)
- Streaming generation with live progress, and automatic fallback across
  `COMMITSMITH_FALLBACK_MODELS` if the primary model fails or times out
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

Set via `COMMITSMITH_PROVIDER` (env var or `provider` in a config file — see
[Configuration](#configuration)). Default: `ollama`.

| Provider | `COMMITSMITH_PROVIDER` | API key required | Default host |
|---|---|---|---|
| Local Ollama | `ollama` | no | `http://localhost:11434` |
| Ollama Cloud | `ollama-cloud` | yes (`COMMITSMITH_API_KEY`) | `https://ollama.com` |
| OpenAI (or any OpenAI-compatible endpoint) | `openai` | yes | `https://api.openai.com/v1` |
| Anthropic | `anthropic` | yes | `https://api.anthropic.com` |

```bash
# Local Ollama (default) — nothing to set
commitsmith

# Ollama Cloud — https://ollama.com/settings/keys
COMMITSMITH_PROVIDER=ollama-cloud COMMITSMITH_API_KEY=... COMMITSMITH_MODEL=qwen3-coder:480b-cloud commitsmith

# OpenAI
COMMITSMITH_PROVIDER=openai COMMITSMITH_API_KEY=sk-... COMMITSMITH_MODEL=gpt-4o-mini commitsmith

# Anthropic
COMMITSMITH_PROVIDER=anthropic COMMITSMITH_API_KEY=sk-ant-... COMMITSMITH_MODEL=claude-haiku-5-5 commitsmith

# Any OpenAI-compatible endpoint (Groq, Together, OpenRouter, a self-hosted
# vLLM/LM Studio server, etc.) — just point COMMITSMITH_PROVIDER=openai at it:
COMMITSMITH_PROVIDER=openai COMMITSMITH_HOST=https://api.groq.com/openai/v1 COMMITSMITH_API_KEY=... COMMITSMITH_MODEL=llama-3.3-70b-versatile commitsmith
```

`--split`/`--group` relatedness detection, `--check`, and `--release-notes` use
the same provider and model as everything else — no separate configuration needed.

---

## Installation

### Option A — Install from npm (recommended)

```bash
npm install -g @masgeek/commitsmith
# or
pnpm add -g @masgeek/commitsmith
```

Verify:

```bash
commitsmith --help
```

The same binary is also installed as `csmith` and `csm`, so any example in this
README works with the shorter names (e.g. `csm --split -y`).

### Option B — Local clone, installed globally via pnpm

```powershell
cd D:\Dev\js\commitsmith
pnpm add -g file:.
```

> `pnpm add -g .` (bare dot) fails on some pnpm/Windows setups with
> `ERR_PNPM_PACKAGE_MANAGER_ADD_RESOLVE_LATEST` (pnpm treats `.` as a
> registry package name instead of a local path). Use the explicit `file:`
> prefix as shown above. If that still fails, pack and install the
> tarball instead:
> ```powershell
> pnpm pack
> pnpm add -g ./commitsmith-1.0.0.tgz
> ```

This is a real install (not a live symlink) — after editing
`commitsmith.mjs`, re-run `pnpm add -g file:.` to pick up changes.

To remove either install method:

```bash
npm uninstall -g @masgeek/commitsmith
# or
pnpm remove -g commitsmith
```

### Option C — Install directly from GitHub (no npm publish needed)

Useful for trying an unpublished change, or if you don't want to wait for
a version bump on npm:

```bash
npm install -g github:masgeek/commitsmith
# or a specific branch/tag/commit:
npm install -g github:masgeek/commitsmith#main
npm install -g github:masgeek/commitsmith#1.2.0

# pnpm equivalent:
pnpm add -g github:masgeek/commitsmith
```

This clones and installs straight from the repo — no `.tgz`, no local
path juggling. Works the same as the npm-registry install once done;
`commitsmith` lands on your PATH either way.

### Option D — Git alias (no packaging)

```powershell
git config --global alias.aicommit '!node D:/Dev/js/commitsmith/commitsmith.mjs --commit'
git config --global alias.aicommit-split '!node D:/Dev/js/commitsmith/commitsmith.mjs --split --commit'
git config --global alias.aicommit-hunks '!node D:/Dev/js/commitsmith/commitsmith.mjs --split-hunks --commit'
git config --global alias.aicommit-group '!node D:/Dev/js/commitsmith/commitsmith.mjs --group --commit'
```

Then from any repo: `git aicommit`, `git aicommit-split`, `git aicommit-hunks`, `git aicommit-group`.

### Option E — Per-project npm script

Add to `package.json`:

```json
{
  "scripts": {
    "commit": "commitsmith",
    "commit:go": "commitsmith --commit",
    "commit:split": "commitsmith --split --commit",
    "commit:hunks": "commitsmith --split-hunks --commit",
    "commit:group": "commitsmith --group --commit",
    "commit:check": "commitsmith --check",
    "release-notes": "commitsmith --release-notes"
  }
}
```

(assumes the npm package is installed; use `node commitsmith.mjs` instead if running from a local clone)

This repo's own `package.json` ships these same scripts (`npm run commit`,
`commit:go`, `commit:split`, `commit:hunks`, `commit:group`, `commit:check`,
`release-notes`) for working on `commitsmith` itself, plus `npm test`, which
syntax-checks `commitsmith.mjs` and every module under `src/` (see
[Project structure](#project-structure)).

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
commitsmith init                    # interactive setup — choose a provider/model, write a config file

git add <files>

commitsmith                        # print a message for all staged changes (no commit)
commitsmith --commit                # generate, confirm, then commit
commitsmith -y                      # generate and commit, no confirmation

commitsmith --split                 # auto-detect related files, merge them; one message per file otherwise
commitsmith --split --commit        # same, confirm and commit each resulting commit
commitsmith --split -y              # same, no confirmation prompts
commitsmith --split --no-group-detection -y  # strict one commit per staged file, no relatedness detection

commitsmith --split-hunks --commit  # one commit per logical diff hunk
commitsmith --split-hunks -y        # same, no confirmation prompts

commitsmith --group --commit        # cluster related staged files, one commit per group (no per-file fallback)
commitsmith --group -y              # same, no confirmation prompts

commitsmith --split-hunks --dry-run # preview hunks + messages, no staging or commits
commitsmith --check                 # re-classify HEAD's diff, warn if its message looks inconsistent
commitsmith --check --from v1.0.0   # scan every commit since a ref (pre-release gate for unflagged breaking changes)

commitsmith --release-notes         # print user-facing notes since the last tag, compared against HEAD
commitsmith --release-notes --from v1.0.0   # use a specific base ref instead of the last tag
commitsmith --release-notes --branch main   # compare the base ref against a branch instead of HEAD
commitsmith --release-notes --store play --lang fr,sw --output notes.md   # 500-char limit, extra languages, save to a file

commitsmith --no-interactive        # never prompt (automatic when piped or CI is set); --interactive forces prompts on a TTY

commitsmith --no-breaking-detection # skip breaking-change classification
commitsmith --help                  # usage summary
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
| `--release-notes` | read-only — summarizes the diff from a tag/base to HEAD or `--branch <ref>` | writing user-facing release notes for an app store listing or a release announcement |

---

## `--split` / `--group` relatedness detection — how it works and its limits

1. Sends **all** staged files' diffs to the model in a single request, each
   truncated to `COMMITSMITH_GROUP_MAX_DIFF_PER_FILE` characters
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
  `COMMITSMITH_TIMEOUT_MS` and model context length on large changesets than
  the other modes. Lower `COMMITSMITH_GROUP_MAX_DIFF_PER_FILE` if you're
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

`commitsmith --split-hunks --dry-run` previews the detected hunks and their
generated messages without running `git reset`, `git apply --cached`, or any
commit — your staged changes are left exactly as they were. Only supported
with `--split-hunks` (the only mode that mutates the index as part of
generating messages); passing it with other modes prints a warning and is
otherwise ignored.

---

## `--check`

`commitsmith --check` re-sends HEAD's existing diff to the model and compares
its classification against the commit message that was actually written —
useful for catching commits made by hand (bypassing `commitsmith`) that forgot a
💥/`BREAKING CHANGE` flag or used a mismatched type. Read-only: it never
touches the index or rewrites history, and it exits non-zero when it finds an
issue, so it works as a CI check or a post-commit/pre-push hook gate.

`commitsmith --check --from <ref> [--branch <ref>]` does the same for **every
non-merge commit** in `<ref>..HEAD` (or `..<branch>`) — a pre-release gate that
lists each commit as ✅ or ⚠ and exits non-zero if any breaking change went
unflagged. It makes one model call per commit and checks at most the newest 50
(narrow `--from` to cover more).

```bash
commitsmith --check --from 1.0.0   # everything since the 1.0.0 tag
```

### `--breaking` (dry run)

`commitsmith --breaking` answers "does this change break anything?" **before**
you commit. It sends the staged changes (or, if nothing is staged, the
unstaged working-tree changes) to the model with a prompt focused only on
breaking changes — removed or renamed CLI flags, env vars, config keys,
exported functions, routes, schemas, or changed defaults — and prints each
finding with its impact plus a ready-to-paste `BREAKING CHANGE:` footer. It
never writes a commit message or touches the index or history.

```bash
commitsmith --breaking                  # staged (else unstaged) changes
commitsmith --breaking --from 1.0.0     # everything since a tag, compared against HEAD
commitsmith --breaking --from 1.0.0 --branch main
```

The same review runs automatically when commit messages are generated: if the
message wasn't already flagged, a second, focused breaking-change pass looks at
the diff (per group in `--group`/`--split`), and a hit gets the 💥 header plus
the `BREAKING CHANGE:` footer. That costs one extra model call per message;
`--no-breaking-detection` (or `breakingDetection: false`) turns both off.

Exit code: `1` when breaking changes are found, `2` if part of the answer
couldn't be parsed (so a gate never passes silently), `0` otherwise — handy as
a pre-release or CI gate. Lockfiles, tests and `.github/` are ignored for
ranges. Large diffs are analyzed per file (first 30 files).

---

## Interactive mode

When stdin and stdout are a real terminal, `commitsmith` offers prompts; it never
prompts when piped, when `CI` is set, or with `--no-interactive` (`--interactive`
overrides `CI` on a TTY). Without a terminal, "commit with confirmation" declines
and tells you to pass `-y`.

- **Commit review menu** (every mode, when committing without `-y`): commit, edit
  in `$EDITOR`, change the type / breaking flag, regenerate, regenerate with an
  instruction, or skip.
- **`--split-hunks`:** tick which hunks to commit (the rest stay unstaged), then
  one commit per hunk, one for all, or a custom grouping.
- **`--group` / `--split`:** review the model's groups — move a file to another or a
  new group, or merge two groups; changed groups get fresh messages.
- **Bare `commitsmith`:** the mode and commit-behavior prompts default to what you
  picked last time (stored in `state.json` in the global config directory).
- **`--release-notes`:** see [Release notes](#release-notes).

---

## Release notes

`commitsmith --release-notes` finds the most recent git tag reachable from the
target (HEAD, or `--branch`), then asks the model for short **user-facing**
release-note bullets — plain language, no file paths or function names — that
you can paste into the Play Store / App Store consoles. It is read-only: no
staging, commits, or history changes.

- **Input:** the release's commit subjects/bodies (primary) plus the diff with
  lockfiles, tests and `.github/` filtered out (supplementary, truncated to
  `COMMITSMITH_MAX_DIFF`). The diff is a merge-base (three-dot) diff, so only what
  the target added is summarized.
- `--from <ref>` overrides the base ref (e.g. `--from v1.0.0`, or when the repo
  has no tags). If the target sits exactly on a tag, the previous tag is used.
- `--branch <ref>` changes the target from HEAD to that branch; the default base
  tag is the one reachable from it. Combine both: `--from v1.0.0 --branch main`.
  `--from=<ref>` syntax works too.
- `--max-chars <n>` drops the least notable trailing bullets until the output
  fits (Play Store limit: 500). `--copy` also copies the bullets to the clipboard.
- `COMMITSMITH_RELEASE_NOTES_CONTEXT` / config key `releaseNotesContext` describes
  the product (e.g. `"a mobile banking app"`) so the notes use the right voice.
- Refs are validated before any network call. Only the bullets go to stdout;
  the header and progress go to stderr, so `> notes.txt` captures just the notes.
- `--store play|app-store|github` is a preset for `--max-chars` (500 / 4000 / none).
  `--lang fr,sw` also translates the approved bullets (output is grouped as
  `[en]`, `[fr]`, …). `--output <file>` saves the result.
- **In a terminal** (no `--no-interactive`), it walks you through: pick the range
  (recent tags/branches) → pick the destination preset → review the bullets
  (untick, edit, regenerate, shorter, more detailed, or with your own
  instruction) → extra languages → print / copy / save. Store, languages and
  mode choices are remembered in `state.json` next to your global config.
- If there is nothing between the refs, it reports that and exits with an error.

```bash
commitsmith --release-notes --from v1.2.3 --branch main --max-chars 500 --copy
```

---

## Configuration

Environment variables take precedence over a config file, which takes
precedence over built-in defaults.

### `commitsmith init`

The fastest way to set up a project: an interactive wizard that asks for a
provider, host, and (for cloud providers) an API key, then **fetches that
provider's actual available models live** and lets you pick one from a list
instead of guessing a name — falling back to free-text entry if the fetch
fails (e.g. Ollama isn't running, or the key is wrong). Also asks for a
breaking-change preference, optional fallback models, and **where to save**:

- **This project only** (`./.commitsmithrc.json`) — never stores an API key;
  meant to be committed and shared with your team.
- **Your user profile (global)** — writes to the OS-standard per-user config
  directory (see [Config file](#config-file)), used as a fallback by any
  project that has no config of its own. Here you can optionally also store
  the API key itself, since this file is private to you — asked explicitly,
  off by default.

```bash
commitsmith init
```

Safe to run before Ollama is reachable, outside a git repo, and right after
installing. Re-run it any time to overwrite a config (it asks first).

| Variable | Default | Description |
|---|---|---|
| `COMMITSMITH_PROVIDER` | `ollama` | `ollama` \| `ollama-cloud` \| `openai` \| `anthropic` — see [Providers](#providers) |
| `COMMITSMITH_API_KEY` | *(none)* | required for every provider except local `ollama` |
| `COMMITSMITH_MODEL` | provider-dependent | model to use (see [Providers](#providers) for each provider's default) |
| `COMMITSMITH_HOST` | provider's standard API base URL | override to point `openai` at a compatible endpoint, or any provider at a proxy |
| `COMMITSMITH_MAX_DIFF` | `6000` | Max characters of diff sent per request (larger diffs are truncated) |
| `COMMITSMITH_TIMEOUT_MS` | `60000` | Per-request inactivity timeout, in milliseconds (resets on every streamed chunk) |
| `COMMITSMITH_GROUP_MAX_DIFF_PER_FILE` | `1200` | Max characters of *each file's* diff sent during `--split`/`--group` relatedness detection (all staged files are sent together in one request) |
| `COMMITSMITH_RELEASE_NOTES_CONTEXT` | *(none)* | short product description injected into the `--release-notes` prompt (config key `releaseNotesContext`) |
| `COMMITSMITH_FALLBACK_MODELS` | *(none)* | comma-separated models to try, in order, on the same provider, if the primary model fails or times out |

### Config file

Looked up via [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) under
the name `commitsmith`, with `searchStrategy: 'global'` — meaning it checks, in order:

1. `.commitsmithrc`, `.commitsmithrc.json`, `.commitsmithrc.yaml`, `.commitsmithrc.js`,
   `commitsmith.config.js`, or an `"commitsmith"` key in `package.json`, in the
   current directory and every parent directory up to your home directory
   (a **project config** — the first one found wins)
2. If none of those exist, the OS-standard per-user config directory as a
   **global fallback** — `%APPDATA%\commitsmith\Config` on Windows,
   `~/Library/Preferences/commitsmith` on macOS, `~/.config/commitsmith` on Linux
   (checking `config.json`, `config.yaml`, `config.js`, etc. there)

`commitsmith init` can write to either location — run it and pick "This project
only" or "Your user profile (global)".

```json
{
  "commitsmith": {
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

(The `"commitsmith"` wrapper key is only for `package.json`; a standalone
`.commitsmithrc.json` or the global `config.json` holds those fields directly,
with no wrapper — that's what `commitsmith init` writes.)

Keys mirror the env vars above (camelCase, without the `COMMITSMITH_` prefix).

**Secrets**: a **project** config should never contain an `apiKey` — it's
meant to be shared/committed, and `commitsmith init` never offers to put one
there. For the **global** config, `init` offers three ways to handle a
cloud provider's API key, in order of preference:

1. **OS keychain (recommended)** — Windows Credential Manager, macOS
   Keychain, or Linux Secret Service, via [`@napi-rs/keyring`](https://github.com/napi-rs/node-rs).
   Nothing is written to any file; `commitsmith` looks it up by provider name
   at startup. Falls back to plain text automatically if the OS has no
   reachable keychain backend (e.g. headless Linux/CI without a Secret
   Service daemon running).
2. **Plain text in the global config file** — simplest, but readable by
   anything with file access. The file is restricted to owner-only
   read/write where the OS supports it (not meaningfully enforced on
   Windows, so keep it private yourself there).
3. **Don't save it** — set `COMMITSMITH_API_KEY` yourself instead.

Resolution order at runtime is env var → config file's plaintext `apiKey` →
OS keychain. `COMMITSMITH_API_KEY` always wins when set, regardless of what's
stored elsewhere.

Set env vars persistently on Windows (per-user):

```powershell
[System.Environment]::SetEnvironmentVariable('COMMITSMITH_MODEL', 'qwen2.5-coder:7b', 'User')
```

(requires a fresh terminal to take effect)

---

## Why not OpenCommit?

[OpenCommit](https://github.com/di-sukharev/opencommit) is a fine, more
full-featured tool. `commitsmith` is a smaller, more opinionated alternative for
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
- **`--release-notes`** to turn a tag-to-branch diff into user-facing release
  notes for app store listings, not just commit messages.
- **No prompt-module or config-loading machinery** to configure — `commitsmith`
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
commitsmith.mjs              executable entry point — just wires up src/cli.mjs
src/
  cli.mjs                 top-level dispatch (which mode to run)
  cli-args.mjs             parses process.argv into flags
  config.mjs               env vars + config file → resolved settings (provider, model, host, ...)
  constants.mjs            gitmoji map, allowed commit types
  die.mjs                  fail-fast helper
  secrets.mjs              OS keychain read/write for an API key, per provider
  git.mjs                  all git plumbing (diffs, staged files, hunks, commit, last tag, tag-to-branch range diff)
  prompts.mjs               the three model prompts (single-diff, grouping, release notes)
  parsing.mjs               model JSON → commit message / file groups / release-note bullets
  generate.mjs              diff text → generated message (ties prompts/parsing/providers together)
  ui.mjs                    printHelp, the edit-in-$EDITOR confirmation prompt
  providers/
    stream.mjs               shared SSE/NDJSON streaming + timeout handling
    ollama.mjs, openai.mjs, anthropic.mjs   one per provider's wire format
    index.mjs                 provider dispatch + model-fallback retry loop
    list-models.mjs           live "what models exist" lookup, used by `commitsmith init`
  modes/
    single.mjs, split.mjs, group.mjs, split-hunks.mjs, check.mjs,
    release-notes.mjs, init.mjs, use.mjs, interactive-stage.mjs   one per CLI mode (plus the staging prompt)
scripts/
  check-syntax.mjs          node --check over the entry point and every src/**/*.mjs file
test/
  git.test.mjs, parsing.test.mjs   unit tests for pure diff/hunk and model-output parsing
```

No build step — Node runs the `.mjs` files directly, both from a local clone
and from the published npm package (`src/` is included in `files`).

---

## Release process

Versions are unprefixed (`1.0.0`, not `v1.0.0`) — `tag_prefix: ""` in
`.github/workflows/bump-version.yml` enforces this when it tags.

`.github/workflows/ci-check.yml` ("CI") runs on every push and PR (Node 22 &
24): `pnpm install --frozen-lockfile`, `pnpm test` (syntax checks + unit tests),
a `node commitsmith.mjs --help` smoke test, `package.json` validation,
`pnpm audit --production`, and `pnpm pack`.

When CI succeeds on `main`, `.github/workflows/bump-version.yml` creates a
semver tag and a GitHub Release — but only if `src/` or `package.json` changed
since the previous tag. When the release is published,
`.github/workflows/publish-npm.yml` pins `package.json` to that tag in the CI
checkout (so the committed version doesn't have to match), runs `pnpm test`
plus the `--help` smoke test, then stages the publish with
`npm stage publish --provenance --access public` via npm Trusted Publishing
(OIDC) — no long-lived `NPM_TOKEN`. A maintainer must still run
`npm stage approve <stage-id>` (or approve on npmjs.com with 2FA); the
stage-only Trusted Publisher is deliberate.

Work on `develop` goes to `main` through `.github/workflows/next-release.yml`:
after CI succeeds on `develop`, it opens a PR titled `Release: <first line of
the commit message>` targeting `main`.

A manual alternative is `pnpm version patch` (or `minor`/`major`) followed by
`git push --follow-tags`, but the automated path above is the normal one.

> First-ever publish only: npm's Trusted Publisher config must point at an
> *existing* package, so the very first release has to be published
> manually with a token before Trusted Publishing can be configured on
> npmjs.com for this package.

---

## Troubleshooting

**"Cannot reach Ollama at http://localhost:11434"**
Ollama isn't running. Start it with `ollama serve`, or set `COMMITSMITH_HOST`
if it's running elsewhere, or `COMMITSMITH_PROVIDER=openai`/`anthropic`/`ollama-cloud`
to use a cloud provider instead.

**"COMMITSMITH_API_KEY ... is required for provider ..."**
Set `COMMITSMITH_API_KEY` for any provider other than local `ollama` (OpenAI,
Anthropic, and Ollama Cloud all require one).

**401 Unauthorized despite having configured a key via `commitsmith init`**
Check whether `COMMITSMITH_API_KEY` is already set in your shell — the env var
always takes precedence over a key stored in the OS keychain or a config
file, so a stale/leftover value there silently overrides anything you just
configured. `echo $COMMITSMITH_API_KEY` (bash/zsh) or `echo $env:COMMITSMITH_API_KEY`
(PowerShell) to check, and unset it if it's not what you meant to use.

**Message still splits into multiple commits for one file**
Use `--split-hunks` instead of the default mode — it separates by logical
diff hunk rather than relying on the model to compress everything into one
message.

**Request timed out**
Increase `COMMITSMITH_TIMEOUT_MS`, reduce `COMMITSMITH_MAX_DIFF`, switch to a
smaller/faster model via `COMMITSMITH_MODEL`, or set `COMMITSMITH_FALLBACK_MODELS`
to retry with a backup model automatically.

**`git commit failed`**
Usually a pre-commit hook or lint-staged failure unrelated to `commitsmith` —
check the git output printed above the error; it's passed through via
`stdio: 'inherit'`.

**"No release-notes base ref found"**
The working repo has no git tags yet. Give `--release-notes` an explicit base,
e.g. `--from v1.0.0` or `--from HEAD~10`.

**"No changes between ... and ..."**
The two refs have no commits or diff between them (pick an older `--from` base
or a different `--branch`).

**"--from: ... is not a valid ref"**
The ref doesn't exist in this repo (typo, or the tag wasn't fetched: `git fetch --tags`).

---

## License

MIT — see [`LICENSE`](./LICENSE).