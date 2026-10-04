import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeClient } from '@wombat/client/node';
import { nativeCodexFixture } from '../helpers/native-codex.js';

test('handoff preserves pending checks after rejection or unknown acceptance and only resends explicitly', { timeout: 60_000 }, async () => {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'wombat-delivery-')));
  const source = path.join(dir, 'source'), project = path.join(dir, 'project');
  const previous = { WOMBAT_DATA_HOME: process.env.WOMBAT_DATA_HOME, CODEX_HOME: process.env.CODEX_HOME, WOMBAT_AUTO_PRICES: process.env.WOMBAT_AUTO_PRICES };
  Object.assign(process.env, { WOMBAT_DATA_HOME: path.join(dir, 'data'), CODEX_HOME: source, WOMBAT_AUTO_PRICES: '0' });
  try {
    await mkdir(path.join(source, 'sessions'), { recursive: true }); await mkdir(project);
    await writeFile(path.join(project, 'AGENTS.md'), 'x'.repeat(16_385));
    const native = await nativeCodexFixture(dir);
    const client = createNodeClient({ binaryPath: path.resolve('dist', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core'), codexBinaryPath: native.binary, automaticPrices: false });
    const base = { roots: [source], projectRoots: [project], project };
    const before = await client.optimize!({ ...base, action: 'list' });
    const unavailable = createNodeClient({ binaryPath: path.resolve('dist', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core'), codexBinaryPath: path.join(dir, 'not-installed-codex'), automaticPrices: false });
    const reviewed = await unavailable.handoff!({ ...base, action: 'preview' });
    await assert.rejects(unavailable.handoff!({ ...base, action: 'send', readView: reviewed.readView, decisionRevision: reviewed.decisionRevision, selectionVersion: reviewed.selectionVersion }), { code: 'CODEX_UNAVAILABLE' });
    assert.equal((await client.optimize!({ ...base, action: 'list' })).pending, before.pending);
    for (const [queueBehavior, status, errorCode] of [
      ['rejected', 'failed', 'CODEX_REQUEST_REJECTED'],
      ['mismatch', 'unknown', 'HANDOFF_UNKNOWN'],
      ['disconnect', 'unknown', 'HANDOFF_UNKNOWN'],
      ['accepted', 'accepted', null],
      ['accepted', 'accepted', null],
    ] as const) {
      await writeFile(native.mode, JSON.stringify({ kind: 'available', queueBehavior })); await writeFile(native.calls, '');
      const preview = await client.handoff!({ ...base, action: 'preview' });
      const result = await client.handoff!({ ...base, action: 'send', readView: preview.readView, decisionRevision: preview.decisionRevision, selectionVersion: preview.selectionVersion });
      assert.equal(result.deliveries.length, 1); assert.equal(result.deliveries[0].status, status); assert.equal(result.deliveries[0].errorCode, errorCode);
      const calls = (await readFile(native.calls, 'utf8')).trim().split('\n').map(row => JSON.parse(row).method);
      assert.equal(calls.filter(method => method === 'thread/queue/add').length, 1, 'one explicit send has one queue attempt');
      const after = await client.optimize!({ ...base, action: 'list' });
      assert.equal(after.pending, before.pending); assert.equal(after.decisionRevision, before.decisionRevision);
      assert.deepEqual(after.suggestions.map(s => [s.id, s.status, s.decision]), before.suggestions.map(s => [s.id, s.status, s.decision]));
      assert.ok(!JSON.stringify(result).includes('Synthetic private rejection'));
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(dir, { recursive: true, force: true });
  }
});
