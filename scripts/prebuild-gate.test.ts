import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { toolCommand } from './run-tool.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('prebuild entry needs no built artifacts and rejects a failing source check', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wombat-prebuild-gate-'));
  try {
    for (const relative of ['package.json', 'client/package.json', 'tests/prebuild', 'tests/helpers/native-codex.ts', 'tests/helpers/rfc3339.ts']) {
      const destination = path.join(directory, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(root, relative), destination, { recursive: true });
    }
    for (const relative of ['node_modules', 'client/node_modules']) {
      await symlink(path.join(root, relative), path.join(directory, relative), process.platform === 'win32' ? 'junction' : 'dir');
    }
    // This is a standalone CLI test runner, not a child file of the enclosing node:test run.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = () => spawnSync(...toolCommand('corepack', ['pnpm', 'test:prebuild']), {
      cwd: directory, env, encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
    });
    const valid = run();
    assert.ifError(valid.error);
    assert.equal(valid.status, 0, valid.stderr + valid.stdout);
    assert.match(valid.stdout, /lifecycle cleanup cannot claim exit when identity probes time out/);
    assert.match(valid.stdout, /Rust cutoff intervals retain nanoseconds/);
    await writeFile(path.join(directory, 'tests/prebuild/invalid.test.ts'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('synthetic source regression', () => assert.fail('SYNTHETIC_PREBUILD_FAILURE'));\n");
    const invalid = run();
    assert.ifError(invalid.error);
    assert.equal(invalid.status, 1, invalid.stderr + invalid.stdout);
    assert.match(invalid.stderr + invalid.stdout, /SYNTHETIC_PREBUILD_FAILURE/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
