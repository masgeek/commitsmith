import chalk from 'chalk';
import { MAX_DIFF } from './config.mjs';
import { getStagedDiff, truncateDiff } from './git.mjs';
import { buildPrompt } from './prompts.mjs';
import { parseModelJson, formatCommitMessage, fallbackFromRawText } from './parsing.mjs';
import { callModel } from './providers/index.mjs';
import { die } from './die.mjs';

export async function generateMessageForDiffText(diffText, label) {
  const diff = truncateDiff(diffText, MAX_DIFF);
  console.log();

  let raw;
  try {
    raw = await callModel(buildPrompt(diff), `commit message for ${label}`);
  } catch (err) {
    die(err.message);
  }

  const parsed = parseModelJson(raw);
  const result = parsed ? formatCommitMessage(parsed) : fallbackFromRawText(raw);

  if (!result || !result.message) {
    die('Model returned an empty or unparseable message. Try again or check OCOLITE_MODEL.');
  }

  console.log(chalk.dim('——————————————————'));
  console.log(result.message);
  console.log(chalk.dim('——————————————————'));
  if (result.breaking) {
    console.log(chalk.yellow('⚠ marked as a BREAKING CHANGE'));
  }

  return result.message;
}

export async function generateMessageFor(pathspec, label) {
  return generateMessageForDiffText(getStagedDiff(pathspec), label);
}
