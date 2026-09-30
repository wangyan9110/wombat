import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreError, createUsageClient, type PricingRequest } from '@wombat/client';
import { queryPrices } from '../dist/node/prices.js';

test('price requests are narrow, portable, cancellable and response validated', async () => {
  let called = false;
  const client = createUsageClient(async () => null, async () => { called = true; return null; });
  await assert.rejects(client.prices({ action: 'shell' } as unknown as PricingRequest), /价表参数/);
  await assert.rejects(client.prices({ action: 'update', url: 'https://example.com' } as PricingRequest), /价表参数/);
  assert.equal(called, false);
  await assert.rejects(client.prices({ action: 'status' }), /价表数据/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.prices({ action: 'update' }, { signal: controller.signal }), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
  await assert.rejects(createUsageClient(async () => null).prices({ action: 'status' }), /宿主未提供/);
});

test('official price fetch restricts URL, redirects and bounded bodies, and handles failures', async () => {
  const original = globalThis.fetch;
  const before = process.listenerCount('SIGINT');
  try {
    for (const [response, code] of [
      [new Response('unavailable', { status: 503 }), 'PRICE_FETCH_FAILED'],
      [new Response('oversized', { headers: { 'content-length': '9999999' } }), 'OUTPUT_LIMIT'],
      [new Response('x'.repeat(2 * 1024 * 1024 + 1)), 'OUTPUT_LIMIT'],
    ] as const) {
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://developers.openai.com/api/docs/pricing.md');
        assert.equal(options?.redirect, 'error');
        assert.equal(new Headers(options?.headers).has('authorization'), false);
        return response;
      };
      await assert.rejects(queryPrices({ action: 'update' }, {}, {}), (e: unknown) => e instanceof CoreError && e.code === code);
    }
    globalThis.fetch = async () => { throw new Error('network error'); };
    await assert.rejects(queryPrices({ action: 'update' }, {}, {}), /无法读取官方价表/);
    const controller = new AbortController();
    globalThis.fetch = async () => { controller.abort(); throw new Error('aborted'); };
    await assert.rejects(queryPrices({ action: 'update' }, { signal: controller.signal }, {}), (e: unknown) => e instanceof CoreError && e.code === 'CANCELLED');
    assert.equal(process.listenerCount('SIGINT'), before);
  } finally { globalThis.fetch = original; }
});
