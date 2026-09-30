import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreError, createUsageClient, type UsageRequest, type UsageResult } from '@wombat/client';

const response: UsageResult = {
  outputVersion: 3, action: 'usage',
  snapshotRef: { snapshotId: 'synthetic', createdAt: '2026-09-30T00:00:00Z' },
  scope: {}, availableRange: {},
  summary: {
    tokens: { input: 10, output: 2, total: 12 }, measurementCount: 1,
    price: { currency: 'USD', policy: 'synthetic', priceRevision: 'synthetic', cost: '0.1', knownCost: '0.1', status: 'priced', components: [], basis: [], issues: [] },
  },
  items: [], page: { offset: 0, limit: 50, total: 0 }, quality: { status: 'complete', issues: [], sources: [] },
};

test('portable client validates requests before invoking any host', async () => {
  let called = false;
  const client = createUsageClient(async () => { called = true; return response; });
  await assert.rejects(client.query({ action: 'shell' } as unknown as UsageRequest), (error: unknown) => error instanceof CoreError && error.code === 'INVALID_ARGUMENT');
  await assert.rejects(client.query({ action: 'usage', limit: -1 }), /查询参数/);
  assert.equal(called, false);
});

test('portable client keeps generated results and forwards cancellation and progress', async () => {
  const controller = new AbortController();
  const stages: string[] = [];
  const client = createUsageClient(async (request, options) => {
    assert.deepEqual(request, { action: 'usage' });
    assert.equal(options.signal, controller.signal);
    options.onProgress?.('读取快照');
    return response;
  });
  assert.equal(await client.query({ action: 'usage' }, { signal: controller.signal, onProgress: stage => stages.push(stage) }), response);
  assert.deepEqual(stages, ['读取快照']);
  controller.abort();
  await assert.rejects(client.query({ action: 'usage' }, { signal: controller.signal }), (error: unknown) => error instanceof CoreError && error.code === 'CANCELLED');
});

test('portable client rejects wrong version, malformed result and mismatched operation', async () => {
  for (const invalid of [{ ...response, outputVersion: 2 }, { ...response, action: 'refresh' }, { ...response, summary: {} }, null]) {
    await assert.rejects(createUsageClient(async () => invalid).query({ action: 'usage' }), (error: unknown) => error instanceof CoreError && error.code === 'PROTOCOL_ERROR');
  }
});
