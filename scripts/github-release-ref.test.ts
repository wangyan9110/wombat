import assert from 'node:assert/strict';
import test from 'node:test';
import {parseRemoteRef} from './github-release-ref.ts';

test('GitHub ref queries require the exact ref and a valid commit or annotated tag identity', () => {
  const ref = 'refs/tags/v1.0.0', source = 'a'.repeat(40);
  for (const type of ['commit', 'tag']) assert.deepEqual(parseRemoteRef({ref, object: {sha: source, type}}, ref), {source, type});
  for (const value of [null, {ref: 'refs/heads/main', object: {sha: source, type: 'commit'}},
    {ref, object: {sha: 'wrong', type: 'commit'}}, {ref, object: {sha: source, type: 'tree'}}]) {
    assert.throws(() => parseRemoteRef(value, ref), /invalid remote ref/);
  }
});
