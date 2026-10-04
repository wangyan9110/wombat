import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  consistencyErrors,
  packageFiles,
  prepareVersionFiles,
  releaseTextFiles,
  validateVersion,
} from './prepare-release.ts';

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'wombat-release-'));
  for (const file of packageFiles) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), `${JSON.stringify({ name: file, version: '0.1.0-dev.1' }, null, 2)}\n`);
  }
  mkdirSync(path.join(root, 'core'), { recursive: true });
  writeFileSync(path.join(root, 'core/Cargo.toml'), '[package]\nname = "wombat-core"\nversion = "0.1.0-dev.1"\n');
  writeFileSync(path.join(root, 'core/Cargo.lock'), '[[package]]\nname = "another-package"\nversion = "0.1.0-dev.1"\n\n[[package]]\nname = "wombat-core"\nversion = "0.1.0-dev.1"\n');
  for (const file of releaseTextFiles) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), 'Install Wombat v0.1.0-dev.1 with 0.1.0-dev.1.\n');
  }
  return root;
}

test('prepares every release version surface and passes consistency checks', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(prepareVersionFiles(root, '0.1.0-dev.2'), '0.1.0-dev.1');
  assert.deepEqual(consistencyErrors(root), []);
  for (const file of [...packageFiles, ...releaseTextFiles, 'core/Cargo.toml']) {
    assert.doesNotMatch(readFileSync(path.join(root, file), 'utf8'), /0\.1\.0-dev\.1/);
  }
  const lock = readFileSync(path.join(root, 'core/Cargo.lock'), 'utf8');
  assert.match(lock, /name = "another-package"\nversion = "0\.1\.0-dev\.1"/);
  assert.match(lock, /name = "wombat-core"\nversion = "0\.1\.0-dev\.2"/);
});

test('rejects malformed versions and incomplete release surfaces before writing', t => {
  for (const version of ['v0.1.0', '01.0.0', '0.1', '0.1.0+build']) {
    assert.throws(() => validateVersion(version), /Invalid release version/);
  }
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'README.md'), 'missing current version\n');
  assert.throws(() => prepareVersionFiles(root, '0.1.0-dev.2'), /README\.md/);
  assert.equal(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version, '0.1.0-dev.1');

  const driftedRoot = fixture();
  t.after(() => rmSync(driftedRoot, { recursive: true, force: true }));
  writeFileSync(path.join(driftedRoot, 'core/Cargo.toml'), '[package]\nname = "wombat-core"\nversion = "0.1.0-dev.0"\n');
  assert.throws(() => prepareVersionFiles(driftedRoot, '0.1.0-dev.2'), /core\/Cargo\.toml: expected current version/);
  assert.equal(JSON.parse(readFileSync(path.join(driftedRoot, 'package.json'), 'utf8')).version, '0.1.0-dev.1');
});
