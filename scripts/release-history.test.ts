import assert from 'node:assert/strict';
import test from 'node:test';
import {previousReleaseTag, publishedReleaseTags} from './release-history.ts';

test('selects the newest other release from an ordered published-release list', () => {
  assert.equal(previousReleaseTag(['v0.1.0', 'v0.1.0-beta.1', 'v0.1.0-dev.2'], '0.1.0'), 'v0.1.0-beta.1');
  assert.equal(previousReleaseTag(['v0.1.0-beta.1', 'not-a-release'], '0.1.0-beta.1'), undefined);
});

test('release history excludes failed tags, drafts and unrelated branches and follows publication time', () => {
  const tags = publishedReleaseTags([
    {tagName: 'v0.1.0-dev.2', isDraft: false, publishedAt: '2026-10-01T00:00:00Z'},
    {tagName: 'v0.1.0-beta.1', isDraft: false, publishedAt: '2026-10-04T00:00:00Z'},
    {tagName: 'v9.0.0', isDraft: true, publishedAt: null},
    {tagName: 'v2.0.0', isDraft: false, publishedAt: '2026-10-05T00:00:00Z'},
  ], ['v0.1.0', 'v9.0.0', 'v0.1.0-beta.1', 'v0.1.0-dev.2']);
  assert.deepEqual(tags, ['v0.1.0-beta.1', 'v0.1.0-dev.2']);
  assert.equal(previousReleaseTag(tags, '0.1.1'), 'v0.1.0-beta.1');
  assert.deepEqual(publishedReleaseTags([], ['v0.1.0']), []);
});

test('release history fails closed on invalid or incomplete publication evidence', () => {
  assert.throws(() => publishedReleaseTags({}, []), /must be an array/);
  assert.throws(() => publishedReleaseTags([{tagName: 'v0.1.0'}], []), /invalid release metadata/);
  for (const publishedAt of [null, 'invalid']) {
    assert.throws(() => publishedReleaseTags([{tagName: 'v0.1.0', isDraft: false, publishedAt}], ['v0.1.0']), /publication time/);
  }
  assert.throws(() => publishedReleaseTags(Array.from({length: 100}, () => ({
    tagName: 'unmerged', isDraft: false, publishedAt: '2026-10-01T00:00:00Z',
  })), []), /bounded published release history/);
});
