import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'wombat-release-probe-'));

try {
  const result = spawnSync(process.execPath, [path.join(root, 'dist', 'wombat.js'), 'optimize', 'capabilities', '--json'], {
    cwd: temporary,
    env: {
      ...process.env,
      WOMBAT_AUTO_PRICES: '0',
      WOMBAT_DATA_HOME: path.join(temporary, 'data'),
      CODEX_HOME: path.join(temporary, 'missing-source-must-not-be-scanned'),
    },
    encoding: 'utf8',
    input: '',
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.trim().split('\n').length, 1, 'startup probe must print one JSON object');
  const value = JSON.parse(result.stdout);
  assert.equal(value.action, 'capabilities');
  assert.equal(value.resultStatus, 'complete');
  assert.equal(value.readView, null);
  console.log(`Shared-service startup probe passed on ${process.platform}/${process.arch} without scanning sources.`);
} finally {
  rmSync(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
