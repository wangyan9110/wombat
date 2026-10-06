/** Fixed synthetic live-index cold/append/rebuild benchmark. Run after build; POSIX only. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { fileSha256, formatMicros, moneyMicros, option, positiveInteger, run } from './benchmark-common.js';
import { directoryBytes, isExpectedSyncTimeout, liveIndexPayloadFootprint, normalizeUsageOracle, parseBenchmarkCliResponse, snapshotFootprint, sourceTreeIdentity } from './benchmark-live-helpers.js';

assert(process.platform !== 'win32', 'This benchmark requires POSIX');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = path.resolve(option('--core', 'dist/wombat-core'));
const cli = path.resolve(option('--cli', 'dist/wombat.js'));
const output = path.resolve(option('--output'));
const measurements = positiveInteger('--measurements', 100_000);
const threads = positiveInteger('--threads', 500);
const appends = positiveInteger('--appends', 12);
const priceGroups = positiveInteger('--price-groups', 1);
assert(priceGroups <= measurements, 'Price groups cannot exceed measurement count');
assert(threads <= measurements && existsSync(core) && existsSync(cli), 'Build the release core and CLI before benchmarking');

const temporary = mkdtempSync(path.join(os.tmpdir(), 'wombat-memory-bench-'));
const source = path.join(temporary, 'source');
mkdirSync(path.join(source, 'sessions'), { recursive: true });
const line = (value: object) => JSON.stringify(value) + '\n';
const record = (thread: string, response: string | number) => ({ type: 'event_msg', timestamp: '2026-09-29T00:00:01Z', payload: { type: 'token_usage_record', thread_id: thread, turn_id: 'u', response_id: String(response), usage: { input_tokens: 100 + (typeof response === 'number' ? 2 * (response % priceGroups) : 0), cached_input_tokens: 60, cache_write_input_tokens: 0, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: 110 + (typeof response === 'number' ? 2 * (response % priceGroups) : 0) } } });

const services: MeasuredService[] = [];

interface MeasuredService {
  child: ReturnType<typeof spawn>;
  pid: number;
  processPid: number;
  closed: Promise<void>;
  stderr: string;
  environment: NodeJS.ProcessEnv;
  spawnError?: Error;
}

async function startService(dataHome: string): Promise<MeasuredService> {
  const environment = { ...process.env, WOMBAT_AUTO_PRICES: '0', WOMBAT_DATA_HOME: dataHome, CODEX_HOME: source, WOMBAT_CORE_BIN: core };
  const timer = process.platform === 'darwin' ? ['/usr/bin/time', '-l'] : ['/usr/bin/time', '-f', 'WB_MAX_RSS_KIB=%M'];
  const child = spawn(timer[0], [...timer.slice(1), core, '--serve-usage'], { env: environment, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  const service: MeasuredService = { child, pid: child.pid ?? 0, processPid: child.pid ?? 0, closed: new Promise(resolve => child.once('close', () => resolve())), stderr: '', environment };
  services.push(service);
  const spawned = new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', error => { service.spawnError = error; reject(error); });
  });
  child.stderr?.on('data', (chunk: Buffer) => { service.stderr = (service.stderr + chunk.toString()).slice(-5000); });
  await spawned;
  service.pid = child.pid ?? 0;
  service.processPid = service.pid;
  assert(service.pid > 0, `Core process did not start: ${service.stderr}`);
  // BSD time may exec the core in place; GNU time may retain a parent process.
  for (let attempt = 0; attempt < 10; attempt++) {
    const found = Number(spawnSync('pgrep', ['-P', String(service.pid)], { encoding: 'utf8', timeout: 2000, maxBuffer: 4096 }).stdout?.trim().split(/\s+/)[0]);
    if (found > 0) { service.processPid = found; break; }
    await delay(20);
  }
  return service;
}

function invokeCli(environment: NodeJS.ProcessEnv, args: string[], timeout = 120_000): { elapsedMs: number; status: number | null; value: any; stderr: string } {
  const start = performance.now();
  const response = spawnSync(process.execPath, [cli, ...args], { env: environment, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const value = parseBenchmarkCliResponse(args.join(' '), response);
  return { elapsedMs: performance.now() - start, status: response.status, value, stderr: response.stderr };
}

const dateArgs = ['--since', '2026-09-29', '--until', '2026-09-30', '--timezone', 'UTC'];
function usage(environment: NodeJS.ProcessEnv, snapshotId?: string): { elapsedMs: number; value: any } {
  const args = ['usage', ...(snapshotId ? ['--snapshot', snapshotId] : ['--fresh']), ...dateArgs, '--json'];
  const start = performance.now();
  while (true) {
    const response = invokeCli(environment, args, 15_000);
    if (snapshotId) { assert.equal(response.status, 0); return { elapsedMs: performance.now() - start, value: response.value }; }
    if (isExpectedSyncTimeout(response.status, response.value)) {
      assert(performance.now() - start < 120_000, 'Usage sync exceeded 120 seconds');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      continue;
    }
    assert.equal(response.value.freshness.status, 'current');
    return { elapsedMs: performance.now() - start, value: response.value };
  }
}

function threadsPage(environment: NodeJS.ProcessEnv, offset: number, snapshotId?: string): { elapsedMs: number; value: any } {
  const args = ['threads', ...(snapshotId ? ['--snapshot', snapshotId] : ['--fresh']), '--sort', 'tokens', '--limit', '200', '--offset', String(offset), '--timezone', 'UTC', '--json'];
  const start = performance.now();
  while (true) {
    const response = invokeCli(environment, args, 15_000);
    if (snapshotId) { assert.equal(response.status, 0); return { elapsedMs: performance.now() - start, value: response.value }; }
    if (isExpectedSyncTimeout(response.status, response.value)) {
      assert(performance.now() - start < 120_000, 'Thread query sync exceeded 120 seconds');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      continue;
    }
    assert.equal(response.value.freshness.status, 'current');
    return { elapsedMs: performance.now() - start, value: response.value };
  }
}

function assertTruth(usageResult: any, expectedTokens: number, expectedCost: bigint): void {
  assert.equal(usageResult.summary.tokens.total, expectedTokens);
  assert.equal(moneyMicros(usageResult.summary.price.cost), expectedCost);
}

function assertUsageHierarchy(usageResult: any, expectedTokens: number, expectedCost: bigint): void {
  assertTruth(usageResult, expectedTokens, expectedCost);
  const subtotals = usageResult.items.filter((item: any) => item.isSubtotal);
  assert.equal(subtotals.reduce((sum: number, item: any) => sum + item.usage.tokens.total, 0), expectedTokens);
  assert.equal(subtotals.reduce((sum: bigint, item: any) => sum + moneyMicros(item.usage.price.cost), 0n), expectedCost);
}

function assertThreadHierarchy(environment: NodeJS.ProcessEnv, expectedTokens: number, expectedCost: bigint, snapshotId?: string): { pages: any[]; elapsedMs: number[] } {
  const pages: any[] = [], elapsedMs: number[] = [], seen = new Set<string>();
  let offset = 0, tokenTotal = 0, costTotal = 0n;
  do {
    const page = threadsPage(environment, offset, snapshotId);
    pages.push(page.value); elapsedMs.push(page.elapsedMs);
    assert.equal(page.value.page.total, threads);
    for (const item of page.value.items) {
      assert(!seen.has(item.id), `Duplicate thread ${item.id}`); seen.add(item.id);
      tokenTotal += item.threadUsage.tokens.total;
      costTotal += moneyMicros(item.threadUsage.price.cost);
    }
    const next = page.value.page.nextOffset;
    assert(next === null || (Number.isSafeInteger(next) && next > offset && next < threads), 'Thread pagination must advance within the corpus');
    offset = next;
  } while (offset !== null);
  assert.equal(seen.size, threads);
  assert.equal(tokenTotal, expectedTokens);
  assert.equal(costTotal, expectedCost);
  return { pages, elapsedMs };
}

function indexAndDisk(dataHome: string): { indexDbBytes: number; indexWalBytes: number; indexPayloads: ReturnType<typeof liveIndexPayloadFootprint>; dataDirectoryBytes: number } {
  const indexFile = path.join(dataHome, 'live-v2', 'index.sqlite');
  const size = (file: string) => existsSync(file) ? statSync(file).size : 0;
  return { indexDbBytes: size(indexFile), indexWalBytes: size(indexFile + '-wal'), indexPayloads: liveIndexPayloadFootprint(indexFile), dataDirectoryBytes: directoryBytes(dataHome) };
}

function cpuSeconds(pid: number): number {
  return run('ps', ['-o', 'time=', '-p', String(pid)]).stdout.trim().split(':').reverse().reduce((sum, part, index) => sum + Number(part) * 60 ** index, 0);
}

function processRssKiB(pid: number): number {
  return Number(run('ps', ['-o', 'rss=', '-p', String(pid)]).stdout.trim());
}

async function finishService(service: MeasuredService, idleStart: number): Promise<{ peakRssBytes: number; idleExitMs: number }> {
  const deadline = performance.now() + 25_000;
  while (service.child.exitCode === null && performance.now() < deadline) await delay(100);
  assert.equal(service.child.exitCode, 0, service.stderr || 'Service did not exit after idle timeout');
  await service.closed;
  const match = process.platform === 'darwin' ? /(?:^|\n)\s*(\d+)\s+maximum resident set size/.exec(service.stderr) : /WB_MAX_RSS_KIB=(\d+)/.exec(service.stderr);
  assert(match, 'time did not report peak RSS');
  return { peakRssBytes: Number(match[1]) * (process.platform === 'linux' ? 1024 : 1), idleExitMs: performance.now() - idleStart };
}

async function stopService(service: MeasuredService): Promise<void> {
  if (service.child.exitCode !== null || service.pid <= 0) return;
  const signal = (name: NodeJS.Signals) => {
    if (service.pid <= 0) return;
    try { process.kill(-service.pid, name); }
    catch { service.child.kill(name); }
  };
  signal('SIGTERM');
  await Promise.race([service.closed, delay(300)]);
  if (service.child.exitCode === null) signal('SIGKILL');
  if (service.child.exitCode === null) {
    const closed = await Promise.race([service.closed.then(() => true), delay(3000).then(() => false)]);
    assert(closed, 'Benchmark service did not close after process-group termination');
  }
}

async function writeCorpus(): Promise<void> {
  for (let index = 0; index < threads; index++) {
    const thread = `thread-${index}`;
    const file = path.join(source, 'sessions', `${index}.jsonl`);
    const stream = createWriteStream(file);
    for (const value of [{ type: 'session_meta', payload: { id: thread } }, { type: 'turn_context', payload: { turn_id: 'u', model: 'gpt-5.4', effort: 'high' } }]) stream.write(line(value));
    for (let j = index; j < measurements; j += threads) {
      for (const value of [record(thread, j), { type: 'response_item', payload: { type: 'function_call', name: 'read_file', call_id: String(j), arguments: 'SYNTHETIC_PRIVATE_ARGUMENT' } }]) stream.write(line(value));
    }
    await new Promise<void>((resolve, reject) => { stream.on('error', reject); stream.end(resolve); });
  }
}

function appendMeasurement(index: number): void {
  const file = path.join(source, 'sessions/0.jsonl');
  const handle = openSync(file, 'a');
  try { writeSync(handle, line(record('thread-0', `extra-${index}`))); fsyncSync(handle); } finally { closeSync(handle); }
}

try {
  await writeCorpus();
  const initialCorpus = sourceTreeIdentity(source);
  const sourceRevision = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
  const build = { profile: 'project-built release core and CLI bundle', coreSha256: fileSha256(core), cliSha256: fileSha256(cli), sourceRevision };
  const initialDataHome = path.join(temporary, 'data-initial');
  const firstService = await startService(initialDataHome);
  const cycles = BigInt(Math.floor(measurements / priceGroups)), groups = BigInt(priceGroups), remainder = BigInt(measurements % priceGroups);
  const groupSum = cycles * groups * (groups - 1n) / 2n + remainder * (remainder - 1n) / 2n;
  const baseCost = BigInt(measurements) * 265n + groupSum * 5n;
  const baseTokens = measurements * 110 + Number(groupSum * 2n);

  const coldStart = performance.now();
  const firstUsage = usage(firstService.environment);
  const coldSyncAndCliMs = performance.now() - coldStart;
  assertUsageHierarchy(firstUsage.value, baseTokens, baseCost);
  const warmCliMs = Array.from({ length: 5 }, () => usage(firstService.environment).elapsedMs);
  const appendSyncAndCliMs: number[] = [], appendRssKiB: number[] = [], appendSourceReports: any[] = [];
  for (let index = 0; index < appends; index++) {
    appendMeasurement(index);
    const current = usage(firstService.environment);
    appendSyncAndCliMs.push(current.elapsedMs);
    appendSourceReports.push(current.value.quality.sources);
    assertUsageHierarchy(current.value, baseTokens + (index + 1) * 110, baseCost + BigInt(index + 1) * 265n);
    appendRssKiB.push(processRssKiB(firstService.processPid));
  }

  const appendedCorpus = sourceTreeIdentity(source);
  const totalTokens = baseTokens + appends * 110;
  const totalCost = baseCost + BigInt(appends) * 265n;
  const appendedUsage = usage(firstService.environment);
  assertUsageHierarchy(appendedUsage.value, totalTokens, totalCost);
  const liveThreads = assertThreadHierarchy(firstService.environment, totalTokens, totalCost);
  const finalOracle = {
    usage: normalizeUsageOracle(appendedUsage.value),
    threads: liveThreads.pages.map(normalizeUsageOracle),
  };

  const fixedSnapshotStart = performance.now();
  const fixedSnapshotResponse = invokeCli(firstService.environment, ['refresh', '--root', source, '--json']);
  assert.equal(fixedSnapshotResponse.status, 0);
  const fixedSnapshotRefreshMs = performance.now() - fixedSnapshotStart;
  const snapshotId = fixedSnapshotResponse.value.snapshotRef.snapshotId as string;
  assert(snapshotId, 'Refresh did not return a saved snapshot id');
  assert.equal(sourceTreeIdentity(source).sha256, appendedCorpus.sha256, 'Source changed while saving fixed snapshot');
  const snapshotDirectory = path.join(initialDataHome, 'usage-v4', 'generations', snapshotId, 'committed');
  const fixedSnapshotBytes = snapshotFootprint(snapshotDirectory);
  const liveIdleStart = performance.now(), liveCpuStart = cpuSeconds(firstService.processPid);
  await delay(5000);
  const liveFinalRssKiB = processRssKiB(firstService.processPid);
  const liveIdleCpuPercent = 100 * (cpuSeconds(firstService.processPid) - liveCpuStart) / ((performance.now() - liveIdleStart) / 1000);
  const liveSpaceBeforeExit = indexAndDisk(initialDataHome);
  const firstExit = await finishService(firstService, liveIdleStart);
  const initialDataBytesAfterIdleExit = directoryBytes(initialDataHome);

  // Fixed queries use separate core processes and may outlast the live daemon's
  // idle lifetime. Finish live-process measurements before those offline reads.
  const fixedUsageStart = performance.now();
  const fixedUsage = usage(firstService.environment, snapshotId);
  const fixedThreads = assertThreadHierarchy(firstService.environment, totalTokens, totalCost, snapshotId);
  const fixedSnapshotQueryMs = performance.now() - fixedUsageStart;
  assertUsageHierarchy(fixedUsage.value, totalTokens, totalCost);
  assert.deepEqual(normalizeUsageOracle(fixedUsage.value), finalOracle.usage, 'Fixed snapshot usage differs from appended live usage');
  assert.deepEqual(fixedThreads.pages.map(normalizeUsageOracle), finalOracle.threads, 'Fixed snapshot thread hierarchy differs from appended live hierarchy');

  // Rebuild from the exact appended corpus in a never-used data home, after the first daemon exited.
  const rebuildDataHome = path.join(temporary, 'data-rebuild');
  assert(!existsSync(rebuildDataHome), 'Rebuild data home must be new');
  const rebuildService = await startService(rebuildDataHome);
  const rebuildStart = performance.now();
  const rebuiltUsage = usage(rebuildService.environment);
  const coldRebuildSyncAndCliMs = performance.now() - rebuildStart;
  assertUsageHierarchy(rebuiltUsage.value, totalTokens, totalCost);
  const rebuiltThreads = assertThreadHierarchy(rebuildService.environment, totalTokens, totalCost);
  assert.deepEqual(normalizeUsageOracle(rebuiltUsage.value), finalOracle.usage, 'Cold rebuild usage differs from appended live usage');
  assert.deepEqual(rebuiltThreads.pages.map(normalizeUsageOracle), finalOracle.threads, 'Cold rebuild hierarchy differs from appended live hierarchy');
  assert.deepEqual(sourceTreeIdentity(source), appendedCorpus, 'Synthetic source changed during cold rebuild');
  const rebuildIdleStart = performance.now(), rebuildCpuStart = cpuSeconds(rebuildService.processPid);
  await delay(5000);
  const rebuildFinalRssKiB = processRssKiB(rebuildService.processPid);
  const rebuildIdleCpuPercent = 100 * (cpuSeconds(rebuildService.processPid) - rebuildCpuStart) / ((performance.now() - rebuildIdleStart) / 1000);
  const rebuildSpaceBeforeExit = indexAndDisk(rebuildDataHome);
  const rebuildExit = await finishService(rebuildService, rebuildIdleStart);
  const rebuildDataBytesAfterIdleExit = directoryBytes(rebuildDataHome);

  assert.deepEqual({ coreSha256: fileSha256(core), cliSha256: fileSha256(cli) }, { coreSha256: build.coreSha256, cliSha256: build.cliSha256 }, 'Build changed during benchmark');
  const result = {
    benchmark: 'live-index-cold-append-rebuild',
    generatedAt: new Date().toISOString(),
    platform: `${os.type()} ${os.arch()}`,
    nodeVersion: process.version,
    build,
    environment: { WOMBAT_AUTO_PRICES: '0', caches: 'filesystem caches uncontrolled; no physical-cache cold claim' },
    corpus: {
      initial: { ...initialCorpus },
      afterAppend: { ...appendedCorpus },
      sourceBytesStableDuringSnapshotAndRebuild: true,
      appendedSourceReusedForColdRebuild: true,
      measurements, operations: measurements, threads, appends, priceGroups,
    },
    expectedTruth: { tokens: totalTokens, costUsd: formatMicros(totalCost), appendEach: { tokens: 110, costUsd: formatMicros(265n) } },
    sourceReports: {
      coldInitial: firstUsage.value.quality.sources,
      appendPasses: appendSourceReports,
      appendedLive: appendedUsage.value.quality.sources,
      fixedSnapshotRefresh: fixedSnapshotResponse.value.quality.sources,
      fixedSnapshotRead: fixedUsage.value.quality.sources,
      coldRebuild: rebuiltUsage.value.quality.sources,
      interpretation: 'Raw reports preserve source identity, versions, status and issues. filesRead/bytesRead reflect work of the specific collection pass, so oracle normalization omits only those two fields while still comparing all source outcome fields.',
    },
    coldInitial: { syncAndCliMs: Math.round(coldSyncAndCliMs * 100) / 100, warmCliMs: warmCliMs.map(value => Math.round(value * 100) / 100) },
    append: { syncAndCliMs: appendSyncAndCliMs.map(value => Math.round(value * 100) / 100), rssKiB: appendRssKiB },
    fixedSnapshot: {
      id: snapshotId,
      refreshMs: Math.round(fixedSnapshotRefreshMs * 100) / 100,
      queryMs: Math.round(fixedSnapshotQueryMs * 100) / 100,
      footprint: fixedSnapshotBytes,
      footprintMeaning: 'Logical file lengths for manifest, ledger and event/thread shards. These files are included in overall data-home bytes and are not additional disk allocation.',
      usageAndThreadOracleMatchesAppendedLive: true,
    },
    liveIndex: {
      databaseBytesBeforeIdleExit: liveSpaceBeforeExit.indexDbBytes,
      walBytesBeforeIdleExit: liveSpaceBeforeExit.indexWalBytes,
      dataHomeBytesBeforeIdleExit: liveSpaceBeforeExit.dataDirectoryBytes,
      payloads: liveSpaceBeforeExit.indexPayloads,
      payloadMeaning: 'Stored JSONB payload bytes belong to parser rows; expanded JSON bytes include projection-referenced payloads. Both are logical row payload measures, not additional disk usage or a row allocation of SQLite pages.',
      peakRssBytes: firstExit.peakRssBytes,
      rssKiBAtEnd: liveFinalRssKiB,
      dataHomeBytesAfterIdleExit: initialDataBytesAfterIdleExit,
      idleCpuPercentOver5s: Math.round(liveIdleCpuPercent * 1000) / 1000,
      idleExitMs: Math.round(firstExit.idleExitMs * 100) / 100,
    },
    coldRebuild: {
      dataHome: 'independent fresh synthetic directory',
      syncAndCliMs: Math.round(coldRebuildSyncAndCliMs * 100) / 100,
      databaseBytesBeforeIdleExit: rebuildSpaceBeforeExit.indexDbBytes,
      walBytesBeforeIdleExit: rebuildSpaceBeforeExit.indexWalBytes,
      dataHomeBytesBeforeIdleExit: rebuildSpaceBeforeExit.dataDirectoryBytes,
      payloads: rebuildSpaceBeforeExit.indexPayloads,
      peakRssBytes: rebuildExit.peakRssBytes,
      rssKiBAtEnd: rebuildFinalRssKiB,
      dataHomeBytesAfterIdleExit: rebuildDataBytesAfterIdleExit,
      idleCpuPercentOver5s: Math.round(rebuildIdleCpuPercent * 1000) / 1000,
      idleExitMs: Math.round(rebuildExit.idleExitMs * 100) / 100,
      usageAndThreadOracleMatchesAppendedLive: true,
    },
    consistency: {
      initialTruthPassed: true,
      eachAppendConserved: true,
      usageDailySubtotalsConserved: true,
      threadPagesAndAmountsConserved: true,
      fixedSnapshotMatches: true,
      coldRebuildMatches: true,
      oracleMeaning: 'Compares output business fields and source occurrence times, including summaries, prices, rows, quality and pagination totals; excludes changing snapshot/freshness/capture headers only.',
    },
    scope: 'Synthetic data only. Service peak RSS comes from /usr/bin/time for each daemon; file lengths are logical sizes, not allocated filesystem blocks. The saved fixed snapshot is measured separately from live sync timings. This tool does not claim filesystem-cache-cold latency, 24-hour operation, or completion of the full U19 acceptance matrix.',
  };
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output, build, corpus: result.corpus, expectedTruth: result.expectedTruth, coldInitial: result.coldInitial, append: result.append, fixedSnapshot: result.fixedSnapshot, coldRebuild: result.coldRebuild }));
} finally {
  const cleanup = await Promise.allSettled(services.map(stopService));
  const failures = cleanup.filter(result => result.status === 'rejected');
  assert.equal(failures.length, 0, 'Benchmark process cleanup failed; temporary evidence retained');
  rmSync(temporary, { recursive: true, force: true });
}
