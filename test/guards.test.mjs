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
  compareVersions,
  sortVersionTags,
  buildReleaseRanges,
  renderChangelog,
  mergeChangelogSections,
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
  assert.equal(bumpVersion('nope', 'patch'), null);
  assert.equal(bumpVersion('v1.2.3', 'minor'), '1.3.0'); // a leading v is accepted
  assert.deepEqual(parseVersionTag('v1.4.0'), { prefix: 'v', version: '1.4.0' });
  assert.deepEqual(parseVersionTag('1.4.0'), { prefix: '', version: '1.4.0' });
  assert.equal(parseVersionTag('release-1'), null);
  assert.equal(parseVersionTag('1.2'), null); // not a full semantic version
  assert.equal(parseVersionTag('1.2.3.4'), null);
});

test('prereleases follow semver: they graduate on bump, and sort below their release', () => {
  assert.equal(bumpVersion('1.2.3-beta.1', 'patch'), '1.2.3'); // semver.inc graduates the prerelease
  assert.equal(bumpVersion('2.0.0-rc.1', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.2.3-beta.1', 'minor'), '1.3.0');
  assert.deepEqual(parseVersionTag('v1.0.0-beta.2'), { prefix: 'v', version: '1.0.0-beta.2' });
  assert.ok(compareVersions('1.0.0-beta.1', '1.0.0') < 0);
  assert.ok(compareVersions('1.0.0-beta.2', '1.0.0-beta.10') < 0); // numeric prerelease ids, not string order
  assert.deepEqual(
    sortVersionTags(['1.0.0', '1.0.0-rc.1', '1.0.0-beta.2', '0.9.0'].map((tag) => ({ tag, date: 'd' }))).map((t) => t.tag),
    ['1.0.0', '1.0.0-rc.1', '1.0.0-beta.2', '0.9.0']
  );
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

test('compareVersions / sortVersionTags: numeric order, semver tags only, one per version', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('1.0.4', '1.0.10') < 0);
  assert.equal(compareVersions('2.0.0', '2.0.0'), 0);
  const sorted = sortVersionTags([
    { tag: '1.0.2', date: 'd' },
    { tag: 'v1.0.2', date: 'dup' },
    { tag: 'nightly', date: 'x' },
    { tag: '1.10.0', date: 'd' },
    { tag: '1.0.10', date: 'd' },
  ]);
  assert.deepEqual(sorted.map((t) => t.tag), ['1.10.0', '1.0.10', '1.0.2']);
});

test('buildReleaseRanges: each tag runs from the next older tag; the oldest from --from or the start', () => {
  const tags = [{ tag: '1.2.0' }, { tag: '1.1.0' }, { tag: '1.0.0' }];
  assert.deepEqual(buildReleaseRanges(tags).map((r) => [r.tag, r.base]), [['1.2.0', '1.1.0'], ['1.1.0', '1.0.0'], ['1.0.0', null]]);
  assert.equal(buildReleaseRanges(tags, 'abc123').at(-1).base, 'abc123');
  assert.deepEqual(buildReleaseRanges([]), []);
});

const sec = (version, body, unreleased = false) => ({
  version,
  unreleased,
  markdown: version ? '## [' + version + '] - 2026-01-01\n\n' + body : '## [Unreleased]\n\n' + body,
});

test('renderChangelog / mergeChangelogSections: a new file gets the title, Unreleased first, releases newest to oldest', () => {
  const sections = [sec(null, '- u', true), sec('1.1.0', '- b'), sec('1.0.0', '- a')];
  const created = mergeChangelogSections('', sections);
  assert.equal(created, renderChangelog(sections));
  assert.match(created, /^# Changelog\n\nAll notable changes[^\n]*\n\n## \[Unreleased\]\n\n- u\n\n## \[1\.1\.0\][^\n]*\n\n- b\n\n## \[1\.0\.0\]/);
});

test('mergeChangelogSections: refreshes Unreleased, keeps written releases, inserts missing ones in order', () => {
  const existing = [
    '# Changelog',
    '',
    'Hand-written intro.',
    '',
    '## [Unreleased]',
    '',
    '- old unreleased',
    '',
    '## [1.2.0] - 2026-03-01',
    '',
    '- hand edited 1.2.0',
    '',
    '## [1.0.0] - 2026-01-01',
    '',
    '- hand edited 1.0.0',
    '',
  ].join('\n');
  const merged = mergeChangelogSections(existing, [sec(null, '- new unreleased', true), sec('1.2.0', '- regenerated'), sec('1.1.0', '- fresh 1.1.0'), sec('1.0.0', '- regenerated')]);

  assert.match(merged, /Hand-written intro\./);
  assert.match(merged, /- new unreleased/);
  assert.doesNotMatch(merged, /old unreleased/);
  assert.match(merged, /hand edited 1\.2\.0/); // untouched
  assert.match(merged, /hand edited 1\.0\.0/);
  assert.doesNotMatch(merged, /regenerated/);
  const order = ['[Unreleased]', '[1.2.0]', '[1.1.0]', '[1.0.0]'].map((h) => merged.indexOf(h));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(order.every((i) => i >= 0));
});

test('mergeChangelogSections: a labelled release replaces [Unreleased]; new releases go on top; CRLF is kept', () => {
  const existing = '# Changelog\n\n## [Unreleased]\n\n- pending\n\n## [1.0.0] - 2026-01-01\n\n- a\n';
  const merged = mergeChangelogSections(existing, [sec('1.1.0', '- released now', true)]);
  assert.doesNotMatch(merged, /Unreleased/);
  assert.ok(merged.indexOf('[1.1.0]') < merged.indexOf('[1.0.0]'));
  assert.match(merged, /- a/);

  const crlf = mergeChangelogSections(existing.replace(/\n/g, '\r\n'), [sec(null, '- u', true)]);
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
