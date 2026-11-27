import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as clack from '@clack/prompts';
import { GLOBAL_CONFIG_DIR, GLOBAL_CONFIG_PATH } from '../global-config.mjs';
import { loadPrivateKey, verifyBotSetup } from '../github-auth.mjs';
import { getRemoteUrl } from '../git.mjs';
import { cancelled } from '../wizard-ui.mjs';

/** Where `init github` keeps a copy of the App's private key when you choose to. */
export const MANAGED_KEY_PATH = path.join(GLOBAL_CONFIG_DIR, 'github-app.pem');

const SETUP_STEPS = [
  '1. Create the App (https://github.com/settings/apps/new — for an organization:',
  '   https://github.com/organizations/<org>/settings/apps/new)',
  '   • Name: anything, e.g. "<you>-commitsmith-bot"; Homepage URL: your repo URL',
  '   • Untick Webhook → Active',
  '   • Repository permissions: Pull requests → Read and write; Contents → Read-only',
  '     (Metadata: Read-only is added automatically)',
  '   • Where can this App be installed? → Only on this account',
  '2. On the App page choose "Generate a private key" — a .pem file downloads.',
  '   Keep it private; GitHub never shows it again.',
  '3. "Install App" (left menu) → your account → "Only select repositories" → this repo.',
  '4. Copy the App ID (or Client ID) from the App page.',
].join('\n');

