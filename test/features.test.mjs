import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRules, ruleLines, DEFAULT_RULES } from '../src/rules.mjs';
import { extractTicket, appendFooter, withTicketFooter } from '../src/tickets.mjs';
import {
  formatCommitMessage,
  retypeMessage,
  isBreakingMessage,
  parseGroupingResult,
  formatPullRequestBody,
  parseReviewResult,
  mergeReviewResults,
  exceedsSeverity,
} from '../src/parsing.mjs';
import { lintCommitMessage } from '../src/conventional.mjs';
import { findCommitIssues } from '../src/modes/check.mjs';
import { checkNodeVersion, summarizeChecks } from '../src/modes/doctor.mjs';
import { buildPrompt, buildGroupingPrompt, buildReviewPrompt } from '../src/prompts.mjs';

// ---------------------------------------------------------------------------
// commit rules
// ---------------------------------------------------------------------------

test('normalizeRules: defaults, valid values, and warnings for bad ones', () => {
  assert.deepEqual(normalizeRules(undefined), { rules: { ...DEFAULT_RULES, scopes: [], allowedTypes: [] }, warnings: [] });

  const ok = normalizeRules({ scopes: ['CLI ', 'api'], requireScope: true, maxSubjectLength: 60, allowedTypes: ['feat', 'FIX'], gitmoji: false });
  assert.deepEqual(ok.rules, { scopes: ['cli', 'api'], requireScope: true, maxSubjectLength: 60, allowedTypes: ['feat', 'fix'], gitmoji: false });
  assert.deepEqual(ok.warnings, []);

  const bad = normalizeRules({ scopes: 'cli', requireScope: 'yes', maxSubjectLength: 5, allowedTypes: ['feat', 'wibble'], gitmoji: 'no' });
  assert.equal(bad.rules.maxSubjectLength, 72);
  assert.deepEqual(bad.rules.allowedTypes, ['feat']);
  assert.equal(bad.rules.requireScope, false);
  assert.equal(bad.warnings.length, 5);
  assert.match(normalizeRules([]).warnings[0], /must be an object/);
});

test('ruleLines tells the model about scopes, types and length only when set', () => {
  assert.deepEqual(ruleLines(null), []);
  assert.deepEqual(ruleLines(DEFAULT_RULES), []);
  const lines = ruleLines({ scopes: ['cli', 'api'], requireScope: true, allowedTypes: ['feat', 'fix'], maxSubjectLength: 50 });
  assert.ok(lines.some((l) => /one of: feat, fix/.test(l)));
  assert.ok(lines.some((l) => /one of: cli, api/.test(l)));
  assert.ok(lines.some((l) => /at most 50/.test(l)));
  assert.match(buildPrompt('DIFF', '', { scopes: ['cli'], requireScope: false, allowedTypes: [], maxSubjectLength: 72 }), /one of: cli/);
  assert.match(buildGroupingPrompt([{ path: 'a', diff: 'd' }], { scopes: ['cli'], requireScope: false, allowedTypes: [], maxSubjectLength: 72 }), /one of: cli/);
  assert.doesNotMatch(buildPrompt('DIFF'), /must be one of/);
});

test('formatCommitMessage applies rules: scope dropped, type fallback, gitmoji off, breaking as "!"', () => {
  const base = { type: 'feat', scope: 'Other', subject: 'add thing' };
  assert.equal(formatCommitMessage(base, true, { scopes: ['cli'] }).message, '✨ feat: add thing');
  assert.equal(formatCommitMessage({ ...base, scope: 'CLI' }, true, { scopes: ['cli'] }).message, '✨ feat(CLI): add thing');
  assert.equal(formatCommitMessage({ ...base, type: 'docs' }, true, { allowedTypes: ['feat', 'chore'] }).message, '🔧 chore(Other): add thing');
  assert.equal(formatCommitMessage(base, true, { gitmoji: false }).message, 'feat(Other): add thing');
  const breaking = formatCommitMessage({ ...base, breaking: true, breakingReason: 'gone' }, true, { gitmoji: false });
  assert.equal(breaking.message, 'feat(Other)!: add thing\n\nBREAKING CHANGE: gone');
  assert.equal(breaking.breaking, true);
});

