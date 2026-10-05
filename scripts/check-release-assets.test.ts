import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {verifyReleaseAssets} from './check-release-assets.ts';
import {nativeTargets} from './native-platforms.ts';

test('reused candidates retain exact identity and archive hashes without rebuilding', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-reused-assets-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const set = {format: 1, version: '1.0.0', source: 'a'.repeat(40), sourceSha256: 'b'.repeat(64), candidateOnly: false,
    targets: nativeTargets, assets: nativeTargets.map(target => ({target, archive: `wombat-${target}.tar.gz`,
      bytes: Buffer.byteLength(target), sha256: createHash('sha256').update(target).digest('hex')}))};
  for (const asset of set.assets) writeFileSync(path.join(root, asset.archive), asset.target);
  writeFileSync(path.join(root, 'release-set.json'), JSON.stringify(set));
  writeFileSync(path.join(root, 'SHA256SUMS'), set.assets.map(asset => `${asset.sha256}  ${asset.archive}`).join('\n'));
  assert.equal(verifyReleaseAssets(root, set.version, set.source).length, 5);
  assert.throws(() => verifyReleaseAssets(root, '1.0.1', set.source), /identity differs/);
  assert.throws(() => verifyReleaseAssets(root, set.version, 'c'.repeat(40)), /identity differs/);
  writeFileSync(path.join(root, set.assets[0].archive), 'corrupt');
  assert.throws(() => verifyReleaseAssets(root, set.version, set.source), /SHA-256 mismatch/);
});
