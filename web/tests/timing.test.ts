import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { CoreError, type TimingRequest, type UsageClient, type UsageResult } from '@wombat/client';
import { createHttpClient } from '@wombat/client/http';
import { startWebHost } from '../src/index.js';
import { publishTiming, timingAccess } from '../src/timing.js';
import { capabilityResult, local, share } from './fixtures/timing.js';
const summary: TimingRequest = { action: 'summary', threadId: 'thread', turnId: 'turn', snapshotId: local.readView.snapshotId, scope: { sourceInstanceId: 'source' } };
const usage = (snapshotId = local.readView.snapshotId): UsageResult => ({
  outputVersion: 3, action: 'usage', snapshotRef: { snapshotId, createdAt: local.readView.createdAt }, scope: {}, availableRange: {},
  summary: { tokens: { input: 10, output: 2, total: 12 }, measurementCount: 1,
    price: { currency: 'USD', policy: 'synthetic', priceRevision: 'synthetic', cost: '0.1', knownCost: '0.1', status: 'priced', components: [], basis: [], issues: [] } },
  items: [], page: { offset: 0, limit: 50, total: 0 }, quality: { status: 'complete', issues: [], sources: [] },
});
async function fixture(patch: Partial<UsageClient> = {}) {
  const assets = await mkdtemp(path.join(tmpdir(), 'wombat-web-timing-'));
  await writeFile(path.join(assets, 'index.html'), '<title>synthetic</title>');
  const forbidden = async () => { throw new Error('Unrelated product called'); };
  const client: UsageClient = { query: async () => usage(), prices: forbidden, config: forbidden, optimize: forbidden,
    account: forbidden, handoff: forbidden, live: forbidden,
    timing: async request => request.action === 'capabilities' ? capabilityResult : request.action === 'evidence' ? {
      outputVersion: 1, action: 'evidence', methodVersion: local.methodVersion, profile: 'local', snapshotId: request.snapshotId,
      scope: local.scope, total: { value: 0, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] }, rows: [],
    } : request.privacyProfile === 'share-v1' ? share : local, ...patch };
  const host = await startWebHost({ client, assets, roots: ['/synthetic/source'], projectRoots: ['/synthetic/project'], automaticPrices: false });
  const token = new URLSearchParams(new URL(host.url).hash.slice(1)).get('token')!;
  const headers = { Origin: host.origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (payload: unknown, patch: Record<string, string> = {}) => fetch(host.origin + '/api/timing', { method: 'POST', headers: { ...headers, ...patch }, body: JSON.stringify(payload) });
  const browser = createHttpClient({ origin: host.origin, token, fetch: (input, init) => fetch(input, { ...init, headers: { ...init?.headers, Origin: host.origin } }) });
  return { host, browser, post, headers, close: async () => { await host.close(); await rm(assets, { recursive: true }); } };
}
function deferred<T>() { let resolve!: (value: T | PromiseLike<T>) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

test('timing route inherits token origin host JSON POST and NDJSON checks', async () => {
  let calls = 0;
  const f = await fixture({ timing: async () => { calls++; return capabilityResult; } });
  try {
    for (const headers of [{ Authorization: '' }, { Origin: '' }, { Origin: 'https://foreign.invalid' }])
      assert.equal((await f.post({ action: 'capabilities' }, headers)).status, 403);
    const status = await new Promise<number>(resolve => {
      const req = httpRequest(f.host.origin + '/api/timing', { method: 'POST', headers: { ...f.headers, Host: 'foreign.invalid' } }, res => { res.resume(); resolve(res.statusCode!); }); req.end('{"action":"capabilities"}');
    });
    assert.equal(status, 403);
    assert.equal((await fetch(f.host.origin + '/api/timing', { headers: f.headers })).status, 405);
    assert.equal((await f.post({ action: 'capabilities' }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await f.post({ oversized: 'x'.repeat(65 * 1024) })).status, 413);
    assert.equal(calls, 0);
    const result = await f.post({ action: 'capabilities' });
    assert.match(result.headers.get('content-type')!, /application\/x-ndjson/);
    assert.deepEqual(JSON.parse((await result.text()).trim()), { type: 'result', value: capabilityResult });
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('summary and evidence require an issued fixed identity and never accept browser paths', async () => {
  const requests: TimingRequest[] = [];
  const f = await fixture({ timing: async (request, options) => { requests.push(request); options?.onProgress?.('synthetic-timing'); return local; } });
  try {
    await assert.rejects(f.browser.timing!(summary), { code: 'INVALID_ARGUMENT' });
    await f.browser.query({ action: 'usage' });
    for (const payload of [
      { action: 'summary', threadId: 'thread', turnId: 'turn' },
      { ...summary, snapshotId: '/foreign/snapshot.json' }, { ...summary, roots: [] }, { ...summary, roots: ['/foreign'] },
      { ...summary, projectRoots: ['/foreign'] }, { ...summary, snapshotPath: '/foreign' },
      { action: 'capabilities', roots: [] }, { ...summary, scope: { project: '/historical/cwd' } },
    ]) assert.match(await (await f.post(payload)).text(), /INVALID_ARGUMENT/);
    assert.equal(requests.length, 0);
    const stages: string[] = [];
    assert.deepEqual(await f.browser.timing!(summary, { onProgress: stage => stages.push(stage) }), local);
    assert.deepEqual(requests, [{ ...summary, roots: ['/synthetic/source'] }]);
    assert.deepEqual(stages, ['synthetic-timing']);
  } finally { await f.close(); }
});

test('capabilities performs no selection and optional timing absence is explicit', async () => {
  const requests: TimingRequest[] = [];
  const f = await fixture({ directories: async () => { throw new Error('Capabilities cannot read directory grants'); }, timing: async request => { requests.push(request); return capabilityResult; } });
  try {
    await f.browser.timing!({ action: 'capabilities' });
    assert.deepEqual(requests, [{ action: 'capabilities' }]);
  } finally { await f.close(); }
  const absent = await fixture({ timing: undefined });
  try { await assert.rejects(absent.browser.timing!({ action: 'capabilities' }), { code: 'TIMING_UNAVAILABLE' }); }
  finally { await absent.close(); }
});

test('core expiry and source target errors propagate without loading any other product', async () => {
  let queries = 0, timings = 0;
  const f = await fixture({ query: async () => { queries++; return usage(); }, timing: async request => {
    timings++; assert.equal(request.action, 'summary');
    if (request.action !== 'summary') throw new Error('Unexpected action');
    assert.equal(request.snapshotId, summary.snapshotId);
    assert.deepEqual(request.roots, ['/synthetic/source']);
    throw new CoreError(request.scope?.sourceInstanceId === 'foreign' ? 'NOT_FOUND' : 'VIEW_EXPIRED', 'Synthetic fixed view failure');
  } });
  try {
    await f.browser.query({ action: 'usage' });
    await assert.rejects(f.browser.timing!(summary), { code: 'VIEW_EXPIRED' });
    await assert.rejects(f.browser.timing!({ ...summary, scope: { sourceInstanceId: 'foreign' } }), { code: 'NOT_FOUND' });
    assert.equal(queries, 1); assert.equal(timings, 2);
  } finally { await f.close(); }
});

test('evidence preserves pagination and sharing returns only the safe branch', async () => {
  const requests: TimingRequest[] = [];
  const f = await fixture({ timing: async request => {
    requests.push(request);
    if (request.action === 'summary') return share;
    if (request.action !== 'evidence') return capabilityResult;
    return { outputVersion: 1, action: 'evidence', methodVersion: local.methodVersion, profile: 'local',
      snapshotId: request.snapshotId, scope: local.scope, total: { value: 3, status: 'observed', basis: 'safe_event_count', evidenceRefs: [] }, rows: [], nextCursor: { token: 'synthetic-next' } };
  } });
  try {
    await f.browser.query({ action: 'usage' });
    const evidence: TimingRequest = { action: 'evidence', snapshotId: local.readView.snapshotId, threadId: 'thread', turnId: 'turn', scope: { sourceInstanceId: 'source' }, cursor: { token: 'synthetic-prior' }, limit: 200 };
    const result = await f.browser.timing!(evidence);
    assert.equal(result.action, 'evidence');
    assert.deepEqual(requests[0], { ...evidence, roots: ['/synthetic/source'] });
    const shared = await f.browser.timing!({ ...summary, privacyProfile: 'share-v1' });
    assert.deepEqual(shared, share); assert.equal('readView' in shared, false);
    await assert.rejects(f.browser.timing!({ ...evidence, privacyProfile: 'share-v1' }), { code: 'INVALID_ARGUMENT' });
    await assert.rejects(f.browser.timing!({ ...evidence, limit: 201 }), { code: 'INVALID_ARGUMENT' });
    assert.equal(requests.length, 2);
  } finally { await f.close(); }
});

test('published identity eviction retains the host bound of 128 for timing', async () => {
  let next = 0, calls = 0;
  const f = await fixture({ query: async () => usage(`live:scope:${next++}`), timing: async () => { calls++; return capabilityResult; } });
  try {
    for (let i = 0; i < 129; i++) await f.browser.query({ action: 'usage' });
    await assert.rejects(f.browser.timing!({ ...summary, snapshotId: 'live:scope:0' }), { code: 'INVALID_ARGUMENT' });
    assert.equal(calls, 0);
  } finally { await f.close(); }
  const issued = new Set<string>();
  publishTiming(share, issued); assert.equal(issued.size, 0);
  for (let i = 0; i < 129; i++) publishTiming({ ...local, readView: { ...local.readView, snapshotId: `synthetic:${i}` } }, issued);
  assert.equal(issued.size, 128); assert.equal(issued.has('synthetic:0'), false); assert.equal(issued.has('synthetic:128'), true);
});

test('authorization changes and aborted late replies cannot republish old identities', async () => {
  const issued = new Set([local.readView.snapshotId]); let calls = 0;
  const client: UsageClient = { query: async () => usage(), prices: async () => { throw new Error('No prices'); }, timing: async () => { calls++; return local; } };
  const revoked = timingAccess(client, issued, () => ['/synthetic/source'], async () => { issued.clear(); });
  await assert.rejects(revoked(summary), { code: 'VIEW_EXPIRED' }); assert.equal(calls, 0);
  issued.add(local.readView.snapshotId);
  const finish = deferred<void>(), started = deferred<void>(), controller = new AbortController();
  const slow = timingAccess({ ...client, timing: async () => { started.resolve(); await finish.promise; return local; } }, issued, () => ['/synthetic/source'], async () => {});
  const pending = slow(summary, { signal: controller.signal });
  await started.promise; issued.clear(); controller.abort(); finish.resolve();
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(issued.size, 0);
});

test('disconnect cancels one timing reader while another completes and late results are ignored', async () => {
  const ready = deferred<void>(), observedAbort = deferred<void>(), finish = deferred<void>(); let calls = 0;
  const f = await fixture({ timing: async (_request, options) => {
    if (++calls === 1) { ready.resolve(); options!.signal!.addEventListener('abort', () => observedAbort.resolve(), { once: true }); await finish.promise; }
    return local;
  } });
  try {
    await f.browser.query({ action: 'usage' });
    const controller = new AbortController();
    const pending = f.browser.timing!(summary, { signal: controller.signal });
    await ready.promise; controller.abort();
    await assert.rejects(pending, { code: 'CANCELLED' });
    await Promise.race([observedAbort.promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('No request cancellation')), 2000); timer.unref(); })]);
    assert.deepEqual(await f.browser.timing!(summary), local);
    finish.resolve(); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2);
  } finally { finish.resolve(); await f.close(); }
});