test('retypeMessage and isBreakingMessage work without a leading emoji', () => {
  assert.equal(isBreakingMessage('feat!: x'), true);
  assert.equal(isBreakingMessage('feat: x\n\nBREAKING CHANGE: y'), true);
  assert.equal(isBreakingMessage('feat: x'), false);
  assert.equal(retypeMessage('feat(api): add x', { type: 'fix' }), 'fix(api): add x');
  assert.equal(retypeMessage('feat: add x', { breaking: true, breakingReason: 'r' }), 'feat!: add x\n\nBREAKING CHANGE: r');
  assert.equal(retypeMessage('feat!: add x\n\nBREAKING CHANGE: r', { breaking: false }), 'feat: add x');
});

test('retypeMessage keeps other footers (Refs) when the breaking footer is removed', () => {
  const msg = '💥 feat: add x\n\n* a\n\nBREAKING CHANGE: r\nRefs: ABC-1';
  assert.equal(retypeMessage(msg, { breaking: false }), '✨ feat: add x\n\n* a\n\nRefs: ABC-1');
});

test('lintCommitMessage enforces project rules', () => {
  const rules = { scopes: ['cli', 'api'], requireScope: true, allowedTypes: ['feat', 'fix'], maxSubjectLength: 40 };
  assert.deepEqual(lintCommitMessage('✨ feat(cli): add thing', rules), []);
  assert.match(lintCommitMessage('✨ feat: add thing', rules)[0], /scope is required/);
  assert.match(lintCommitMessage('✨ feat(db): add thing', rules)[0], /Scope "db" is not allowed/);
  assert.match(lintCommitMessage('📝 docs(cli): words', rules)[0], /Type "docs" is not allowed/);
  assert.match(lintCommitMessage(`feat(cli): ${'x'.repeat(40)}`, rules).join(' '), /under 40/);
  assert.deepEqual(lintCommitMessage('✨ feat: no rules means no scope needed'), []);
});

test('parseGroupingResult leftover message follows the gitmoji rule', () => {
  const raw = JSON.stringify({ groups: [{ files: ['a.js'], type: 'feat', subject: 'x' }] });
  assert.equal(parseGroupingResult(raw, ['a.js', 'b.js'], true, {})[1].message, '🔧 chore: update b.js');
  assert.equal(parseGroupingResult(raw, ['a.js', 'b.js'], true, { gitmoji: false })[1].message, 'chore: update b.js');
});

test('findCommitIssues understands "!" and footers as breaking flags', () => {
  assert.deepEqual(findCommitIssues('feat!: x', { breaking: true, type: 'feat' }), []);
  assert.deepEqual(findCommitIssues('feat: x\n\nBREAKING CHANGE: y', { breaking: true, type: 'feat' }), []);
  assert.equal(findCommitIssues('feat: x', { breaking: true, type: 'feat' }).length, 1);
});

// ---------------------------------------------------------------------------
// ticket links
// ---------------------------------------------------------------------------

test('extractTicket: Jira keys, numeric issues, custom patterns, and no false positives', () => {
  assert.equal(extractTicket('feature/ABC-123-login'), 'ABC-123');
  assert.equal(extractTicket('ABC-9'), 'ABC-9');
  assert.equal(extractTicket('feat/123-login'), '#123');
  assert.equal(extractTicket('issue-45'), '#45');
  assert.equal(extractTicket('gh-7/fix'), '#7');
  assert.equal(extractTicket('feat/login-2'), null);
  assert.equal(extractTicket('main'), null);
  assert.equal(extractTicket(null), null);
  assert.equal(extractTicket('team/PROJ_88_x', { pattern: 'PROJ_(\\d+)' }), '88');
  assert.equal(extractTicket('team/x', { pattern: '(' }), null); // invalid regex never throws
});

