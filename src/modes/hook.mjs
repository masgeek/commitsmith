import fs from 'node:fs';
import path from 'node:path';
import { getHooksDir } from '../git.mjs';
import { hookAction, hookPrePush, hookForce } from '../cli-args.mjs';
import { die } from '../die.mjs';

/** Present in every hook we write, so we only ever touch our own. */
export const HOOK_MARKER = '# commitsmith-managed hook';

const header = (what) => `#!/bin/sh\n${HOOK_MARKER}\n# ${what}\n# Remove with: commitsmith hook uninstall (bypass once with --no-verify)\n`;
// If commitsmith isn't on PATH the hook does nothing rather than blocking git.
const guardPath = 'command -v commitsmith >/dev/null 2>&1 || exit 0\n';

export const HOOK_SCRIPTS = {
  'pre-commit': `${header('Blocks commits that add likely secrets (offline scan).')}${guardPath}exec commitsmith --scan\n`,
  'commit-msg': `${header('Checks the message format: [emoji ]type(scope): subject (offline).')}${guardPath}exec commitsmith --lint-message "$1"\n`,
  'pre-push': `${header('Fails the push if a commit hides an unflagged breaking change (uses your model).')}${guardPath}up=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null) || exit 0\nexec commitsmith --check --from "$up"\n`,
};

/** The hooks to manage: pre-commit + commit-msg always, pre-push on request (it calls the model). */
export const hookNames = ({ prePush = false } = {}) => ['pre-commit', 'commit-msg', ...(prePush ? ['pre-push'] : [])];

/**
 * Writes the hooks into `dir`. A hook we wrote is updated in place; one you
 * wrote is left alone unless `force`, which first moves it to
 * `<name>.commitsmith-backup`. Returns [{ name, status, reason? }] with status
 * installed | updated | replaced | skipped.
 */
export function installHooks(dir, { names, force = false }) {
  fs.mkdirSync(dir, { recursive: true });
  return names.map((name) => {
    const file = path.join(dir, name);
    let status = 'installed';
    if (fs.existsSync(file)) {
      if (fs.readFileSync(file, 'utf8').includes(HOOK_MARKER)) {
        status = 'updated';
      } else if (force) {
        fs.renameSync(file, `${file}.commitsmith-backup`);
        status = 'replaced';
      } else {
        return { name, status: 'skipped', reason: 'a hook you wrote already exists (use --force to back it up and replace it)' };
      }
    }
    fs.writeFileSync(file, HOOK_SCRIPTS[name], { mode: 0o755 });
    try {
      fs.chmodSync(file, 0o755);
    } catch {
      // best-effort — Windows ignores mode bits
    }
    return { name, status };
  });
}

/** Removes hooks we wrote (restoring a `.commitsmith-backup` if there is one); anything else is left alone. */
export function uninstallHooks(dir) {
  return Object.keys(HOOK_SCRIPTS).map((name) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return { name, status: 'absent' };
    if (!fs.readFileSync(file, 'utf8').includes(HOOK_MARKER)) return { name, status: 'foreign' };
    fs.unlinkSync(file);
    const backup = `${file}.commitsmith-backup`;
    if (fs.existsSync(backup)) {
      fs.renameSync(backup, file);
      return { name, status: 'restored' };
    }
    return { name, status: 'removed' };
  });
}

/** State of each hook: installed (current), outdated (ours, older text), foreign (someone else's), absent. */
export function hookStatus(dir) {
  return Object.keys(HOOK_SCRIPTS).map((name) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return { name, state: 'absent' };
    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes(HOOK_MARKER)) return { name, state: 'foreign' };
    return { name, state: text === HOOK_SCRIPTS[name] ? 'installed' : 'outdated' };
  });
}

/** `commitsmith hook install [--pre-push] [--force] | uninstall | status` */
export function runHookMode() {
  const dir = getHooksDir();

  if (hookAction === 'install') {
    const results = installHooks(dir, { names: hookNames({ prePush: hookPrePush }), force: hookForce });
    results.forEach((r) => console.log(`${r.status.padEnd(9)} ${r.name}${r.reason ? ` — ${r.reason}` : ''}`));
    console.log(`\nHooks directory: ${dir}`);
    console.log('pre-commit scans for secrets, commit-msg checks the message format; both run offline.');
    if (!hookPrePush) console.log('Add --pre-push to also gate pushes on unflagged breaking changes (calls your model).');
    console.log('They need `commitsmith` on your PATH (otherwise they do nothing). Bypass once with --no-verify.');
    if (results.some((r) => r.status === 'skipped')) process.exitCode = 1;
  } else if (hookAction === 'uninstall') {
    uninstallHooks(dir).forEach((r) => console.log(`${r.status.padEnd(9)} ${r.name}`));
  } else if (hookAction === 'status') {
    hookStatus(dir).forEach((r) => console.log(`${r.state.padEnd(9)} ${r.name}`));
    console.log(`\nHooks directory: ${dir}`);
  } else {
    die('Usage: commitsmith hook install [--pre-push] [--force] | uninstall | status');
  }
}
