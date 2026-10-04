import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectNative, nativeTargets, nativeNotices, nodeRuntimeBinary, sha256 } from './native-platforms.ts';
import { releaseNodeVersion } from './github-release.ts';

test('native assembly rejects missing, corrupt, mislabelled and mixed-revision artifacts', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-native-test-'));
  const target = 'linux-x64', version = '0.3.0', source = 'synthetic-commit';
  const folder = path.join(root, target); mkdirSync(folder);
  const binary = path.join(folder, 'wombat-core'); writeFileSync(binary, 'synthetic native binary');
  const runtimeFolder = path.join(folder, 'runtime'); mkdirSync(runtimeFolder);
  const runtime = path.join(runtimeFolder, nodeRuntimeBinary(target)); writeFileSync(runtime, 'synthetic node runtime');
  mkdirSync(path.join(folder,'licenses'));
  for (const file of nativeNotices) writeFileSync(path.join(folder,'licenses',file),'synthetic notice');
  const manifest = { target, version, source, sha256: sha256(binary), runtime: {name: 'node', version: releaseNodeVersion, sha256: sha256(runtime)}, notices: Object.fromEntries(nativeNotices.map(file => [file,sha256(path.join(folder,'licenses',file))])) };
  const save = value => writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(value));
  try {
    save(manifest); assert.deepEqual(inspectNative(root, target, version, source), manifest);
    for (const mismatch of [{ source: 'other' }, { version: '0.2.0' }, { target: 'darwin-x64' }, { sha256: 'wrong' }, {runtime: {...manifest.runtime, version: '25.0.0'}}]) {
      save({ ...manifest, ...mismatch }); assert.throws(() => inspectNative(root, target, version, source), /mismatch/);
    }
    save(manifest); writeFileSync(path.join(folder,'licenses','inventory.json'),'corrupted notice');
    assert.throws(() => inspectNative(root, target, version, source), /notice hash mismatch/);
    writeFileSync(path.join(folder,'licenses','inventory.json'),'synthetic notice');
    save(manifest); writeFileSync(binary, 'corrupted'); assert.throws(() => inspectNative(root, target, version, source), /mismatch/);
    assert.throws(() => inspectNative(root, 'win32-x64', version, source));
    assert.equal(nativeTargets.length, 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
