import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, GROUPS, resolveHelp, normalizeTopic, renderOverview, renderTopic } from '../src/help.mjs';

test('resolveHelp: help <topic>, <command> --help, --flag --help, and the overview', () => {
  assert.deepEqual(resolveHelp(['help']), { topic: null });
  assert.deepEqual(resolveHelp(['help', 'pr']), { topic: 'pr' });
  assert.deepEqual(resolveHelp(['help', '--pr']), { topic: 'pr' });
  assert.deepEqual(resolveHelp(['help', 'init', 'github']), { topic: 'init github' });
  assert.deepEqual(resolveHelp(['help', 'release', 'notes']), { topic: 'release-notes' });
  assert.deepEqual(resolveHelp(['help', 'nope']), { unknown: 'nope' });

  assert.deepEqual(resolveHelp(['init', '--help']), { topic: 'init' });
  assert.deepEqual(resolveHelp(['init', 'github', '--help']), { topic: 'init github' });
  assert.deepEqual(resolveHelp(['hook', 'install', '--help']), { topic: 'hook' });
  assert.deepEqual(resolveHelp(['doctor', '-h']), { topic: 'doctor' });

  assert.deepEqual(resolveHelp(['--pr', '--help']), { topic: 'pr' });
  assert.deepEqual(resolveHelp(['--help', '--split-hunks']), { topic: 'commit' });
  assert.deepEqual(resolveHelp(['-y', '--help']), { topic: 'commit' });
  assert.deepEqual(resolveHelp(['--release-notes', '--from', 'v1', '-h']), { topic: 'release-notes' });
  assert.deepEqual(resolveHelp(['--help']), { topic: null });
  assert.deepEqual(resolveHelp(['-h', '--no-interactive']), { topic: null });
});

test('normalizeTopic accepts flags, aliases, underscores and spaces', () => {
  assert.equal(normalizeTopic('--Breaking'), 'breaking');
  assert.equal(normalizeTopic('release_notes'), 'release-notes');
  assert.equal(normalizeTopic('release notes'), 'release-notes');
  assert.equal(normalizeTopic('hooks'), 'hook');
  assert.equal(normalizeTopic('pull-request'), 'pr');
  assert.equal(normalizeTopic('github'), 'init github');
  assert.equal(normalizeTopic('split-hunks'), 'commit');
  assert.equal(normalizeTopic('env'), 'config');
  assert.equal(normalizeTopic('wibble'), null);
  assert.equal(normalizeTopic(''), null);
});

test('every topic is complete, grouped, cross-linked correctly, and rendered in the overview', () => {
  const overview = renderOverview();
  for (const [key, t] of Object.entries(TOPICS)) {
    assert.ok(GROUPS.includes(t.group), `${key}: unknown group`);
    for (const field of ['label', 'summary', 'description']) assert.ok(t[field], `${key}: missing ${field}`);
    assert.ok(t.usage.length > 0, `${key}: no usage`);
    for (const s of t.see ?? []) assert.ok(TOPICS[s], `${key}: "see" points at unknown topic ${s}`);
    assert.ok(overview.includes(t.label), `${key}: not listed in the overview`);

    const page = renderTopic(key);
    assert.ok(page.includes('Usage'), `${key}: page has no Usage`);
    assert.ok(page.includes(t.usage[0]), `${key}: page misses its usage line`);
    for (const [flag] of t.options) assert.ok(page.includes(flag.split(' ')[0]), `${key}: page misses ${flag}`);
  }
  for (const g of GROUPS) assert.ok(Object.values(TOPICS).some((t) => t.group === g), `empty group ${g}`);
});

test('the overview is short: one line per command, details only on the per-command pages', () => {
  const overview = renderOverview();
  assert.ok(overview.split('\n').length < 60);
  assert.doesNotMatch(overview, /--max-chars|--fail-on|--release-version/); // option-level detail lives on the pages
  assert.match(renderTopic('release-notes'), /--max-chars/);
  assert.match(renderTopic('review'), /--fail-on/);
  assert.match(renderTopic('changelog'), /--release-version/);
});
