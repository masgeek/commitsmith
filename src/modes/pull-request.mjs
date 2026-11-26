import * as clack from '@clack/prompts';
import { loadConfig } from '../config.mjs';
import {
  getCurrentBranch,
  getDefaultBranch,
  getRemoteUrl,
  getReleaseCommits,
  getBranchDiff,
  isBranchPushed,
  pushBranch,
  resolveCommit,
  truncateDiff,
} from '../git.mjs';
import { checkGh, findOpenPr, createPullRequest, updatePullRequest } from '../github.mjs';
import { resolveBotToken } from '../github-auth.mjs';
import { buildPullRequestPrompt } from '../prompts.mjs';
import { parsePullRequest, extractBreakingNotes, formatPullRequestBody, formatCommitsForPrompt } from '../parsing.mjs';
import { BREAKING_GITMOJI } from '../constants.mjs';
import { callModel } from '../providers/index.mjs';
import { copyToClipboard } from '../clipboard.mjs';
import { editMessageInEditor } from '../ui.mjs';
import { prBase, prDraft, prCreate, prAsBot, autoYes, dryRun } from '../cli-args.mjs';
import { die } from '../die.mjs';

/** Breaking notes for the PR: commit footers, plus a pointer for any 💥 commit that has none. */
export function collectBreakingNotes(commits) {
  const notes = extractBreakingNotes(commits);
  for (const { subject, body } of commits) {
    if (subject.startsWith(BREAKING_GITMOJI) && !/BREAKING[ -]CHANGE:/i.test(body)) notes.push(`Breaking change in: ${subject}`);
  }
  return notes;
}

/** Title with a leading 💥 when the PR carries breaking changes. */
export function withBreakingPrefix(title, breaking) {
  return breaking.length > 0 && !title.startsWith(BREAKING_GITMOJI) ? `${BREAKING_GITMOJI} ${title}` : title;
}

/**
 * Resolves the branch pair and gathers the model input — git only, no
 * network — so cli.mjs can fail fast before the provider check.
 */
