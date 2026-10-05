import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cacheReleaseAsset, cacheReleaseAssets, releaseCacheDirectory } from './release-cache.ts';

test('release cache resumes complete files, repairs corrupt downloads and retains verified progress on failure', t => {
  const cache = mkdtempSync(path.join(os.tmpdir(), 'wombat-cache-test-'));
  t.after(() => rmSync(cache, {recursive: true, force: true}));
  const directory = releaseCacheDirectory(cache, 'owner/repo', '1.0.0', 'a'.repeat(40));
  const contents = 'complete archive';
  const asset = {name: 'archive.tar.gz', size: Buffer.byteLength(contents), digest: `sha256:${createHash('sha256').update(contents).digest('hex')}`};
  let downloads = 0, verifications = 0;
  const download = (destination: string) => {downloads++; writeFileSync(path.join(destination, asset.name), contents);};
  const verify = () => {verifications++;};
  assert.equal(cacheReleaseAsset(directory, asset, download, verify).reused, false);
  assert.equal(cacheReleaseAsset(directory, asset, download, verify).reused, true);
  assert.equal(downloads, 1); assert.equal(verifications, 2);
  assert.throws(() => cacheReleaseAsset(directory, asset, download, () => {throw new Error('verification unavailable');}), /verification unavailable/);
  assert.equal(downloads, 1);
  assert.equal(readFileSync(path.join(directory, asset.name), 'utf8'), contents);
  const second = {...asset, name: 'second.tar.gz'};
  assert.throws(() => cacheReleaseAsset(directory, second, destination => {
    writeFileSync(path.join(destination, second.name), 'partial'); throw new Error('network interrupted');
  }, verify), /network interrupted/);
  assert.deepEqual(readdirSync(directory), [asset.name]);
  writeFileSync(path.join(directory, asset.name), 'corrupt');
  assert.equal(cacheReleaseAsset(directory, asset, download, verify).reused, false);
  assert.equal(downloads, 2);
  assert.throws(() => cacheReleaseAsset(directory, second, destination => writeFileSync(path.join(destination, second.name), 'wrong'), verify), /SHA-256/);
  assert.deepEqual(readdirSync(directory), [asset.name]);
  for (const invalid of [{...asset, name: '../archive'}, {...asset, digest: ''}, {...asset, size: -1}]) {
    assert.throws(() => cacheReleaseAsset(directory, invalid, download, verify), /Invalid published asset/);
  }
  assert.throws(() => releaseCacheDirectory(cache, '../escape', '1.0.0', 'a'.repeat(40)), /Invalid release cache/);
  assert.notEqual(directory, releaseCacheDirectory(cache, 'owner/repo', '1.0.0', 'b'.repeat(40)));
});

test('batch recovery downloads only missing assets and preserves complete files after interruption', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'wombat-cache-batch-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const content = 'archive';
  const assets = ['one', 'two', 'three'].map(name => ({name, size: content.length,
    digest: `sha256:${createHash('sha256').update(content).digest('hex')}`}));
  assert.throws(() => cacheReleaseAssets(directory, assets, (missing, destination) => {
    assert.equal(missing.length, 3);
    writeFileSync(path.join(destination, 'one'), content);
    writeFileSync(path.join(destination, 'two'), 'partial');
    throw new Error('batch interrupted');
  }, () => {}), /batch interrupted/);
  assert.deepEqual(readdirSync(directory), ['one']);
  const resumed = cacheReleaseAssets(directory, assets, (missing, destination) => {
    assert.deepEqual(missing.map(asset => asset.name), ['two', 'three']);
    for (const asset of missing) writeFileSync(path.join(destination, asset.name), content);
  }, () => {});
  assert.deepEqual(resumed.map(result => result.reused), [true, false, false]);
  cacheReleaseAssets(directory, assets, () => {throw new Error('should not download');}, () => {});
  assert.throws(() => cacheReleaseAssets(directory, [assets[0], assets[0]], () => {}, () => {}), /Duplicate/);
});
