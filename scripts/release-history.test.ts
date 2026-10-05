import assert from 'node:assert/strict';
import test from 'node:test';
import {previousReleaseTag} from './release-history.ts';

test('selects the newest other release from an ordered published-release list', () => {
  assert.equal(previousReleaseTag(['v0.1.0', 'v0.1.0-beta.1', 'v0.1.0-dev.2'], '0.1.0'), 'v0.1.0-beta.1');
  assert.equal(previousReleaseTag(['v0.1.0-beta.1', 'not-a-release'], '0.1.0-beta.1'), undefined);
});
