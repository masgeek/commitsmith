import { execFileSync } from 'node:child_process';
import chalk from 'chalk';
import { loadConfig } from '../config.mjs';
import { probeProvider } from '../providers/index.mjs';
import { listModelsFor } from '../providers/list-models.mjs';
import { checkGh } from '../github.mjs';
import { loadPrivateKey, verifyBotSetup } from '../github-auth.mjs';
import { getCurrentBranch, getHooksDir, getRemoteUrl } from '../git.mjs';
import { extractTicket } from '../tickets.mjs';
import { hookStatus } from './hook.mjs';

/** A check result: status is ok | warn | fail | skip. */
const result = (status, label, detail = '') => ({ status, label, detail });

/** Node must be at least 18 (the `engines` field of package.json). */
export function checkNodeVersion(version = process.versions.node) {
  const major = Number(String(version).split('.')[0]);
  return major >= 18
    ? result('ok', 'Node.js', `v${version}`)
    : result('fail', 'Node.js', `v${version} is too old — commitsmith needs Node 18 or newer.`);
}

/** Counts by status and the exit code: 1 when anything failed. */
export function summarizeChecks(checks) {
  const count = (s) => checks.filter((c) => c.status === s).length;
  return { ok: count('ok'), warn: count('warn'), fail: count('fail'), skip: count('skip'), exitCode: count('fail') > 0 ? 1 : 0 };
}

const ICON = { ok: chalk.green('✔'), warn: chalk.yellow('⚠'), fail: chalk.red('✖'), skip: chalk.dim('–') };

function onPath(command) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function providerChecks(config) {
  const checks = [];
  const { PROVIDER, MODEL, HOST, API_KEY, fileConfigPath } = config;
  checks.push(
    result('ok', 'Provider', `${PROVIDER} · ${MODEL} · ${HOST}`),
    fileConfigPath ? result('ok', 'Config file', fileConfigPath) : result('warn', 'Config file', 'none found — using env vars and defaults (run `commitsmith init`).')
  );

  if (PROVIDER !== 'ollama') {
    checks.push(API_KEY ? result('ok', 'API key', 'found (env, config file or keychain)') : result('fail', 'API key', `missing for ${PROVIDER} — set COMMITSMITH_API_KEY or run \`commitsmith init\`.`));
  }

  const probe = await probeProvider();
  checks.push(probe.ok ? result('ok', 'Provider reachable') : result('fail', 'Provider reachable', probe.message.split('\n')[0]));

  if (probe.ok) {
    try {
      const models = await listModelsFor(PROVIDER, HOST, API_KEY);
      checks.push(
        models.includes(MODEL)
          ? result('ok', 'Model available', MODEL)
          : result('warn', 'Model available', `"${MODEL}" is not in the provider's model list (${models.length} models) — check COMMITSMITH_MODEL or run \`commitsmith use\`.`)
      );
    } catch (err) {
      checks.push(result('skip', 'Model available', `could not list models (${err.message})`));
    }
  }
  return checks;
}

async function githubChecks(config) {
  const checks = [];
  const gh = checkGh();
  checks.push(gh.ok ? result('ok', 'GitHub CLI (gh)', 'installed and logged in') : result('warn', 'GitHub CLI (gh)', `${gh.reason} (only needed for --pr)`));

  const bot = config.GITHUB_BOT;
  if (bot.token) {
    checks.push(result('ok', 'PR bot', 'COMMITSMITH_GH_TOKEN is set'));
  } else if (bot.appId || bot.keyPath) {
    try {
      loadPrivateKey(bot.keyPath);
      const info = await verifyBotSetup({ bot, remoteUrl: getRemoteUrl('origin') });
      checks.push(
        info.installedOnRepo === false
          ? result('warn', 'PR bot (GitHub App)', `"${info.appName}" authenticates but is not installed on ${info.repo.owner}/${info.repo.repo}.`)
          : result('ok', 'PR bot (GitHub App)', `"${info.appName}"${info.repo && info.installedOnRepo ? ` installed on ${info.repo.owner}/${info.repo.repo}` : ''}`)
      );
    } catch (err) {
      checks.push(result('fail', 'PR bot (GitHub App)', err.message));
    }
  } else {
    checks.push(result('skip', 'PR bot', 'not configured (`commitsmith init github`)'));
  }
  return checks;
}

function projectChecks(config) {
  const checks = [];
  checks.push(result('ok', 'Secret guard', config.SECRET_GUARD));

  if (config.RULE_WARNINGS.length > 0) {
    config.RULE_WARNINGS.forEach((w) => checks.push(result('warn', 'Commit rules', w)));
  } else {
    const r = config.RULES;
    const parts = [
      r.scopes.length ? `scopes: ${r.scopes.join(', ')}` : null,
      r.requireScope ? 'scope required' : null,
      r.allowedTypes.length ? `types: ${r.allowedTypes.join(', ')}` : null,
      r.maxSubjectLength !== 72 ? `max ${r.maxSubjectLength} chars` : null,
      r.gitmoji === false ? 'no gitmoji' : null,
    ].filter(Boolean);
    checks.push(result('ok', 'Commit rules', parts.length ? parts.join(' · ') : 'defaults'));
  }

  const branch = getCurrentBranch();
  if (branch === null) {
    checks.push(result('skip', 'Git repository', 'not inside a repository (or detached HEAD)'));
  } else {
    checks.push(result('ok', 'Git branch', branch));
    const ticket = config.TICKETS.enabled ? extractTicket(branch, config.TICKETS) : null;
    checks.push(
      config.TICKETS.enabled
        ? ticket
          ? result('ok', 'Ticket link', `${ticket} → "${config.TICKETS.footer}: ${ticket}" is added to commits and PRs`)
          : result('skip', 'Ticket link', 'no ticket in this branch name')
        : result('skip', 'Ticket link', 'disabled (ticketLinks: false)')
    );
    try {
      const hooks = hookStatus(getHooksDir());
      const installed = hooks.filter((h) => h.state === 'installed').map((h) => h.name);
      const outdated = hooks.filter((h) => h.state === 'outdated').map((h) => h.name);
      checks.push(
        outdated.length
          ? result('warn', 'Git hooks', `outdated: ${outdated.join(', ')} — run \`commitsmith hook install\` to refresh`)
          : installed.length
            ? result('ok', 'Git hooks', installed.join(', '))
            : result('skip', 'Git hooks', 'none installed (`commitsmith hook install`)')
      );
    } catch {
      checks.push(result('skip', 'Git hooks', 'could not inspect'));
    }
  }

  checks.push(
    onPath('commitsmith')
      ? result('ok', '`commitsmith` on PATH')
      : result('warn', '`commitsmith` on PATH', 'not found — git hooks do nothing without it (install globally: pnpm add -g @masgeek/commitsmith)')
  );
  return checks;
}

/** `commitsmith doctor`: checks the whole setup and prints what is fine, what needs attention, and what is broken. */
export async function runDoctorMode() {
  console.log(chalk.bold('commitsmith doctor\n'));
  const config = await loadConfig();

  const checks = [checkNodeVersion(), ...(await providerChecks(config)), ...(await githubChecks(config)), ...projectChecks(config)];
  for (const c of checks) {
    console.log(`${ICON[c.status]} ${c.label}${c.detail ? chalk.dim(` — ${c.detail}`) : ''}`);
  }

  const s = summarizeChecks(checks);
  console.log(`\n${s.ok} ok, ${s.warn} warning(s), ${s.fail} problem(s)${s.skip ? `, ${s.skip} not applicable` : ''}.`);
  process.exitCode = s.exitCode;
}
