import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectNative, nativeTargets, sha256 } from './native-platforms.ts';

test('native assembly rejects missing, corrupt, mislabelled and mixed-revision artifacts', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-native-test-'));
  const target = 'linux-x64', version = '0.3.0', source = 'synthetic-commit';
  const folder = path.join(root, target); mkdirSync(folder);
  const binary = path.join(folder, 'wombat-core'); writeFileSync(binary, 'synthetic native binary');
  const manifest = { target, version, source, sha256: sha256(binary) };
  const save = value => writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(value));
  try {
    save(manifest); assert.deepEqual(inspectNative(root, target, version, source), manifest);
    for (const mismatch of [{ source: 'other' }, { version: '0.2.0' }, { target: 'darwin-x64' }, { sha256: 'wrong' }]) {
      save({ ...manifest, ...mismatch }); assert.throws(() => inspectNative(root, target, version, source), /mismatch/);
    }
    save(manifest); writeFileSync(binary, 'corrupted'); assert.throws(() => inspectNative(root, target, version, source), /mismatch/);
    assert.throws(() => inspectNative(root, 'win32-x64', version, source));
    assert.equal(nativeTargets.length, 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
