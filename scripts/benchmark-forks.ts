/** Synthetic end-to-end cold refresh benchmark; requires release binaries and POSIX time. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileSha256, option, positiveInteger } from './benchmark-common.ts';

assert(process.platform !== 'win32', 'This benchmark requires POSIX time');
const core = path.resolve(option('--core', 'dist/wombat-core'));
const baseline = process.argv.includes('--baseline') ? path.resolve(option('--baseline')) : undefined;
const output = path.resolve(option('--output'));
const threads = positiveInteger('--threads', 2000);
const perThread = positiveInteger('--operations', 10);
const repeat = positiveInteger('--repeat', 3);
const shape = option('--shape', 'chain');
assert(['chain', 'star'].includes(shape), 'Shape must be chain or star');
assert(threads <= 9000 && perThread <= 1000 && repeat <= 10, 'Benchmark exceeds its supported fixture bounds');
const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'wombat-fork-bench-')));
const source = path.join(directory, 'source');
const sourceHash = createHash('sha256');
const at = '2026-10-03T00:00:01Z';
const row = (type: string, payload: unknown) => ({ type, timestamp: at, payload });
const name = (n: number) => `t${String(n).padStart(5, '0')}`;
let sourceBytes = 0;
await mkdir(path.join(source, 'sessions'), { recursive: true });
for (let n = 0; n < threads; n++) {
  const rows = [
    row('session_meta', { id: name(n), ...(n ? { forked_from_id: name(shape === 'chain' ? n - 1 : 0) } : {}) }),
    row('turn_context', { turn_id: 'u', model: 'gpt-5.4', effort: 'low' }),
    row('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 }, last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 } } }),
    ...Array.from({ length: perThread }, (_, i) => row('event_msg', { type: 'mcp_tool_call_end', call_id: i === 0 ? 'shared' : `${n}-${i}`, turn_id: 'u', invocation: { server: 'synthetic', tool: 'lookup', arguments: { private: 'SYNTHETIC_NOT_RETAINED' } }, duration: { secs: 0, nanos: 1000000 }, result: { Ok: { content: [] } } })),
  ];
  const text = rows.map(r => JSON.stringify(r) + '\n').join('');
  sourceHash.update(text); sourceBytes += Buffer.byteLength(text);
  await writeFile(path.join(source, 'sessions', name(n) + '.jsonl'), text);
}
async function bytesUnder(directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    bytes += entry.isDirectory() ? await bytesUnder(file) : (await stat(file)).size;
  }
  return bytes;
}
async function run(binary: string, label: string, iteration: number) {
  const data = path.join(directory, `${label}-${iteration}`);
  const args = process.platform === 'darwin' ? ['-l', binary] : ['-f', 'WB_MAX_RSS_KIB=%M', binary];
  const started = performance.now();
  const result = spawnSync('/usr/bin/time', args, {
    input: JSON.stringify({ op: 'usage_app', args: { action: 'refresh', roots: [source] } }),
    env: { ...process.env, WOMBAT_DATA_HOME: data, CODEX_HOME: source, WOMBAT_AUTO_PRICES: '0' },
    encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  });
  const wallMs = performance.now() - started;
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  const response = JSON.parse(result.stdout); assert.equal(response.ok, true, result.stdout);
  assert.equal(response.value.summary.tokens.total, 110, 'Inherited native counters must not multiply usage');
  const generation = path.join(data, 'usage-v3/generations', response.value.snapshotRef.snapshotId, 'committed');
  const manifest = JSON.parse(await readFile(path.join(generation, 'manifest.json'), 'utf8'));
  assert.equal(manifest.threads.length, threads);
  assert.equal(manifest.issues.length, 0); assert.ok(manifest.sources.every((s: { status: string }) => s.status === 'complete'));
  const operations = [], turns = [];
  for (const thread of manifest.threads) {
    turns.push(...Object.values(thread.turns).map((t: any) => t.turn));
    for (const line of (await readFile(path.join(generation, thread.file.file), 'utf8')).trim().split('\n').filter(Boolean)) {
      operations.push(...JSON.parse(line).operations);
    }
  }
  assert.equal(operations.length, (perThread - 1) * threads + 1);
  assert.equal(operations.reduce((n, op) => n + op.evidence.length, 0), threads * perThread);
  const shared = operations.filter(op => op.callId === 'shared'); assert.equal(shared.length, 1);
  assert.equal(shared[0].threadId, manifest.threads.find((t: any) => t.thread.upstreamId === name(0)).thread.id);
  assert.equal(shared[0].evidence.length, threads);
  for (const op of operations) {
    assert.equal(op.kind, 'mcpTool'); assert.equal(op.status, 'completed');
    op.evidence.sort((a: any, b: any) => a.file.localeCompare(b.file) || a.line - b.line);
  }
  operations.sort((a, b) => a.id.localeCompare(b.id)); turns.sort((a: any, b: any) => a.id.localeCompare(b.id));
  const ledger = JSON.parse(await readFile(path.join(generation, manifest.ledger.file), 'utf8'));
  assert.equal(ledger.length, 1);
  const canonical = JSON.stringify({ threads: manifest.threads.map((t: any) => t.thread), turns, measurements: ledger.map((r: any) => r.fact), operations });
  assert.ok(!canonical.includes('SYNTHETIC_NOT_RETAINED'));
  const rss = process.platform === 'darwin' ? /(\d+)\s+maximum resident set size/.exec(result.stderr) : /WB_MAX_RSS_KIB=(\d+)/.exec(result.stderr);
  assert.ok(rss, 'Peak memory observation missing');
  return { label, iteration, wallMs: Math.round(wallMs * 1000) / 1000, peakRssBytes: Number(rss[1]) * (process.platform === 'darwin' ? 1 : 1024), persistedBytes: await bytesUnder(data), canonicalSha256: createHash('sha256').update(canonical).digest('hex'), operations: operations.length, physicalEvidence: threads * perThread, tokenTotal: 110 };
}
try {
  const results = [];
  for (let n = 0; n < repeat; n++) {
    const binaries = baseline ? [{ binary: baseline, label: 'baseline' }, { binary: core, label: 'current' }] : [{ binary: core, label: 'current' }];
    if (n % 2) binaries.reverse();
    for (const { binary, label } of binaries) results.push(await run(binary, label, n));
  }
  assert.equal(new Set(results.map(r => r.canonicalSha256)).size, 1, 'Normalized facts differ between runs');
  const report = { format: 1, date: new Date().toISOString(), platform: process.platform + '-' + process.arch, scope: 'Cold Rust refresh: source scan, parse, ancestry reconciliation, pricing, immutable snapshot persistence and summary; no live service, browser or warm-index claims', cache: 'Fresh product data directory for every run; OS filesystem caches uncontrolled, run order alternates', corpus: { shape, threads, perThread, sourceBytes, sourceSha256: sourceHash.digest('hex'), nativeCounters: threads, sourceOperations: threads * perThread }, binaries: { currentSha256: fileSha256(core), ...(baseline ? { baselineSha256: fileSha256(baseline) } : {}) }, results, resultEquality: true, boundaries: ['Synthetic fixed corpus; no real source data', 'Small persisted footprint reflects this fixture and is not a product-wide disk bound', 'No 256MiB, million-record, 24-hour, Windows or UI acceptance claim'] };
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, corpus: report.corpus, results }));
} finally { await rm(directory, { recursive: true, force: true }); }
