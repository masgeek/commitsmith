# oco-lite

Minimal, dependency-free git commit message generator powered by a local
[Ollama](https://ollama.com) model. Built as a lightweight replacement for
[OpenCommit](https://github.com/di-sukharev/opencommit) after hitting two
unresolved OpenCommit issues: multi-line output for single-file changes
([#315](https://github.com/di-sukharev/opencommit/issues/315),
[#114](https://github.com/di-sukharev/opencommit/issues/114)) and a Windows
ESM path crash in `@commitlint` prompt-module mode.

`oco-lite` talks to your local Ollama instance directly with a strict,
structured prompt — no OpenCommit dependency, no ESM config loading, full
control over the output format.

---

## Features

- Single-line, strictly-formatted [Conventional Commits](https://www.conventionalcommits.org/) messages
- Structured JSON model output (reliable to parse — no prose-scraping)
- **Breaking change detection** — flags and marks commits per spec (`type(scope)!: subject` + `BREAKING CHANGE:` footer)
- Four granularities:
    - one message for all staged changes
    - one commit **per staged file** (`--split`)
    - one commit **per logical diff hunk** (`--split-hunks`)
    - one commit **per group of related files** (`--group`) — the only mode that can *combine* multiple files into a single commit
- Pre-flight checks (git repo detection, Ollama reachability)
- Request timeout handling — no hangs on a stuck Ollama call
- Zero npm dependencies — pure Node.js (`node:child_process`, `node:readline`, native `fetch`)

---

## Requirements

- Node.js **18+** (uses native `fetch`)
- [Ollama](https://ollama.com) running locally with a pulled model, e.g.:
  ```bash
  ollama pull qwen2.5-coder:7b
  ```
- Git

---

## Installation

### Option A — Global CLI (recommended)

```powershell
cd D:\Dev\js\oco-lite
pnpm add -g file:.
```

> `pnpm add -g .` may fail on some pnpm/Windows setups with
> `ERR_PNPM_PACKAGE_MANAGER_ADD_RESOLVE_LATEST` (pnpm treats the bare `.` as
> a registry package name instead of a local path). Use the explicit
> `file:` protocol as shown above. If that still fails, pack and install
> the tarball instead:
> ```powershell
> pnpm pack
> pnpm add -g ./oco-lite-1.0.0.tgz
> ```

Verify:

```powershell
Get-Command oco-lite
oco-lite --help
```

If `oco-lite` isn't found, open a **fresh terminal** — PATH changes from a
global install don't apply to already-open shells.

To update after editing `oco-lite.mjs`, re-run `pnpm add -g file:.` from
the project folder (this is a real install, not a live symlink — edits
aren't picked up automatically).

To remove:

```powershell
pnpm remove -g oco-lite
```

### Option B — Git alias (no packaging)

```powershell
git config --global alias.aicommit '!node D:/Dev/js/oco-lite/oco-lite.mjs --commit'
git config --global alias.aicommit-split '!node D:/Dev/js/oco-lite/oco-lite.mjs --split --commit'
git config --global alias.aicommit-hunks '!node D:/Dev/js/oco-lite/oco-lite.mjs --split-hunks --commit'
```

Then from any repo: `git aicommit`, `git aicommit-split`, `git aicommit-hunks`.

### Option C — Per-project npm script

Add to `package.json`:

```json
{
  "scripts": {
    "commit": "node oco-lite.mjs",
    "commit:go": "node oco-lite.mjs --commit",
    "commit:split": "node oco-lite.mjs --split --commit",
    "commit:hunks": "node oco-lite.mjs --split-hunks --commit"
  }
}
```

Adjust the path to `oco-lite.mjs` if it isn't at the project root.

---

## Usage

```bash
git add <files>

oco-lite                        # print a message for all staged changes (no commit)
oco-lite --commit                # generate, confirm, then commit
oco-lite -y                      # generate and commit, no confirmation

oco-lite --split                 # print one message per staged file
oco-lite --split --commit        # one commit per staged file, confirm each
oco-lite --split -y              # one commit per staged file, no prompts

oco-lite --split-hunks --commit  # one commit per logical diff hunk
oco-lite --split-hunks -y        # same, no confirmation prompts

oco-lite --group --commit        # cluster related staged files, one commit per group
oco-lite --group -y              # same, no confirmation prompts

oco-lite --no-breaking-detection # skip breaking-change classification
oco-lite --help                  # usage summary
```

### Which mode should I use?

| Mode | Granularity | Use when |
|---|---|---|
| default | one commit for everything staged | quick, single logical change across files |
| `--split` | one commit per file | changes to unrelated files staged together |
| `--split-hunks` | one commit per diff hunk | one file with several distinct, unrelated edits (e.g. multiple refactors in one seeder/class) |
| `--group` | one commit per detected group of related files | several files staged together, some of which belong to the same feature/fix and some don't (e.g. a migration + model + seeder for one feature, plus an unrelated typo fix elsewhere) |

---

## `--group` — how it works and its limits

1. Sends **all** staged files' diffs to the model in a single request, each
   truncated to `OCOLITE_GROUP_MAX_DIFF_PER_FILE` characters
2. The model returns a JSON list of groups, each with its own file list,
   type, scope, subject, and breaking-change flag — files are clustered
   together only when they implement the same logical change
3. Every staged file is guaranteed to end up in exactly one commit:
    - if the model misses or duplicates a file, leftover files are swept
      into a trailing `chore: update remaining files` group rather than
      silently dropped
    - if the model's response doesn't parse into a valid grouping at all,
      it automatically falls back to `--split` (one commit per file)
4. If only one file is staged, there's nothing to group — it falls back to
   the default single-commit mode

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

## Breaking change detection

Every generated message is classified for breaking-change risk:

- removed or renamed public function/class/route
- changed method signature
- migration that alters an existing schema/column
- changed config key or environment variable

When flagged, the message is marked per the Conventional Commits spec:

```
feat(api)!: remove legacy /v1/schools endpoint

BREAKING CHANGE: clients calling /v1/schools must migrate to /v2/schools
```

Detection is deliberately conservative — routine refactors, new files, and
additive/optional changes are **not** flagged. If it's still too
trigger-happy for your codebase, disable it with `--no-breaking-detection`.

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

Test on a low-stakes branch or file before trusting it on real work.

---

## Configuration

All configuration is via environment variables — no config file.

| Variable | Default | Description |
|---|---|---|
| `OCOLITE_MODEL` | `qwen2.5-coder:7b` | Ollama model to use |
| `OCOLITE_HOST` | `http://localhost:11434` | Ollama API base URL |
| `OCOLITE_MAX_DIFF` | `6000` | Max characters of diff sent per request (larger diffs are truncated) |
| `OCOLITE_TIMEOUT_MS` | `60000` | Per-request timeout to Ollama, in milliseconds |
| `OCOLITE_GROUP_MAX_DIFF_PER_FILE` | `1200` | Max characters of *each file's* diff sent in `--group` mode (all staged files are sent together in one request) |

Set persistently on Windows (per-user):

```powershell
[System.Environment]::SetEnvironmentVariable('OCOLITE_MODEL', 'qwen2.5-coder:7b', 'User')
```

(requires a fresh terminal to take effect)

---

## Why not OpenCommit?

`oco-lite` exists because of two blocking bugs hit while using OpenCommit
with a local Ollama model:

1. **Multi-line commit messages for a single logical change** —
   `OCO_ONE_LINE_COMMIT=true` and `OCO_DESCRIPTION=false` do not reliably
   collapse output to one line; this is a known, unresolved upstream issue
   ([#315](https://github.com/di-sukharev/opencommit/issues/315),
   [#114](https://github.com/di-sukharev/opencommit/issues/114)) baked into
   the `conventional-commit` prompt module's template, independent of which
   model answers it.
2. **Windows ESM path crash in `@commitlint` mode** — switching
   `OCO_PROMPT_MODULE=@commitlint` fails with
   `Only URLs with a scheme in: file, data, and node are supported by the
   default ESM loader` when trying to `import()` `commitlint.config.js`
   using a raw `D:\...` path instead of a `file://` URL.

`oco-lite` sidesteps both by owning the full prompt → response → format
pipeline directly.

---

## Troubleshooting

**"Cannot reach Ollama at http://localhost:11434"**
Ollama isn't running. Start it with `ollama serve`, or set `OCOLITE_HOST`
if it's running elsewhere.

**Message still splits into multiple commits for one file**
Use `--split-hunks` instead of the default mode — it separates by logical
diff hunk rather than relying on the model to compress everything into one
line.

**Ollama request timed out**
Increase `OCOLITE_TIMEOUT_MS`, reduce `OCOLITE_MAX_DIFF`, or switch to a
smaller/faster model via `OCOLITE_MODEL`.

**`git commit failed`**
Usually a pre-commit hook or lint-staged failure unrelated to `oco-lite` —
check the git output printed above the error; it's passed through via
`stdio: 'inherit'`.

---