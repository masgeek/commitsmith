import fs from 'node:fs';
import chalk from 'chalk';
import { getWorkingDiffPreferStaged } from '../git.mjs';
import { scanDiff } from '../secret-guard.mjs';
import { lintCommitMessage } from '../conventional.mjs';
import { loadRulesFromFiles } from '../rules.mjs';
import { die } from '../die.mjs';

/**
 * `--scan`: offline, read-only secret scan of the staged changes (or the
 * unstaged ones when nothing is staged). No model, no network. Exit 1 when
 * anything is found, so it works as a pre-commit hook.
 */
export function runScanMode() {
  const input = getWorkingDiffPreferStaged();
  if (!input) {
    console.log('Nothing to scan: no staged or unstaged changes.');
    return;
  }

  const findings = scanDiff(input.diff);
  if (findings.length === 0) {
    console.log(chalk.green(`✅ No likely secrets found in the ${input.source}.`));
    return;
  }

  console.error(chalk.yellow(`⚠ ${findings.length} likely secret(s) in the ${input.source}:\n`));
  for (const f of findings) {
    const where = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`  ${where}  ${f.type}${f.sample ? `  ${f.sample}` : ''}`);
  }
  console.error('\nRemove them (and rotate any real credential) before committing. Bypass once with `git commit --no-verify`.');
  process.exitCode = 1;
}

/**
 * `--lint-message <file>`: offline check of a commit message file (what git
 * passes to the commit-msg hook): "[emoji ]type(scope): subject", a known
 * type, a subject under 72 characters. Exit 1 on violations.
 */
export async function runLintMessageMode(file) {
  let message;
  try {
    message = fs.readFileSync(file, 'utf8');
  } catch (err) {
    die(`Could not read the commit message file "${file}": ${err.code || err.message}`);
  }

  // Project rules (scopes, types, length) come straight from the config files — no keychain or provider.
  const issues = lintCommitMessage(message, await loadRulesFromFiles());
  if (issues.length === 0) return;

  console.error(chalk.yellow('✖ Commit message rejected:\n'));
  issues.forEach((issue) => console.error(`  - ${issue}`));
  console.error('\nFix the message, or bypass once with `git commit --no-verify`.');
  process.exitCode = 1;
}