/** Trims, strips the quotes a drag-and-drop adds, expands a leading ~, and resolves to an absolute path. */
export function normalizeUserPath(input) {
  let p = String(input ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

/**
 * Adds `patch` to a JSON config file, keeping every key already there (so
 * provider settings written by `init` survive). Throws if the file exists but
 * isn't a JSON object, rather than overwriting something unreadable.
 */
export function mergeConfigFile(file, patch) {
  let existing = {};
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      throw new Error(`${file} is not valid JSON — fix or remove it first; nothing was written.`);
    }
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      throw new Error(`${file} is not a JSON object — fix or remove it first; nothing was written.`);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ ...existing, ...patch }, null, 2)}\n`, 'utf8');
}

/**
 * Interactive setup for opening pull requests as a GitHub App ("bot"):
 * walks through creating the App, takes its ID and private-key file, verifies
 * them against GitHub, then saves the settings the same way `commitsmith init`
 * does — a project-local .commitsmithrc.json (shareable) or your global
 * config. The key *file path* is always kept in the global config (it's
 * machine-specific); the key itself is never written into any config — you
 * can leave it where it is or have a copy kept in commitsmith's config folder.
 */
export async function runInitGithubMode() {
  clack.intro('commitsmith init github — open pull requests as a GitHub App bot');
  clack.note(SETUP_STEPS, 'Setup steps');

  const ready = await clack.confirm({ message: 'Have the App ID and the private key (.pem) file ready?', initialValue: true });
  if (cancelled(ready)) return;
  if (!ready) {
    clack.outro('Follow the steps above, then run `commitsmith init github` again.');
    return;
  }

  const appId = await clack.text({
    message: 'App ID (or Client ID)',
    validate: (v) => (!v?.trim() ? 'Required' : undefined),
  });
  if (cancelled(appId)) return;

  const keyInput = await clack.text({
    message: 'Path to the private key (.pem) — you can drag the file in',
    validate: (v) => {
      try {
        loadPrivateKey(normalizeUserPath(v));
        return undefined;
      } catch (err) {
        return err.message;
      }
    },
  });
  if (cancelled(keyInput)) return;
  let keyPath = normalizeUserPath(keyInput);

  const installationInput = await clack.text({
    message: 'Installation ID (leave blank to detect it from the repo each time)',
    placeholder: 'blank = auto-detect',
    defaultValue: '',
  });
  if (cancelled(installationInput)) return;
  const installationId = installationInput.trim();

  // Verify before saving anything: the ID/key pair must authenticate.
  const spinner = clack.spinner();
  spinner.start('Checking the App with GitHub...');
  try {
    const info = await verifyBotSetup({
      bot: { appId: appId.trim(), keyPath, installationId },
      remoteUrl: getRemoteUrl('origin'),
    });
    spinner.stop(`Authenticated as the GitHub App "${info.appName}".`);
    if (info.repo && info.installedOnRepo === false) {
      clack.log.warn(
        `The App is not installed on ${info.repo.owner}/${info.repo.repo}. Install it from the App's "Install App" page, ` +
          'selecting this repository, or PRs will fail.'
      );
    } else if (info.repo && info.installedOnRepo) {
      clack.log.success(`Installed on ${info.repo.owner}/${info.repo.repo}.`);
    } else if (!info.repo) {
      clack.log.info('Not inside a GitHub repository, so the installation was not checked.');
    }
  } catch (err) {
    spinner.stop('Could not verify the App.');
    clack.log.warn(err.message);
    const save = await clack.confirm({ message: 'Save these settings anyway?', initialValue: false });
    if (cancelled(save)) return;
    if (!save) {
      clack.outro('Nothing was written.');
      return;
    }
  }

  const keyStorage = await clack.select({
    message: 'Where should the private key live?',
    options: [
      { value: 'copy', label: "Copy it into commitsmith's config folder (recommended)", hint: MANAGED_KEY_PATH },
      { value: 'keep', label: 'Leave it where it is', hint: keyPath },
    ],
    initialValue: 'copy',
  });
  if (cancelled(keyStorage)) return;

  if (keyStorage === 'copy' && keyPath !== MANAGED_KEY_PATH) {
    let doCopy = true;
    if (fs.existsSync(MANAGED_KEY_PATH)) {
      const overwrite = await clack.confirm({ message: `${MANAGED_KEY_PATH} already exists. Overwrite it?`, initialValue: false });
      if (cancelled(overwrite)) return;
      doCopy = overwrite;
    }
    if (doCopy) {
      fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
      fs.copyFileSync(keyPath, MANAGED_KEY_PATH);
      try {
        fs.chmodSync(MANAGED_KEY_PATH, 0o600);
      } catch {
        // best-effort — Windows doesn't honor POSIX mode bits the same way
      }
      keyPath = MANAGED_KEY_PATH;
    }
  }

  const asDefault = await clack.confirm({
    message: 'Open pull requests as the bot by default? (otherwise pass --as-bot)',
    initialValue: false,
  });
  if (cancelled(asDefault)) return;

  const scope = await clack.select({
    message: 'Where should the App ID and defaults be saved?',
    options: [
      { value: 'global', label: 'Your user profile (global)', hint: `${GLOBAL_CONFIG_PATH}` },
      { value: 'project', label: 'This project only', hint: './.commitsmithrc.json — no key path or secrets, safe to commit' },
    ],
    initialValue: 'global',
  });
  if (cancelled(scope)) return;

  const shared = { githubAppId: appId.trim(), prAsBot: asDefault, ...(installationId ? { githubAppInstallationId: installationId } : {}) };
  const projectPath = path.join(process.cwd(), '.commitsmithrc.json');

  try {
    // The key path is machine-specific, so it always goes to the global config.
    mergeConfigFile(GLOBAL_CONFIG_PATH, { githubAppKeyPath: keyPath, ...(scope === 'global' ? shared : {}) });
    if (scope === 'project') mergeConfigFile(projectPath, shared);
  } catch (err) {
    clack.cancel(err.message);
    return;
  }

  const notes = [
    `Key file:  ${keyPath}`,
    `Global:    ${GLOBAL_CONFIG_PATH}`,
    ...(scope === 'project' ? [`Project:   ${path.relative(process.cwd(), projectPath)} (App ID and defaults only)`] : []),
    '',
    asDefault ? 'Open a PR as the bot:  commitsmith --pr --create' : 'Open a PR as the bot:  commitsmith --pr --create --as-bot',
    '',
    keyStorage === 'copy' && keyPath === MANAGED_KEY_PATH
      ? 'A copy of the key is kept in the config folder; you can delete or move the original download.'
      : 'Keep the key file private; commitsmith only stores its path.',
  ];
  clack.note(notes.join('\n'), 'Done');
  clack.outro('Environment variables (COMMITSMITH_GH_APP_*) still override these settings.');
}
