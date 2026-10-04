/** Fixed synthetic live-index benchmark. Run after build; POSIX only. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { fileSha256, formatMicros, moneyMicros, option, positiveInteger, run } from './benchmark-common.js';

assert(process.platform !== 'win32', 'This benchmark requires POSIX');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = path.resolve(option('--core', 'dist/wombat-core'));
const output = path.resolve(option('--output'));
const measurements = positiveInteger('--measurements', 100_000);
const threads = positiveInteger('--threads', 500);
const appends = positiveInteger('--appends', 12);
const priceGroups = positiveInteger('--price-groups', 1);
assert(priceGroups <= measurements, 'Price groups cannot exceed measurement count');
assert(threads <= measurements && existsSync(core));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'wombat-memory-bench-'));
const source = path.join(temporary, 'source');
mkdirSync(path.join(source, 'sessions'), { recursive: true });
const env = { ...process.env, WOMBAT_DATA_HOME: path.join(temporary, 'data'), CODEX_HOME: source, WOMBAT_CORE_BIN: core };
const raw = createHash('sha256');
const line = (value: object) => JSON.stringify(value) + '\n';
const record = (thread: string, response: string | number) => ({ type: 'event_msg', timestamp: '2026-09-29T00:00:01Z', payload: { type: 'token_usage_record', thread_id: thread, turn_id: 'u', response_id: String(response), usage: { input_tokens: 100 + (typeof response === 'number' ? 2 * (response % priceGroups) : 0), cached_input_tokens: 60, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 + (typeof response === 'number' ? 2 * (response % priceGroups) : 0) } } });
for (let index = 0; index < threads; index++) {
  const thread = `thread-${index}`;
  const file = path.join(source, 'sessions', `${index}.jsonl`);
  const stream = createWriteStream(file);
  for (const value of [{ type: 'session_meta', payload: { id: thread } }, { type: 'turn_context', payload: { turn_id: 'u', model: 'gpt-5.4', effort: 'high' } }]) {
    const text = line(value); stream.write(text); raw.update(text);
  }
  for (let j = index; j < measurements; j += threads) {
    for (const value of [record(thread, j), { type: 'response_item', payload: { type: 'function_call', name: 'read_file', call_id: String(j), arguments: 'SYNTHETIC_PRIVATE_ARGUMENT' } }]) {
      const text = line(value); stream.write(text); raw.update(text);
    }
  }
  await new Promise<void>((resolve, reject) => { stream.on('error', reject); stream.end(resolve); });
}
const timer = process.platform === 'darwin' ? ['/usr/bin/time', '-l'] : ['/usr/bin/time', '-f', 'WB_MAX_RSS_KIB=%M'];
const service = spawn(timer[0], [...timer.slice(1), core, '--serve-usage'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
const serviceClosed = new Promise<void>(resolve => service.once('close', () => resolve()));
let serviceError = '';
service.stderr?.on('data', (chunk: Buffer) => { serviceError = (serviceError + chunk.toString()).slice(-5000); });
let servicePid = service.pid ?? 0;
assert(servicePid > 0, `Core process did not start: ${serviceError}`);
// BSD time may exec the core in place; GNU time may retain a parent process.
for (let attempt = 0; attempt < 10; attempt++) {
  const child = spawnSync('pgrep', ['-P', String(service.pid)], { encoding: 'utf8' });
  const found = Number(child.stdout.trim().split(/\s+/)[0]);
  if (found > 0) { servicePid = found; break; }
  await delay(20);
}
const rss = () => Number(run('ps', ['-o', 'rss=', '-p', String(servicePid)]).stdout.trim());
const cpuSeconds = () => run('ps', ['-o', 'time=', '-p', String(servicePid)]).stdout.trim().split(':').reverse().reduce((sum, part, i) => sum + Number(part) * 60 ** i, 0);
const query = (action = 'usage'): [number, any] | null => {
  const start = performance.now();
  const response = spawnSync(process.execPath, [path.join(root, 'dist/wombat.js'), action, '--fresh', '--since', '2026-09-29', '--until', '2026-09-30', '--json'], { env, encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024 * 1024 });
  if (response.error) throw response.error;
  const value = JSON.parse(response.stdout);
  if (value.error?.code === 'SYNC_TIMEOUT') return null;
  assert.equal(response.status, 0, response.stderr);
  assert.equal(value.freshness.status, 'current');
  return [performance.now() - start, value];
};
function bytesUnder(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const file = path.join(directory, entry.name);
    return sum + (entry.isDirectory() ? bytesUnder(file) : statSync(file).size);
  }, 0);
}
try {
  const start = performance.now(); let first: [number, any] | null = null;
  while (first === null) { first = query(); assert(performance.now() - start < 120_000, 'Cold indexing exceeded 120 seconds'); }
  const cold = performance.now() - start;
  const cycles = BigInt(Math.floor(measurements / priceGroups)), groups = BigInt(priceGroups), remainder = BigInt(measurements % priceGroups);
  const groupSum = cycles * groups * (groups - 1n) / 2n + remainder * (remainder - 1n) / 2n;
  const expected = BigInt(measurements) * 265n + groupSum * 5n;
  const expectedTokens = measurements * 110 + Number(groupSum * 2n);
  assert.equal(first[1].summary.tokens.total, expectedTokens);
  assert.equal(moneyMicros(first[1].summary.price.cost), expected);
  const warm = Array.from({ length: 5 }, () => query()![0]);
  const [threadMs, threadResult] = query('threads')!;
  assert.equal(threadResult.summary.tokens.total, expectedTokens);
  assert.equal(moneyMicros(threadResult.summary.price.cost), expected);
  const appended: number[] = []; const rssSamples: number[] = [];
  for (let index = 0; index < appends; index++) {
    const file = path.join(source, 'sessions/0.jsonl');
    const { openSync, writeSync, fsyncSync, closeSync } = await import('node:fs');
    const handle = openSync(file, 'a');
    try { writeSync(handle, line(record('thread-0', `extra-${index}`))); fsyncSync(handle); } finally { closeSync(handle); }
    const [elapsed, value] = query()!; appended.push(elapsed);
    assert.equal(value.summary.tokens.total, expectedTokens + (index + 1) * 110);
    assert.equal(moneyMicros(value.summary.price.cost), expected + BigInt(index + 1) * 265n);
    rssSamples.push(rss());
  }
  const cpuStart = cpuSeconds(); const idleStart = performance.now(); await delay(5000);
  const idleCpuPercent = 100 * (cpuSeconds() - cpuStart) / ((performance.now() - idleStart) / 1000);
  const finalRss = rss(); const size = bytesUnder(path.join(temporary, 'data'));
  const indexFile = path.join(temporary, 'data', 'live-v1', 'index.sqlite');
  const diskBytes = (file: string) => existsSync(file) ? statSync(file).size : 0;
  const liveIndexDbBytes = diskBytes(indexFile), liveIndexWalBytes = diskBytes(indexFile + '-wal');
  const deadline = idleStart + 25_000;
  while (service.exitCode === null && performance.now() < deadline) await delay(100);
  assert.equal(service.exitCode, 0, serviceError || 'Service did not exit after idle timeout');
  await serviceClosed;
  const dataBytesAfterIdleExit = bytesUnder(path.join(temporary, 'data'));
  const peakMatch = process.platform === 'darwin' ? /(?:^|\n)\s*(\d+)\s+maximum resident set size/.exec(serviceError) : /WB_MAX_RSS_KIB=(\d+)/.exec(serviceError);
  assert(peakMatch, 'time did not report peak RSS');
  const peakRssBytes = Number(peakMatch[1]) * (process.platform === 'linux' ? 1024 : 1);
  const result = {
    platform: `${os.type()} ${os.arch()}`, coreSha256: fileSha256(core), corpusSha256: raw.digest('hex'), measurements, operations: measurements, threads, appends, priceGroups,
    coldSyncAndCliMs: Math.round(cold * 100) / 100, warmCliMs: warm.map(value => Math.round(value * 100) / 100), threadsCliMs: Math.round(threadMs * 100) / 100,
    appendSyncAndCliMs: appended.map(value => Math.round(value * 100) / 100), peakRssBytes,
    rssKiBAtEnd: finalRss, indexBytes: size, liveIndexDbBytes, liveIndexWalBytes, dataBytesAfterIdleExit, idleCpuPercentOver5s: Math.round(idleCpuPercent * 1000) / 1000,
    idleExitMs: Math.round((performance.now() - idleStart) * 100) / 100, appendRssKiB: rssSamples,
    correctness: `Initial truth: ${expectedTokens} tokens and ${formatMicros(expected)} USD across ${priceGroups} pricing-input groups. Each append contributes 110 tokens and ${formatMicros(265n)} USD; usage and threads agree.`,
    conditions: 'Release core; new SQLite index; filesystem caches uncontrolled; indexBytes includes all product data and live WAL before idle exit, dataBytesAfterIdleExit includes settled product data; logical file lengths, not filesystem allocated blocks; peak RSS is the maximum resident size reported by time for the service; no raw-body persistence; not a 24-hour or million-record acceptance.',
  };
  mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} finally {
  if (service.exitCode === null && service.pid) { service.kill('SIGTERM'); await delay(300); if (service.exitCode === null) service.kill('SIGKILL'); }
  rmSync(temporary, { recursive: true, force: true });
}