test('appendFooter joins an existing footer block; withTicketFooter adds Refs once', () => {
  assert.equal(appendFooter('feat: x', 'Refs: A-1'), 'feat: x\n\nRefs: A-1');
  assert.equal(appendFooter('feat: x\n\n* a', 'Refs: A-1'), 'feat: x\n\n* a\n\nRefs: A-1');
  assert.equal(appendFooter('feat: x\n\n* a\n\nBREAKING CHANGE: y', 'Refs: A-1'), 'feat: x\n\n* a\n\nBREAKING CHANGE: y\nRefs: A-1');

  assert.equal(withTicketFooter('feat: x', 'ABC-1'), 'feat: x\n\nRefs: ABC-1');
  assert.equal(withTicketFooter('feat: x', 'ABC-1', 'Closes'), 'feat: x\n\nCloses: ABC-1');
  assert.equal(withTicketFooter('feat: x\n\nRefs: ABC-1', 'ABC-1'), 'feat: x\n\nRefs: ABC-1'); // already there
  assert.equal(withTicketFooter('feat: fixes ABC-1 bug', 'ABC-1'), 'feat: fixes ABC-1 bug');
  assert.equal(withTicketFooter('feat: x', 'ABC-1xx'.slice(0, 5)), 'feat: x\n\nRefs: ABC-1');
  assert.equal(withTicketFooter('feat: x', '#12'), 'feat: x\n\nRefs: #12');
  assert.equal(withTicketFooter('feat: x', '#1'), 'feat: x\n\nRefs: #1');
  assert.equal(withTicketFooter('feat: x', null), 'feat: x');
  assert.equal(withTicketFooter('feat: x #123 y', '#12'), 'feat: x #123 y\n\nRefs: #12'); // #123 is not #12
});

test('formatPullRequestBody appends the ticket footer last', () => {
  const body = formatPullRequestBody({ summary: ['a'], testPlan: ['t'], breaking: [], footer: 'Refs: ABC-1' });
  assert.match(body, /- \[ \] t\n\nRefs: ABC-1$/);
});

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

test('parseReviewResult sorts by severity, normalizes fields and drops untitled findings', () => {
  const raw = JSON.stringify({
    summary: 'Adds X.',
    findings: [
      { severity: 'low', file: 'a.js', line: 3, title: 'nit', detail: 'd' },
      { severity: 'HIGH', file: 'b.js', line: 7.5, title: 'bug', detail: 'd', suggestion: 's' },
      { severity: 'weird', title: 'unknown severity' },
      { severity: 'high' },
    ],
    missingTests: ['edge case', ' '],
  });
  const r = parseReviewResult(raw);
  assert.deepEqual(r.findings.map((f) => [f.severity, f.title]), [['high', 'bug'], ['low', 'nit'], ['low', 'unknown severity']]);
  assert.equal(r.findings[0].line, 0);
  assert.equal(r.findings[1].line, 3);
  assert.deepEqual(r.missingTests, ['edge case']);
  assert.equal(parseReviewResult('no json'), null);
});

test('mergeReviewResults dedupes; exceedsSeverity gates by level', () => {
  const f = (severity, title) => ({ severity, file: 'a', line: 1, title, detail: '', suggestion: '' });
  const merged = mergeReviewResults([
    { summary: 'one', findings: [f('low', 'x'), f('high', 'y')], missingTests: ['t'] },
    { summary: 'two', findings: [f('low', 'x')], missingTests: ['t', 'u'] },
  ]);
  assert.equal(merged.findings.length, 2);
  assert.equal(merged.findings[0].severity, 'high');
  assert.equal(merged.summary, 'one two');
  assert.deepEqual(merged.missingTests, ['t', 'u']);

  assert.equal(exceedsSeverity([f('low', 'x')], 'high'), false);
  assert.equal(exceedsSeverity([f('medium', 'x')], 'medium'), true);
  assert.equal(exceedsSeverity([f('high', 'x')], 'low'), true);
  assert.equal(exceedsSeverity([f('high', 'x')], null), false);
  assert.match(buildReviewPrompt('DIFFBODY'), /DIFFBODY/);
});

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

test('doctor helpers: node version check and summary exit code', () => {
  assert.equal(checkNodeVersion('22.1.0').status, 'ok');
  assert.equal(checkNodeVersion('16.20.0').status, 'fail');
  const summary = summarizeChecks([{ status: 'ok' }, { status: 'warn' }, { status: 'skip' }, { status: 'ok' }]);
  assert.deepEqual(summary, { ok: 2, warn: 1, fail: 0, skip: 1, exitCode: 0 });
  assert.equal(summarizeChecks([{ status: 'fail' }]).exitCode, 1);
});
