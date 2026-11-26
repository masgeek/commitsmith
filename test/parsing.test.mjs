import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelJson, formatCommitMessage, fallbackFromRawText, parseGroupingResult, parseReleaseNotes, limitReleaseNotes, formatReleaseNotes } from '../src/parsing.mjs';

test('parseModelJson extracts a JSON object embedded in surrounding text', () => {
  const raw = 'Sure, here you go:\n{"type":"feat","subject":"add thing"}\nHope that helps!';
  assert.deepEqual(parseModelJson(raw), { type: 'feat', subject: 'add thing' });
});

test('parseModelJson returns null when no braces are present', () => {
  assert.equal(parseModelJson('no json here'), null);
});

test('parseModelJson returns null for malformed JSON between braces', () => {
  assert.equal(parseModelJson('{not valid json}'), null);
});

test('formatCommitMessage falls back to "chore" for an unknown type', () => {
  const result = formatCommitMessage({ type: 'bogus', subject: 'do a thing' });
  assert.match(result.message, /^🔧 chore: do a thing/);
});

test('formatCommitMessage returns null when the subject is empty', () => {
  assert.equal(formatCommitMessage({ type: 'feat', subject: '  ' }), null);
});

test('formatCommitMessage includes a scope when provided', () => {
  const result = formatCommitMessage({ type: 'fix', scope: 'cli', subject: 'handle empty input' });
  assert.match(result.message, /^🐛 fix\(cli\): handle empty input/);
});

test('formatCommitMessage marks breaking changes when detection is enabled', () => {
  const result = formatCommitMessage(
    { type: 'feat', subject: 'change API', breaking: true, breakingReason: 'removes old endpoint' },
    true
  );
  assert.equal(result.breaking, true);
  assert.match(result.message, /^💥 /);
  assert.match(result.message, /\n\nBREAKING CHANGE: removes old endpoint$/); // spec-style final footer
});

test('formatCommitMessage adds a footer even when the model gives no breaking reason', () => {
  const result = formatCommitMessage({ type: 'feat', subject: 'rename key', changes: ['renamed it'], breaking: true });
  assert.match(result.message, /\n\nBREAKING CHANGE: rename key$/);
  assert.doesNotMatch(result.message, /\* .*BREAKING/);
});

test('formatCommitMessage has no footer for non-breaking changes', () => {
  assert.doesNotMatch(formatCommitMessage({ type: 'fix', subject: 'x', breakingReason: 'ignored' }).message, /BREAKING/);
});

test('formatCommitMessage ignores the breaking flag when detection is disabled', () => {
  const result = formatCommitMessage({ type: 'feat', subject: 'change API', breaking: true }, false);
  assert.equal(result.breaking, false);
  assert.match(result.message, /^✨ /);
});

test('formatCommitMessage strips a duplicated inline "[BREAKING CHANGE: ...]" from a bullet', () => {
  const result = formatCommitMessage({
    type: 'feat',
    subject: 'add thing',
    changes: ['did a thing [BREAKING CHANGE: nope not really]'],
  });
  assert.doesNotMatch(result.message, /\[BREAKING CHANGE/);
});

test('fallbackFromRawText uses the first non-empty line as the subject', () => {
  const result = fallbackFromRawText('\n  "fix: handle empty input"  \nextra text\n');
  assert.deepEqual(result, { message: 'fix: handle empty input', breaking: false });
});

test('fallbackFromRawText returns null for all-whitespace input', () => {
  assert.equal(fallbackFromRawText('   \n   '), null);
});

test('parseGroupingResult returns null when the model response has no groups array', () => {
  assert.equal(parseGroupingResult('{"not":"groups"}', ['a.js']), null);
});

test('parseGroupingResult sweeps files the model missed into a trailing catch-all group', () => {
  const raw = JSON.stringify({
    groups: [{ files: ['a.js'], type: 'feat', subject: 'add a' }],
  });
  const groups = parseGroupingResult(raw, ['a.js', 'b.js']);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].files, ['a.js']);
  assert.deepEqual(groups[1].files, ['b.js']);
  assert.match(groups[1].message, /chore: update b\.js/);
});

test('parseGroupingResult drops duplicate file claims across groups (first one wins)', () => {
  const raw = JSON.stringify({
    groups: [
      { files: ['a.js'], type: 'feat', subject: 'first' },
      { files: ['a.js'], type: 'fix', subject: 'second' },
    ],
  });
  const groups = parseGroupingResult(raw, ['a.js']);
  assert.equal(groups.length, 1);
  assert.match(groups[0].message, /first/);
});

test('parseGroupingResult ignores files the model listed that were never staged', () => {
  const raw = JSON.stringify({ groups: [{ files: ['a.js', 'not-staged.js'], type: 'feat', subject: 'add a' }] });
  const groups = parseGroupingResult(raw, ['a.js']);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].files, ['a.js']);
});

test('parseReleaseNotes extracts the notes array from JSON output', () => {
  const raw = '{"notes":["Added a login screen","Fixed a crash on startup"]}';
  assert.deepEqual(parseReleaseNotes(raw), ['Added a login screen', 'Fixed a crash on startup']);
});

test('parseReleaseNotes falls back to non-empty lines when the model returns no JSON', () => {
  const result = parseReleaseNotes('Added a login screen\nFixed a crash');
  assert.deepEqual(result, ['Added a login screen', 'Fixed a crash']);
});

test('parseReleaseNotes caps the note count', () => {
  const notes = Array.from({ length: 15 }, (_, i) => `note ${i}`);
  const raw = JSON.stringify({ notes });
  assert.equal(parseReleaseNotes(raw).length, 6);
});

test('parseReleaseNotes returns null when there is nothing to summarize', () => {
  assert.equal(parseReleaseNotes('{"notes":[]}'), null);
  assert.equal(parseReleaseNotes('   \n  '), null);
});

test('parseReleaseNotes drops "Here are the notes:" preamble lines in the non-JSON fallback', () => {
  assert.deepEqual(parseReleaseNotes('Here are the notes:\n- Added dark mode'), ['Added dark mode']);
});

test('parseReleaseNotes caps at 6 notes', () => {
  const raw = JSON.stringify({ notes: Array.from({ length: 9 }, (_, i) => `n${i}`) });
  assert.equal(parseReleaseNotes(raw).length, 6);
});

test('limitReleaseNotes drops trailing notes to fit, keeping at least one', () => {
  const notes = ['aaaaa', 'bbbbb', 'ccccc'];
  assert.deepEqual(limitReleaseNotes(notes, 100), { notes, fits: true });
  assert.deepEqual(limitReleaseNotes(notes, 15), { notes: ['aaaaa', 'bbbbb'], fits: true });
  assert.deepEqual(limitReleaseNotes(notes, 3), { notes: ['aaaaa'], fits: false });
  assert.equal(formatReleaseNotes(['x', 'y']), '- x\n- y');
});
