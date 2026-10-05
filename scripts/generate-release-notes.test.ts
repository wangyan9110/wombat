import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeTargets} from './native-platforms.ts';
import {renderReleaseNotes, validateReleaseSet} from './generate-release-notes.ts';

const set = {
  format: 1 as const, version: '0.1.0', source: 'a'.repeat(40), sourceSha256: 'b'.repeat(64), candidateOnly: false,
  targets: [...nativeTargets], assets: nativeTargets.map(target => ({target, archive: `wombat-${target}.tar.gz`, sha256: 'c'.repeat(64), bytes: 10})),
};
test('renders complete English stable release notes from verified release facts', () => {
  const notes = renderReleaseNotes({version: '0.1.0', summary: 'Stable summary.', highlights: ['One'], knownLimitations: ['Limit']}, set, 'owner/repo', 'v0.1.0-beta.1');
  assert.match(notes, /# Wombat v0\.1\.0/); assert.match(notes, /install\.sh \| sh\n/);
  assert.match(notes, /wombat update --check\n+wombat update/); assert.match(notes, /compare\/v0\.1\.0-beta\.1\.\.\.v0\.1\.0/);
  assert.doesNotMatch(notes, /--version 0\.1\.0/);
});
test('rejects incomplete target sets and mismatched editorial input', () => {
  assert.throws(() => validateReleaseSet({...set, assets: set.assets.slice(1)}), /one archive/);
  assert.throws(() => renderReleaseNotes({version: '0.1.1', summary: 'x', highlights: ['x'], knownLimitations: ['x']}, set, 'owner/repo'), /does not match/);
});
