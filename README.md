
Claude finished the response
Searched the web
Good — pnpm removed link --global entirely in recent versions. The current official replacement is pnpm add -g ., run from inside the package directory:

powershell
cd D:\Dev\js\oco-lite
pnpm add -g .
This installs your local package globally (registers its bin entry system-wide) using the same isolated global-install mechanism pnpm now uses for everything else.

Difference from the old link --global you'll want to know:
pnpm add -g . does a real install (copies/hard-links into pnpm's global store), not a live symlink back to your source folder. So after editing oco-lite.mjs, you'll need to re-run pnpm add -g . to pick up changes — it won't auto-reflect edits like the old link behavior did.

Verify:

powershell
Get-Command oco-lite
oco-lite --commit
To update after edits:

powershell
cd D:\Dev\js\oco-lite
pnpm add -g .
To remove:

powershell
pnpm remove -g oco-lite
D:\Dev\js\oco-lite> pnpm add -g .
Error: ERR_PNPM_PACKAGE_MANAGER_ADD_RESOLVE_LATEST
× adding a new package
╰─▶ Failed to resolve the latest version of D:\Dev\js\oco-lite: Failed to fetch metadata from https://registry.npmjs.org/D%3A%5CDev%5Cjs%5Coco-lite: HTTP status client error (404 Not Found) for url
(https://registry.npmjs.org/D%3A%5CDev%5Cjs%5Coco-lite)

Searched the web
pnpm add -g . apparently isn't resolving . as a local-directory spec on your pnpm/Windows setup — it's treating it as a bare package name and querying the registry, which is why you got a 404 lookup.

Try being explicit with the file: protocol instead:

powershell
pnpm add -g file:.
If that still misbehaves, use the full absolute path with the file: prefix (avoids any relative-path ambiguity):

powershell
pnpm add -g file:D:/Dev/js/oco-lite
(forward slashes work fine here even on Windows — pnpm normalizes them)

If both of those still fail, fall back to packing it into a tarball first and installing that, which sidesteps directory-spec parsing entirely:

powershell
cd D:\Dev\js\oco-lite
pnpm pack
pnpm add -g ./oco-lite-1.0.0.tgz
pnpm pack builds a .tgz from your package.json + files, and installing from a tarball path is unambiguous — pnpm can't confuse a .tgz file path for a registry name.

Try file:. first — that's most likely to just work and matches what the current pnpm docs describe as the supported local-directory install method.

let us mak the js file product read and also add ablity to detect reaking chaneg sand amark accorindlgy

Thought for 16s
Two solid additions — I'll switch the model output to structured JSON (far more reliable to parse than free text) and have it flag breaking changes, plus harden the script itself (timeouts, connection checks, proper exit codes, --help).

Created 2 files, ran 2 commands, read a file
What changed for "production ready":

Structured JSON output instead of free text — the model now returns {type, scope, subject, breaking, breakingReason} (format: 'json' forces Ollama's JSON mode). Far more reliable than parsing prose; a raw-text fallback still exists if JSON parsing fails.
Pre-flight checks — verifies you're inside a git repo and that Ollama is actually reachable (GET /api/tags) before doing any work, with a clear "is Ollama running?" message instead of a cryptic fetch failure mid-run.
Request timeout — OCOLITE_TIMEOUT_MS (default 60s) via AbortController, so a hung Ollama call doesn't hang the whole script forever.
Consistent error handling — single die() helper for fail-fast + proper non-zero exit codes throughout (useful if you ever wire this into CI or a pre-commit hook).
--help flag with full usage text.
unhandledRejection handler so any missed async error still exits cleanly instead of leaving a dangling process.
Breaking change detection:

The model classifies every generated message: removed/renamed public functions, changed method signatures, schema/migration changes, config key or env var changes → flagged breaking: true.
Marked per Conventional Commits spec: type(scope)!: subject, with a BREAKING CHANGE: <reason> footer appended when a reason is given.
Deliberately tuned conservative in the prompt (routine refactors, new files, optional params are explicitly told NOT to count) — false positives are more annoying than a missed one, so it's biased toward under-flagging.
Disable with --no-breaking-detection if it's too aggressive in practice on your codebase.
Test it against your RbacSeeder.php case again with --split-hunks --commit — you should see the JSON-driven output be noticeably more consistent hunk to hunk than the old free-text version was.


Oco lite
MJS
generate a readme with all instructions and stuff

Created a file, read a file
Drop this alongside oco-lite.mjs and package.json in D:\Dev\js\oco-lite. It covers install (both the pnpm add -g file:. workaround and the alias fallback), all three commit modes with a comparison table, breaking-change detection, full env var config, the --split-hunks mechanics and caveats, why this exists instead of OpenCommit (with links to the actual upstream issues you hit), and a troubleshooting section for the errors you've already run into.


Readme
Document · MD

Write a message…


Claude is AI and can make mistakes. Please double-check responses.


Readme · MD
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
- Three granularities:
    - one message for all staged changes
    - one commit **per staged file** (`--split`)
    - one commit **per logical diff hunk** (`--split-hunks`)
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
 
oco-lite --no-breaking-detection # skip breaking-change classification
oco-lite --help                  # usage summary
```

### Which mode should I use?

| Mode | Granularity | Use when |
|---|---|---|
| default | one commit for everything staged | quick, single logical change across files |
| `--split` | one commit per file | changes to unrelated files staged together |
| `--split-hunks` | one commit per diff hunk | one file with several distinct, unrelated edits (e.g. multiple refactors in one seeder/class) |
 
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

## License

Internal tool — Munywele Consulting LTD. Not published to a public registry.
 
