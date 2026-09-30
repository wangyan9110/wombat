import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const entry = path.resolve('dist/wombat.js');
test('built CLI price update changes new snapshots only, is idempotent, and failures retain prices', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'wombat-price-e2e-'));
  try {
    const document = await readFile('core/tests/fixtures/official-pricing-synthetic.txt', 'utf8');
    const hook = path.join(root, 'official-source.mjs');
    await writeFile(hook, `globalThis.fetch = async (url, options) => {
      if (url !== 'https://developers.openai.com/api/docs/pricing.md' || options.redirect !== 'error') throw new Error('unexpected destination');
      if (process.env.TEST_PRICE_ERROR) throw new Error('offline');
      return new Response(process.env.TEST_PRICE_BAD ? '# Pricing\\nInvalid' : ${JSON.stringify(document)});
    };`);
    const env: NodeJS.ProcessEnv = { ...process.env, WOMBAT_DATA_HOME: path.join(root, 'data'), NODE_OPTIONS: '', NO_COLOR: '1' };
    delete env.WOMBAT_CORE_BIN;
    const run = (args: string[], extra: NodeJS.ProcessEnv = {}) => {
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(hook).href, entry, ...args, '--json'], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 15_000 });
      assert.ifError(result.error);
      assert.equal(result.stdout.trim().split('\n').length, 1);
      return { ...result, value: JSON.parse(result.stdout) };
    };
    const initial = run(['prices']);
    assert.equal(initial.status, 0);
    assert.equal(initial.value.origin, 'bundled');
    const source = path.join(root, 'source');
    await mkdir(path.join(source, 'sessions'), { recursive: true });
    const rows = [
      { type: 'session_meta', payload: { id: 'price-case' } },
      { type: 'turn_context', payload: { turn_id: 'turn', model: 'gpt-6-sol' } },
      { type: 'event_msg', payload: { type: 'token_usage_record', thread_id: 'price-case', turn_id: 'turn', response_id: 'response', usage: { input_tokens: 160000, cached_input_tokens: 50000, cache_write_input_tokens: 10000, output_tokens: 20000, reasoning_output_tokens: 0, total_tokens: 180000 } } },
    ].map(row => ({ timestamp: '2026-09-29T00:00:00Z', ...row }));
    await writeFile(path.join(source, 'sessions', 'source.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const before = run(['refresh', '--root', source]);
    assert.equal(before.status, 0);
    assert.equal(before.value.summary.price.cost, '0.435');
    const updated = run(['prices', 'update']);
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(updated.value.updated, true);
    assert.equal(updated.value.catalog.models.length, 9);
    assert.equal(updated.value.catalog.models.find((m: { id: string }) => m.id === 'synthetic-new').rates.input, '1.23');
    assert.match(updated.stderr, /校验并保存/);
    assert.equal(run(['prices', 'update']).value.updated, false);
    const status = run(['prices', 'status']);
    assert.equal(status.value.catalogHash, updated.value.catalogHash);
    assert.equal(status.stderr, '');
    const old = run(['usage', '--snapshot', before.value.snapshotRef.snapshotId, '--since', '2026-09-29', '--until', '2026-09-30']);
    assert.equal(old.value.summary.price.cost, '0.435');
    const after = run(['refresh', '--root', source]);
    assert.equal(after.value.summary.price.cost, '0.4125');
    assert.equal(after.value.summary.price.priceRevision, updated.value.catalog.revision);
    assert.equal(after.value.summary.tokens.total, before.value.summary.tokens.total);
    for (const [extra, code] of [[{ TEST_PRICE_ERROR: '1' }, 'PRICE_FETCH_FAILED'], [{ TEST_PRICE_BAD: '1' }, 'PRICE_SOURCE_CHANGED']] as const) {
      const failed = run(['prices', 'update'], extra);
      assert.equal(failed.status, 1);
      assert.equal(failed.value.error.code, code);
      assert.equal(run(['prices']).value.catalogHash, updated.value.catalogHash);
    }
    assert.equal(run(['prices', '--url', 'https://example.com']).value.error.code, 'INVALID_ARGUMENT');
    // Ordinary refresh must not touch the network even after a live catalog is installed.
    assert.equal(run(['refresh', '--root', source], { TEST_PRICE_ERROR: '1' }).status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
