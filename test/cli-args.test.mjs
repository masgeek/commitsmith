import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagValue } from '../src/cli-args.mjs';

test('flagValue reads "--name value" and "--name=value"', () => {
  assert.equal(flagValue(['--from', 'v1'], '--from'), 'v1');
  assert.equal(flagValue(['--from=v1.2'], '--from'), 'v1.2');
  assert.equal(flagValue(['--x'], '--from'), null);
});

test('flagValue throws when the value is missing or is another flag', () => {
  assert.throws(() => flagValue(['--from'], '--from'), /requires a value/);
  assert.throws(() => flagValue(['--from', '--branch', 'x'], '--from'), /requires a value/);
  assert.throws(() => flagValue(['--from='], '--from'), /requires a value/);
});
