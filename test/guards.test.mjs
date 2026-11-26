import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanLine, scanDiff, redactText, isSensitivePath, looksLikeRealSecret, guardPrompt } from '../src/secret-guard.mjs';
import {
  parseCommitHeader,
  isBreakingCommit,
  classifyCommit,
  computeBump,
  bumpVersion,
  parseVersionTag,
  formatChangelogSection,
  insertChangelogSection,
  lintCommitMessage,
} from '../src/conventional.mjs';
import { setPackageVersion, readPackageVersion } from '../src/modes/bump.mjs';
import { installHooks, uninstallHooks, hookStatus, hookNames, HOOK_MARKER } from '../src/modes/hook.mjs';

// Test secrets are assembled at runtime so this file itself never contains a real-looking token.
const AWS = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const GH = ['gh', 'p_', 'a'.repeat(36)].join('');
const OPENAI = ['sk', '-', 'b'.repeat(40)].join('');

// ---------------------------------------------------------------------------
// secret guard
// ---------------------------------------------------------------------------

test('scanLine finds known token formats without echoing the full secret', () => {
  const hits = scanLine(`key = ${AWS} and ${GH}`);
  assert.deepEqual(hits.map((h) => h.type).sort(), ['AWS access key', 'GitHub token']);
  for (const h of hits) assert.ok(!h.sample.includes(AWS) && !h.sample.includes(GH));
});

test('credential assignments: flags real-looking values, ignores placeholders', () => {
  assert.equal(scanLine('password: "hunter22secret"').length, 1);
  assert.equal(scanLine("api_key = 'abc12345xyz'").length, 1);
  assert.equal(scanLine('password: "your_password_here"').length, 0);
  assert.equal(scanLine('password: "xxxxxxxx"').length, 0);
  assert.equal(scanLine('token = "${process.env.TOKEN}"').length, 0);
  assert.equal(looksLikeRealSecret('<token>'), false);
  assert.equal(looksLikeRealSecret('changeme123'), false);
});

test('isSensitivePath: env files, key stores and ssh keys — but not templates or source', () => {
  for (const p of ['.env', 'config/.env.production', 'server.pem', 'a/b/id_rsa', 'store.p12', 'x.key']) {
    assert.equal(isSensitivePath(p), true, p);
  }
  for (const p of ['.env.example', '.env.sample', 'src/env.mjs', 'README.md', 'keyboard.js']) {
    assert.equal(isSensitivePath(p), false, p);
  }
});

const DIFF = [
  'diff --git a/src/a.js b/src/a.js',
  '--- a/src/a.js',
  '+++ b/src/a.js',
  '@@ -1,2 +1,3 @@',
  ' const x = 1;',
  `+const k = "${AWS}";`,
  ' const y = 2;',
  'diff --git a/.env b/.env',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/.env',
  '@@ -0,0 +1 @@',
  '+FOO=bar',
].join('\n');

test('scanDiff reports file and new-file line numbers, plus whole sensitive files', () => {
  const findings = scanDiff(DIFF);
  assert.deepEqual(
    findings.map((f) => [f.file, f.line, f.type]),
    [
      ['src/a.js', 2, 'AWS access key'],
      ['.env', 0, 'sensitive file'],
    ]
  );
});

test('redactText replaces secrets, omits sensitive files, and keeps the rest', () => {
  const { text, findings } = redactText(`Instructions here.\n${DIFF}`);
  assert.ok(!text.includes(AWS));
  assert.match(text, /\[REDACTED:AWS access key\]/);
  assert.match(text, /\[contents of sensitive file omitted\]/);
  assert.ok(!text.includes('FOO=bar'));
  assert.match(text, /^Instructions here\./);
  assert.deepEqual(findings.map((f) => f.type).sort(), ['AWS access key', 'sensitive file']);
});

test('redactText handles multi-line private key blocks and credential values', () => {
  const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----';
  const out = redactText(`before\n${key}\nafter password: "hunter22secret"`);
  assert.ok(!out.text.includes('MIIBOg'));
  assert.ok(!out.text.includes('hunter22secret'));
  assert.match(out.text, /^before\n\[REDACTED:private key\]\nafter password: "\[REDACTED:credential assignment\]"/);
});

