import crypto from 'node:crypto';
import fs from 'node:fs';

const API = 'https://api.github.com';

const b64url = (input) => Buffer.from(input).toString('base64url');

/**
 * Signs the short-lived (9 min) RS256 JWT a GitHub App uses to authenticate as
 * itself. `appId` may be the App's numeric ID or its client ID.
 */
export function buildAppJwt({ appId, privateKeyPem, now = Math.floor(Date.now() / 1000) }) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(appId) }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKeyPem).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Reads and validates a GitHub App private key file; returns the PEM text or throws a friendly Error. */
export function loadPrivateKey(keyPath) {
  let pem;
  try {
    pem = fs.readFileSync(keyPath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read the GitHub App private key at "${keyPath}": ${err.code || err.message}`);
  }
  try {
    if (crypto.createPrivateKey(pem).asymmetricKeyType !== 'rsa') throw new Error('not RSA');
  } catch {
    throw new Error(`"${keyPath}" is not a valid RSA private key (.pem) for the GitHub App.`);
  }
  return pem;
}

/** { owner, repo } from an ssh/https GitHub remote URL, or null. */
export function parseGitHubRemote(url) {
  const m = String(url).trim().match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function githubApi(path, jwt, method = 'GET') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'commitsmith',
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${method} ${path}: ${data.message || res.statusText}`);
  return data;
}

/**
 * Token the `gh` calls should run as when opening a PR "as a bot":
 *  1. `bot.token` (COMMITSMITH_GH_TOKEN) — e.g. a fine-grained PAT of a bot account — used as is; else
 *  2. a GitHub App: sign a JWT with the App's private key and exchange it for a
 *     short-lived installation token (about 1 hour), looked up for this repo
 *     unless an installation ID is given.
 * The token lives only in memory — it is never written to disk, logged, or put on a command line.
 */
export async function resolveBotToken({ bot, remoteUrl }) {
  if (bot.token) return bot.token;

  if (!bot.appId || !bot.keyPath) {
    throw new Error(
      '--as-bot needs credentials: set COMMITSMITH_GH_TOKEN (a bot account token), or a GitHub App via ' +
        'COMMITSMITH_GH_APP_ID + COMMITSMITH_GH_APP_KEY_PATH (path to its .pem private key; ' +
        'COMMITSMITH_GH_APP_INSTALLATION_ID is optional).'
    );
  }

  const jwt = buildAppJwt({ appId: bot.appId, privateKeyPem: loadPrivateKey(bot.keyPath) });

  let installationId = bot.installationId;
  if (!installationId) {
    const repo = parseGitHubRemote(remoteUrl ?? '');
    if (!repo) throw new Error('Could not read the GitHub owner/repo from the origin remote; set COMMITSMITH_GH_APP_INSTALLATION_ID.');
    installationId = (await githubApi(`/repos/${repo.owner}/${repo.repo}/installation`, jwt)).id;
  }

  const { token } = await githubApi(`/app/installations/${installationId}/access_tokens`, jwt, 'POST');
  if (!token) throw new Error('GitHub did not return an installation token.');
  return token;
}

/**
 * Checks a GitHub App setup without creating anything: the ID and key must
 * authenticate (GET /app), and — when run inside a GitHub repo — the App
 * should be installed on it. Returns { appName, appSlug, repo, installationId,
 * installedOnRepo } (installedOnRepo is null when there is no repo to check).
 * Throws with GitHub's message when the ID/key pair is rejected.
 */
export async function verifyBotSetup({ bot, remoteUrl }) {
  const jwt = buildAppJwt({ appId: bot.appId, privateKeyPem: loadPrivateKey(bot.keyPath) });
  const app = await githubApi('/app', jwt);

  const repo = parseGitHubRemote(remoteUrl ?? '');
  let installationId = bot.installationId || null;
  let installedOnRepo = null;
  if (!installationId && repo) {
    try {
      installationId = (await githubApi(`/repos/${repo.owner}/${repo.repo}/installation`, jwt)).id;
      installedOnRepo = true;
    } catch {
      installedOnRepo = false;
    }
  }
  return { appName: app.name, appSlug: app.slug, repo, installationId, installedOnRepo };
}
