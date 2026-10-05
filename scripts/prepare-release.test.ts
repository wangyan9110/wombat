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

test('release preparation leaves proposal and historical acceptance text unchanged', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const proposal = path.join(root, 'docs/decisions/proposed/product/acceptance.md');
  const evidence = path.join(root, 'docs/benchmarks/acceptance.json');
  const retiredStatus = path.join(root, 'docs/project/status.md');
  const retained = 'Acceptance evidence for 0.1.0-dev.1 must not become evidence for a new release.\n';
  for (const file of [proposal, evidence, retiredStatus]) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, retained);
  }
  prepareVersionFiles(root, '0.1.0-dev.2');
  assert.deepEqual(consistencyErrors(root), []);
  for (const file of [proposal, evidence, retiredStatus]) {
    assert.equal(readFileSync(file, 'utf8'), retained);
  }
});

test('promotes beta user copy to stable installation and update instructions', t => {
  const root = fixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'README.md'), `## Get started\n\n**Beta: [\`v0.1.0-dev.1\`](https://github.com/wangyan9110/wombat/releases/tag/v0.1.0-dev.1).** Beta.\n\ncurl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --version 0.1.0-dev.1\n& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Version 0.1.0-dev.1\n\n### Update a pre-release\n\nold\n\nSee the [distribution guide](x).\n`);
  writeFileSync(path.join(root, 'README.zh-CN.md'), `## 开始使用\n\n**Beta 测试版：[\`v0.1.0-dev.1\`](https://github.com/wangyan9110/wombat/releases/tag/v0.1.0-dev.1)。** Beta。\n\ncurl -fsSL https://raw.githubusercontent.com/wangyan9110/wombat/main/install.sh | sh -s -- --version 0.1.0-dev.1\n& ([scriptblock]::Create((irm https://raw.githubusercontent.com/wangyan9110/wombat/main/install.ps1))) -Version 0.1.0-dev.1\n\n### 更新预发行版本\n\n旧文案\n\n安装选项、升级行为见说明。\n`);
  for (const file of ['docs/reference/distribution.en.md', 'docs/reference/distribution.md']) {
    writeFileSync(path.join(root, file), file.endsWith('.en.md')
      ? 'Wombat uses GitHub Releases and v0.1.0-dev.1.\n--version 0.1.0-dev.1\n'
      : 'Wombat 以 GitHub Releases 分发 v0.1.0-dev.1。\n-Version 0.1.0-dev.1\n');
  }
  prepareVersionFiles(root, '0.1.0');
  const english = readFileSync(path.join(root, 'README.md'), 'utf8');
  const chinese = readFileSync(path.join(root, 'README.zh-CN.md'), 'utf8');
  assert.match(english, /\*\*Stable:/); assert.match(chinese, /\*\*正式版：/);
  assert.match(english, /install\.sh \| sh\n/); assert.doesNotMatch(english, /--version 0\.1\.0/);
  assert.match(english, /wombat update --check\n+wombat update/);
  assert.match(chinese, /wombat update --check\n+wombat update/);
});