test('guardPrompt: redact mode strips and returns findings, block mode throws, off mode is untouched', () => {
  const prompt = `hello ${OPENAI}`;
  const warn = console.error;
  console.error = () => {};
  try {
    const redacted = guardPrompt(prompt, 'redact');
    assert.ok(!redacted.prompt.includes(OPENAI));
    assert.equal(redacted.findings.length, 1);
  } finally {
    console.error = warn;
  }
  assert.throws(() => guardPrompt(prompt, 'block'), /Refusing to send/);
  assert.equal(guardPrompt(prompt, 'off').prompt, prompt);
  assert.equal(guardPrompt('nothing secret here', 'block').prompt, 'nothing secret here');
});

// ---------------------------------------------------------------------------
// conventional commits: parsing, bump, changelog, lint
// ---------------------------------------------------------------------------

test('parseCommitHeader handles emoji, scope, bang and plain headers', () => {
  assert.deepEqual(parseCommitHeader('✨ feat(cli): add --pr'), { emoji: '✨', type: 'feat', scope: 'cli', bang: false, description: 'add --pr' });
  assert.deepEqual(parseCommitHeader('fix!: drop old flag'), { emoji: '', type: 'fix', scope: '', bang: true, description: 'drop old flag' });
  assert.equal(parseCommitHeader('just some words'), null);
});

test('breaking detection: 💥 header, bang, or footer', () => {
  assert.equal(isBreakingCommit({ subject: '💥 feat: x' }), true);
  assert.equal(isBreakingCommit({ subject: 'feat!: x' }), true);
  assert.equal(isBreakingCommit({ subject: 'feat: x', body: 'BREAKING CHANGE: y' }), true);
  assert.equal(isBreakingCommit({ subject: 'feat: x', body: 'nothing' }), false);
  assert.equal(classifyCommit({ subject: 'wibble: x' }).type, 'other');
});

const c = (subject, body = '') => ({ sha: 'abcdef1234567', subject, body });

test('computeBump: major > minor > patch > none, with the driving commits', () => {
  assert.equal(computeBump([c('✨ feat: a'), c('🐛 fix: b')]).level, 'minor');
  assert.equal(computeBump([c('🐛 fix: b'), c('📝 docs: d')]).level, 'patch');
  assert.equal(computeBump([c('📝 docs: d'), c('✅ test: t'), c('👷 ci: c'), c('🔧 chore: x')]).level, 'none');
  const major = computeBump([c('✨ feat: a'), c('💥 feat: b', 'BREAKING CHANGE: gone')]);
  assert.equal(major.level, 'major');
  assert.deepEqual(major.reasons.map((r) => r.description), ['b']);
  assert.equal(computeBump([]).level, 'none');
});

test('bumpVersion / parseVersionTag', () => {
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'none'), '1.2.3');
  assert.equal(bumpVersion('1.2.3-beta.1', 'patch'), '1.2.4');
  assert.equal(bumpVersion('nope', 'patch'), null);
  assert.deepEqual(parseVersionTag('v1.4.0'), { prefix: 'v', version: '1.4.0' });
  assert.deepEqual(parseVersionTag('1.4.0'), { prefix: '', version: '1.4.0' });
  assert.equal(parseVersionTag('release-1'), null);
});

test('setPackageVersion changes only the top-level version and keeps formatting', () => {
  const text = '{\n  "name": "x",\n  "version": "1.0.4",\n  "dependencies": { "v": "1.0.4" }\n}\n';
  assert.equal(readPackageVersion(text), '1.0.4');
  assert.equal(setPackageVersion(text, '1.1.0'), '{\n  "name": "x",\n  "version": "1.1.0",\n  "dependencies": { "v": "1.0.4" }\n}\n');
  assert.equal(setPackageVersion('{"name":"x"}', '1.1.0'), null);
});

const COMMITS = [
  c('💥 feat(config): rename key', 'BREAKING CHANGE: old configs ignored'),
  c('✨ feat(cli): add --pr'),
  c('🐛 fix: crash on empty diff'),
  c('✅ test: more tests'),
  c('wibble without a type'),
];

