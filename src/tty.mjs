import { noInteractive, forceInteractive } from './cli-args.mjs';

/**
 * Pure decision, split out for testing: prompts only make sense on a real
 * terminal, never when piped, never in CI (unless --interactive forces it on
 * a TTY), and never when --no-interactive was passed.
 */
export function computeInteractive({ isTTY, ci, noInteractive: off = false, force = false }) {
  if (off || !isTTY) return false;
  if (force) return true;
  return !(ci && ci !== 'false' && ci !== '0');
}

/** True when it is safe to show interactive (clack) prompts. */
export function isInteractive() {
  return computeInteractive({
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ci: process.env.CI,
    noInteractive,
    force: forceInteractive,
  });
}
