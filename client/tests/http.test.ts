import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreError } from '@wombat/client';
import { createHttpClient } from '@wombat/client/http';

test('HTTP client rejects malformed, truncated, oversized and wrong-contract streams', async () => {
  for (const body of ['{}\n', '{"type":"progress","stage":"x"}\n', '{"type":"result","value":{}}\n', 'x'.repeat(1000)]) {
    const client = createHttpClient({ origin: 'http://127.0.0.1:1', token: 'synthetic', maxBytes: 500,
      fetch: async () => new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }) });
    await assert.rejects(client.query({ action: 'usage' }), (error: unknown) => error instanceof CoreError);
  }
});

test('HTTP client preserves errors split across UTF-8 and frame boundaries', async () => {
  const bytes = new TextEncoder().encode('{"type":"progress","stage":"合成"}\n{"type":"error","code":"SYNTHETIC","message":"合成错误"}\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const stages: string[] = [];
  const client = createHttpClient({ origin: 'http://127.0.0.1:1', token: 'synthetic', fetch: async () => new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }) });
  await assert.rejects(client.query({ action: 'usage' }, { onProgress: stage => stages.push(stage) }), (error: unknown) => error instanceof CoreError && error.code === 'SYNTHETIC' && error.message === '合成错误');
  assert.deepEqual(stages, ['合成']);
});