export async function preparePullRequest() {
  const { MAX_DIFF, GITHUB_BOT } = await loadConfig();

  const head = getCurrentBranch();
  if (!head) die('Detached HEAD: check out the branch you want to open a pull request from.');

  const base = (prBase || getDefaultBranch() || '').replace(/^origin\//, '');
  if (!base) die('Could not determine the base branch. Pass --base <branch>.');
  if (base === head) die(`You are on "${base}", the base branch. Switch to a feature branch first.`);

  // Compare against the remote copy of the base when there is one: that is what the PR will diff against.
  const baseRef = resolveCommit(`origin/${base}`) ? `origin/${base}` : resolveCommit(base) ? base : null;
  if (!baseRef) die(`Base branch "${base}" was not found locally or on origin. Pass --base <branch>.`);

  const commits = getReleaseCommits(baseRef, 'HEAD');
  if (commits.length === 0) die(`"${head}" has no commits ahead of "${base}" — nothing to open a pull request for.`);

  // "As a bot": resolve the bot's token now (before any model call) so bad credentials fail fast.
  // It stays in memory and is handed to gh through its environment only.
  let token = null;
  if (prAsBot || GITHUB_BOT.asDefault) {
    try {
      token = await resolveBotToken({ bot: GITHUB_BOT, remoteUrl: getRemoteUrl('origin') });
    } catch (err) {
      die(err.message);
    }
  }

  // Checked up front (before any model call) so an existing PR is updated, not duplicated.
  // Quietly null when gh is missing; creating will report that properly.
  const existing = findOpenPr(head, token);

  return {
    head,
    base,
    token,
    existing,
    commits,
    commitsText: truncateDiff(formatCommitsForPrompt(commits), MAX_DIFF),
    diff: truncateDiff(getBranchDiff(baseRef, 'HEAD'), MAX_DIFF),
    breaking: collectBreakingNotes(commits),
  };
}

function printPreview({ title, body }) {
  console.log(`${title}\n\n${body}`);
}

/**
 * Pushes the branch if needed, then opens the PR — or, when `existing` is
 * set, updates that PR's title and description instead. Returns the URL.
 * Exits with a clear message on any failure.
 */
function openPullRequest({ head, base, title, body, draft, existing, token }) {
  const gh = checkGh(token);
  if (!gh.ok) die(`${gh.reason}\nNothing was changed; the title and description above are ready to paste.`);

  if (!isBranchPushed(head)) {
    console.error(`Pushing "${head}" to origin...`);
    pushBranch(head);
  }

  if (existing) {
    try {
      updatePullRequest({ number: existing.number, title, body, token });
    } catch (err) {
      return die(`gh pr edit failed: ${err.message}`);
    }
    console.error(`Updated pull request #${existing.number}.`);
    return existing.url;
  }

  try {
    return createPullRequest({ base, head, title, body, draft, token });
  } catch (err) {
    return die(`gh pr create failed: ${err.message}`);
  }
}

/**
 * Generates a PR title and description from the branch's commits and diff
 * (breaking changes are lifted from the commit footers), then previews it.
 * Without --create (or -y) nothing is pushed or opened. In a terminal you get
 * a menu to create (optionally as a draft), edit the title or body,
 * regenerate, copy, or cancel. The preview goes to stdout; status to stderr.
 */
export async function runPullRequestMode(input, { interactive = false } = {}) {
  const { head, base, token, existing, commitsText, diff, breaking } = input;

  async function generate(feedback = '') {
    let raw;
    try {
      raw = await callModel(buildPullRequestPrompt({ commitsText, diff, feedback }), `pull request for ${head}`);
    } catch (err) {
      die(err.message);
    }
    const pr = parsePullRequest(raw);
    if (!pr) die('Model returned an unusable pull request. Try again or check COMMITSMITH_MODEL.');
    return {
      title: withBreakingPrefix(pr.title, breaking),
      body: formatPullRequestBody({ summary: pr.summary, testPlan: pr.testPlan, breaking }),
    };
  }

  console.error(`Pull request: ${head} → ${base}`);
  if (token) console.error("It will be opened as a bot, not as your own GitHub login (the branch push still uses your git credentials).");
  if (existing) {
    console.error(`An open pull request already exists (#${existing.number}): ${existing.url}`);
    console.error('The generated title and description will replace its current ones.');
    if (prDraft) console.warn('--draft is ignored: an existing pull request keeps its draft state.');
  }
  console.error('');
  let pr = await generate();

  const verb = existing ? 'update the pull request' : 'open the pull request';
  const createNow = (prCreate || autoYes) && !dryRun;
  if (createNow) {
    printPreview(pr);
    console.log(openPullRequest({ head, base, ...pr, draft: prDraft, existing, token }));
    return;
  }
  if (!interactive) {
    printPreview(pr);
    console.error(`\nPreview only. Pass --create (or -y) to push the branch and ${verb}.`);
    return;
  }

  for (;;) {
    console.error('');
    printPreview(pr);
    console.error('');
    const choice = await clack.select({
      message: 'Pull request',
      options: [
        existing
          ? { value: 'create', label: `Update pull request #${existing.number}`, hint: 'pushes new commits, replaces title + description' }
          : { value: 'create', label: 'Create pull request', hint: 'pushes the branch if needed' },
        ...(existing ? [] : [{ value: 'draft', label: 'Create as draft' }]),
        { value: 'title', label: 'Edit title' },
        { value: 'body', label: 'Edit description in editor' },
        { value: 'regen', label: 'Regenerate' },
        { value: 'regen-note', label: 'Regenerate with an instruction…' },
        { value: 'copy', label: 'Copy to clipboard' },
        { value: 'cancel', label: 'Cancel' },
      ],
      initialValue: 'create',
    });
    if (clack.isCancel(choice) || choice === 'cancel') return console.error('Nothing created.');

    if (choice === 'create' || choice === 'draft') {
      if (dryRun) return console.error('--dry-run: nothing created.');
      console.log(openPullRequest({ head, base, ...pr, draft: choice === 'draft' || prDraft, existing, token }));
      return;
    }
    if (choice === 'title') {
      const title = await clack.text({ message: 'Title', initialValue: pr.title });
      if (!clack.isCancel(title) && title.trim()) pr = { ...pr, title: title.trim() };
    } else if (choice === 'body') {
      pr = { ...pr, body: editMessageInEditor(pr.body) };
    } else if (choice === 'copy') {
      console.error(copyToClipboard(`${pr.title}\n\n${pr.body}`) ? 'Copied to clipboard.' : 'Could not copy: no clipboard tool found.');
    } else {
      let feedback = '';
      if (choice === 'regen-note') {
        const note = await clack.text({ message: 'Instruction for the model', placeholder: 'e.g. emphasize the migration steps' });
        if (clack.isCancel(note) || !note.trim()) continue;
        feedback = note.trim();
      }
      pr = await generate(feedback);
    }
  }
}
