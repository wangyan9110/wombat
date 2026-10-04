import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeClient } from '@wombat/client/node';
import { nativeCodexFixture } from '../helpers/native-codex.js';

async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!await check()) { assert.ok(Date.now() < deadline, 'fixture condition timed out'); await delay(20); }
}

test('cancelled handoff distinguishes before-queue failure from after-queue uncertainty and releases transport', { timeout: 45_000 }, async () => {
  const dir = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'wombat-handoff-cancel-')));
  const source = path.join(dir, 'source'), project = path.join(dir, 'project');
  const previous = { WOMBAT_DATA_HOME: process.env.WOMBAT_DATA_HOME, CODEX_HOME: process.env.CODEX_HOME, WOMBAT_AUTO_PRICES: process.env.WOMBAT_AUTO_PRICES };
  Object.assign(process.env, { WOMBAT_DATA_HOME: path.join(dir, 'data'), CODEX_HOME: source, WOMBAT_AUTO_PRICES: '0' });
  let service: ChildProcess | undefined;
  try {
    await mkdir(path.join(source, 'sessions'), { recursive: true }); await mkdir(project);
    await writeFile(path.join(project, 'AGENTS.md'), 'x'.repeat(16_385));
    const binary = path.resolve('dist', process.platform === 'win32' ? 'wombat-core.exe' : 'wombat-core');
    service = spawn(binary, ['--serve-usage'], { stdio: 'ignore', env: process.env }); await once(service, 'spawn');
    const native = await nativeCodexFixture(dir);
    const client = createNodeClient({ binaryPath: binary, codexBinaryPath: native.binary, automaticPrices: false });
    const base = { roots: [source], projectRoots: [project], project };
    const before = await client.optimize!({ ...base, action: 'list' });
    const calls = async () => (await readFile(native.calls, 'utf8')).trim().split('\n').filter(Boolean).map(row => JSON.parse(row).method);
    for (const queued of [false, true]) {
      await writeFile(native.mode, JSON.stringify({ kind: 'available', threadStartDelayMs: queued ? 0 : 5000, queueDelayMs: queued ? 5000 : 0 })); await writeFile(native.calls, '');
      const preview = await client.handoff!({ ...base, action: 'preview' });
      const controller = new AbortController();
      const sending = client.handoff!({ ...base, action: 'send', readView: preview.readView, decisionRevision: preview.decisionRevision, selectionVersion: preview.selectionVersion }, { signal: controller.signal });
      await until(async () => (await calls()).includes(queued ? 'thread/queue/add' : 'thread/start'));
      controller.abort();
      const result = await sending;
      assert.equal(result.deliveries[0].status, queued ? 'unknown' : 'failed');
      assert.equal(result.deliveries[0].errorCode, queued ? 'HANDOFF_UNKNOWN' : 'CANCELLED');
      assert.equal((await calls()).filter(method => method === 'thread/queue/add').length, queued ? 1 : 0);
      await native.waitForExit();
      assert.ok(!(await readFile(native.lifecycle, 'utf8')).includes('delayedResponse'), 'cancellation ends the connection before the delayed response');
      const after = await client.optimize!({ ...base, action: 'list' });
      assert.equal(after.pending, before.pending); assert.equal(after.decisionRevision, before.decisionRevision);
      await writeFile(native.mode, JSON.stringify({ kind: 'available' }));
      const retryPreview = await client.handoff!({ ...base, action: 'preview' });
      const retried = await client.handoff!({ ...base, action: 'send', readView: retryPreview.readView, decisionRevision: retryPreview.decisionRevision, selectionVersion: retryPreview.selectionVersion });
      assert.equal(retried.deliveries[0].status, 'accepted', 'cancellation releases the in-flight guard');
    }
    const second = path.join(dir, 'second-project'); await mkdir(second); await writeFile(path.join(second, 'AGENTS.md'), 'y'.repeat(16_385));
    const batch = { roots: [source], projectRoots: [project, second] };
    await writeFile(native.mode, JSON.stringify({ kind: 'available', queueDelayMs: 5000 })); await writeFile(native.calls, '');
    const preview = await client.handoff!({ ...batch, action: 'preview' }); assert.equal(preview.projects.length, 2);
    const controller = new AbortController();
    const sending = client.handoff!({ ...batch, action: 'send', readView: preview.readView, decisionRevision: preview.decisionRevision, selectionVersion: preview.selectionVersion }, { signal: controller.signal });
    await until(async () => (await calls()).includes('thread/queue/add')); controller.abort();
    const result = await sending;
    assert.deepEqual(result.deliveries.map(d => [d.status, d.errorCode]), [['unknown', 'HANDOFF_UNKNOWN'], ['failed', 'CANCELLED']]);
    assert.equal((await calls()).filter(method => method === 'thread/queue/add').length, 1, 'remaining projects are not sent after cancellation');
    await native.waitForExit();
    assert.ok(!(await readFile(native.lifecycle, 'utf8')).includes('delayedResponse'));
  } finally {
    if (service && service.exitCode === null && service.signalCode === null) { const closed = once(service, 'close'); service.kill('SIGTERM'); await closed; }
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await rm(dir, { recursive: true, force: true });
  }
});