test('formatChangelogSection: breaking first, grouped by type, noise hidden unless --all', () => {
  const md = formatChangelogSection({ version: '2.0.0', date: '2026-11-26', commits: COMMITS });
  assert.match(md, /^## \[2\.0\.0\] - 2026-11-26\n\n### ⚠️ BREAKING CHANGES\n\n- \*\*config:\*\* rename key — old configs ignored/);
  assert.match(md, /### ✨ Features\n\n- \*\*config:\*\* rename key \(abcdef1\)\n- \*\*cli:\*\* add --pr \(abcdef1\)/);
  assert.match(md, /### 🐛 Bug fixes\n\n- crash on empty diff/);
  assert.match(md, /### Other changes\n\n- wibble without a type/);
  assert.doesNotMatch(md, /Tests/);
  assert.match(formatChangelogSection({ version: '2.0.0', date: 'd', commits: COMMITS, all: true }), /### ✅ Tests/);
  assert.match(formatChangelogSection({ version: null, date: 'd', commits: [] }), /^## \[Unreleased\]\n\n_No notable changes\._$/);
});

test('insertChangelogSection: creates, prepends above the newest release, replaces the same version, keeps CRLF', () => {
  const sec1 = '## [1.1.0] - 2026-02-01\n\n### ✨ Features\n\n- a';
  const created = insertChangelogSection('', sec1);
  assert.match(created, /^# Changelog\n\nAll notable changes[^\n]*\n\n## \[1\.1\.0\]/);

  const sec2 = '## [1.2.0] - 2026-03-01\n\n- b';
  const prepended = insertChangelogSection(created, sec2);
  assert.ok(prepended.indexOf('[1.2.0]') < prepended.indexOf('[1.1.0]'));

  const replaced = insertChangelogSection(prepended, '## [1.2.0] - 2026-03-05\n\n- b2');
  assert.equal(replaced.match(/## \[1\.2\.0\]/g).length, 1);
  assert.match(replaced, /- b2/);
  assert.doesNotMatch(replaced, /- b\n/);
  assert.match(replaced, /## \[1\.1\.0\]/);

  const crlf = insertChangelogSection(created.replace(/\n/g, '\r\n'), sec2);
  assert.ok(crlf.includes('\r\n') && !/[^\r]\n/.test(crlf));
});

test('lintCommitMessage: accepts conventional messages, rejects the rest, skips git-generated ones', () => {
  assert.deepEqual(lintCommitMessage('✨ feat(cli): add --pr\n\n* body'), []);
  assert.deepEqual(lintCommitMessage('fix: plain works too'), []);
  assert.deepEqual(lintCommitMessage('Merge branch "x" into y'), []);
  assert.deepEqual(lintCommitMessage('# comment first\n🐛 fix: after comments'), []);
  assert.match(lintCommitMessage('updated stuff')[0], /must look like/);
  assert.match(lintCommitMessage('wibble: nope')[0], /Unknown type "wibble"/);
  assert.match(lintCommitMessage(`feat: ${'x'.repeat(80)}`)[0], /characters/);
  assert.match(lintCommitMessage('  \n# only comments')[0], /empty/);
});

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

test('hooks: install, update, protect foreign hooks, force with backup, status, uninstall with restore', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oco-hooks-'));
  try {
    const names = hookNames();
    assert.deepEqual(names, ['pre-commit', 'commit-msg']);
    assert.deepEqual(hookNames({ prePush: true }).at(-1), 'pre-push');

    assert.deepEqual(installHooks(dir, { names }).map((r) => r.status), ['installed', 'installed']);
    assert.deepEqual(installHooks(dir, { names }).map((r) => r.status), ['updated', 'updated']);
    assert.ok(fs.readFileSync(path.join(dir, 'pre-commit'), 'utf8').includes(HOOK_MARKER));
    assert.match(fs.readFileSync(path.join(dir, 'commit-msg'), 'utf8'), /--lint-message "\$1"/);

    // someone else's hook is never overwritten without --force
    fs.writeFileSync(path.join(dir, 'pre-push'), '#!/bin/sh\necho mine\n');
    const skipped = installHooks(dir, { names: ['pre-push'] })[0];
    assert.equal(skipped.status, 'skipped');
    assert.equal(fs.readFileSync(path.join(dir, 'pre-push'), 'utf8'), '#!/bin/sh\necho mine\n');

    assert.equal(installHooks(dir, { names: ['pre-push'], force: true })[0].status, 'replaced');
    assert.ok(fs.existsSync(path.join(dir, 'pre-push.commitsmith-backup')));
    assert.deepEqual(hookStatus(dir).map((s) => s.state), ['installed', 'installed', 'installed']);

    const removed = Object.fromEntries(uninstallHooks(dir).map((r) => [r.name, r.status]));
    assert.deepEqual(removed, { 'pre-commit': 'removed', 'commit-msg': 'removed', 'pre-push': 'restored' });
    assert.equal(fs.readFileSync(path.join(dir, 'pre-push'), 'utf8'), '#!/bin/sh\necho mine\n');
    assert.deepEqual(hookStatus(dir).map((s) => s.state), ['absent', 'absent', 'foreign']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
