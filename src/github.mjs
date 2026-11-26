import { execFileSync } from 'node:child_process';

/** Arguments for `gh pr create`; the body is passed on stdin (`--body-file -`) so it never hits argv limits or quoting. */
export function buildPrCreateArgs({ base, head, title, draft }) {
  return ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body-file', '-', ...(draft ? ['--draft'] : [])];
}

/** Is the GitHub CLI installed and logged in? Returns { ok, reason }. */
export function checkGh() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
  } catch {
    return { ok: false, reason: 'The GitHub CLI (gh) is not installed. Install it from https://cli.github.com and run `gh auth login`.' };
  }
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  } catch {
    return { ok: false, reason: 'The GitHub CLI is not logged in. Run `gh auth login` first.' };
  }
  return { ok: true, reason: '' };
}

/** Arguments for `gh pr edit` (title + body from stdin). */
export function buildPrEditArgs({ number, title }) {
  return ['pr', 'edit', String(number), '--title', title, '--body-file', '-'];
}

/** First PR in `gh pr list --json url,number` output as { url, number }, or null. */
export function parseOpenPr(jsonText) {
  try {
    const first = JSON.parse(jsonText)?.[0];
    return first?.url && Number.isInteger(first.number) ? { url: first.url, number: first.number } : null;
  } catch {
    return null;
  }
}

/** The open PR for this head branch as { url, number }, or null (also null when gh is unavailable). */
export function findOpenPr(head) {
  try {
    return parseOpenPr(
      execFileSync('gh', ['pr', 'list', '--head', head, '--state', 'open', '--json', 'url,number'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    );
  } catch {
    return null;
  }
}

/** Replaces an existing PR's title and description. Throws with gh's message on failure. */
export function updatePullRequest({ number, title, body }) {
  try {
    execFileSync('gh', buildPrEditArgs({ number, title }), { input: body, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    throw new Error((err.stderr ? err.stderr.toString().trim() : '') || err.message);
  }
}

/** Creates the PR and returns its URL. Throws with gh's message on failure. */
export function createPullRequest({ base, head, title, body, draft = false }) {
  try {
    return execFileSync('gh', buildPrCreateArgs({ base, head, title, draft }), {
      input: body,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    throw new Error((err.stderr ? err.stderr.toString().trim() : '') || err.message);
  }
}
