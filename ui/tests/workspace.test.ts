import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreError, type UsageClient, type UsageRequest, type UsageResult, type QueryOptions } from '@wombat/client';
import { Workspace } from '../src/workspace.js';
import { parseRoute } from '../src/state.js';

const route = () => parseRoute('?page=usage&timezone=UTC&since=2026-09-01&until=2026-09-30');
function fixture() {
  let revision = 'live:one';
  const calls: UsageRequest[] = [];
  let intercept: (q: UsageRequest, options: QueryOptions) => Promise<void> = async () => {};
  const result = (q: UsageRequest): UsageResult => ({
    action: q.action, snapshotRef: { snapshotId: q.snapshotId ?? revision },
    summary: { tokens: { total: revision === 'live:one' ? 330 : 660 } },
    items: [{ kind: 'usage', isSubtotal: true }],
    page: { offset: q.offset ?? 0, limit: q.limit ?? 1, total: 10000, nextOffset: (q.offset ?? 0) + (q.limit ?? 1) },
    freshness: { status: 'current', revision },
  } as UsageResult);
  const client = { live: async ({ query }: { query: UsageRequest }, options: QueryOptions = {}) => {
    calls.push(query); await intercept(query, options); return { result: result(query) };
  } } as UsageClient;
  return { client, calls, revise: () => { revision = 'live:two'; }, intercept: (f: typeof intercept) => { intercept = f; } };
}

test('timer observes new revisions, unchanged probes do not reload pages, and no query drains pagination', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  await w.navigate(route());
  assert.equal(w.getSnapshot().data?.overview.summary.tokens.total, 330);
  assert.equal(f.calls.length, 3);
  await w.check(); assert.equal(f.calls.length, 4);
  f.revise();
  const updated = new Promise<void>(resolve => { const off = w.subscribe(() => {
    if (w.getSnapshot().data?.overview.summary.tokens.total === 660) { off(); resolve(); }
  }); });
  t.mock.timers.tick(3000); await updated;
  assert.equal(w.getSnapshot().data?.list.snapshotRef.snapshotId, 'live:two');
  assert(f.calls.every(q => (q.limit ?? 0) <= 120 && !q.offset && q.presentation !== 'details'));
});

test('list navigation reuses overview and conversations never fetch periods or all turns', async t => {
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  await w.navigate(route()); f.calls.length = 0;
  await w.navigate({ ...route(), offset: 20 });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].presentation, 'projects');
  f.calls.length = 0;
  await w.navigate({ ...route(), page: 'threads', search: 'needle', thread: 'id' });
  assert.deepEqual(f.calls.map(q => q.action), ['threads']);
  assert.equal(f.calls[0].limit, 10);
});

test('filters invalidate scoped pages even when the core revision is unchanged', async t => {
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  await w.navigate(route()); f.calls.length = 0;
  await w.navigate({ ...route(), model: 'gpt-5.4' });
  assert.equal(f.calls.length, 3);
  assert(f.calls.every(q => q.scope?.model === 'gpt-5.4'));
  assert.equal(w.getSnapshot().data?.route.model, 'gpt-5.4');
});

test('late completion from an aborted scope cannot replace the next scope', async t => {
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  let release!: () => void, signal: AbortSignal | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.intercept(async (q, options) => { if (q.scope?.model === 'slow') { signal = options.signal; await pending; } });
  const first = w.navigate({ ...route(), model: 'slow' });
  await w.navigate({ ...route(), model: 'fast' });
  assert(signal?.aborted); release(); await first;
  assert.equal(w.getSnapshot().data?.route.model, 'fast');
  assert.equal(w.getSnapshot().error, '');
});

test('expired versions are reobserved once and all replacement pages share the new version', async t => {
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  await w.navigate(route());
  f.revise();
  f.intercept(async q => { if (q.snapshotId === 'live:one') throw new CoreError('VIEW_EXPIRED', 'expired'); });
  await w.navigate({ ...route(), offset: 20 });
  assert(w.getSnapshot().renewed);
  assert.equal(w.getSnapshot().data?.overview.snapshotRef.snapshotId, 'live:two');
  assert.equal(w.getSnapshot().data?.list.snapshotRef.snapshotId, 'live:two');
});

test('pending synchronization is visible and automatically retried without losing previous data', async t => {
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  await w.navigate(route());
  f.intercept(async q => { if (!q.snapshotId) throw new CoreError('STALE_RESULT', 'syncing'); });
  await w.check();
  assert.equal(w.getSnapshot().error, 'syncing');
  assert.equal(w.getSnapshot().data?.overview.summary.tokens.total, 330);
  f.intercept(async () => {}); f.revise(); await w.check();
  assert.equal(w.getSnapshot().error, '');
  assert.equal(w.getSnapshot().data?.overview.summary.tokens.total, 660);
});

test('cancellation pauses polling and navigation explicitly resumes it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  await w.navigate(route()); w.cancel(); const count = f.calls.length;
  t.mock.timers.tick(10000); await w.check();
  assert.equal(f.calls.length, count); assert.equal(w.getSnapshot().error, 'CANCELLED');
  await w.navigate({ ...route(), model: 'm' });
  assert.equal(w.getSnapshot().error, '');
});

test('hidden workspaces stop observing and returning to the page catches up', async t => {
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  await w.navigate(route()); w.setVisible(false); const count = f.calls.length;
  f.revise(); await w.check(); assert.equal(f.calls.length, count);
  const updated = new Promise<void>(resolve => { const off = w.subscribe(() => {
    if (w.getSnapshot().data?.overview.summary.tokens.total === 660) { off(); resolve(); }
  }); });
  w.setVisible(true); await updated;
});

test('a trend page outside the peak retains the full-range peak through one bounded query', async t => {
  const f = fixture(), calls: UsageRequest[] = [];
  const client = { live: async (request: {query:UsageRequest}, options: QueryOptions) => {
    calls.push(request.query);
    const response = await f.client.live!(request, options);
    const tokens = request.query.sort === 'tokens' ? 660 : 110;
    response.result.distribution = {maxTokens:660} as UsageResult['distribution'];
    response.result.items = [{kind:'usage',isSubtotal:true,scope:{},usage:{tokens:{total:tokens}}}] as UsageResult['items'];
    return response;
  }} as UsageClient;
  const w=new Workspace(client); t.after(()=>w.stop());
  await w.navigate({...route(),periodOffset:120});
  assert.equal(w.getSnapshot().data?.overview.page.offset,120);
  assert.equal(w.getSnapshot().data?.peak?.items[0].kind,'usage');
  const peaks=calls.filter(q=>q.presentation==='distribution'&&q.sort==='tokens');
  assert.equal(peaks.length,1);assert.equal(peaks[0].limit,1);assert.equal(peaks[0].snapshotId,'live:one');
});

test('reading details queues new data until explicitly applied; conversations also stay pinned', async t => {
  for (const page of ['usage','threads'] as const) {
    const f=fixture(),w=new Workspace(f.client);t.after(()=>w.stop());
    await w.navigate({...route(),page});w.setReading(page==='usage');f.revise();
    await w.check();
    assert.equal(w.getSnapshot().data?.overview.snapshotRef.snapshotId,'live:one');
    assert.equal(w.getSnapshot().updatesAvailable,true);
    const updated=new Promise<void>(resolve=>{const off=w.subscribe(()=>{
      if(w.getSnapshot().data?.overview.snapshotRef.snapshotId==='live:two'){off();resolve();}
    });});
    w.refresh();await updated;
    assert.equal(w.getSnapshot().updatesAvailable,false);
  }
});

test('expired browser credentials stop polling and cannot enter a retry loop', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(),w=new Workspace(f.client);t.after(()=>w.stop());
  await w.navigate(route());
  f.intercept(async()=>{throw new CoreError('HTTP_403','HTTP 403');});
  await w.check();const count=f.calls.length;
  assert.equal(w.getSnapshot().errorCode,'HTTP_403');
  t.mock.timers.tick(10000);await w.check();w.refresh();await w.navigate({...route(),offset:20});
  assert.equal(f.calls.length,count);
});

test('configuration pages do not issue usage polls and evidence links retain their version', async t => {
  const f = fixture(), w = new Workspace(f.client); t.after(() => w.stop());
  await w.navigate({ ...route(), page: 'config' });
  assert.equal(f.calls.length, 0);
  await w.navigate({ ...route(), page: 'threads', snapshot: 'live:one' });
  assert(f.calls.every(q => q.snapshotId === 'live:one'));
  f.calls.length = 0; f.revise();
  await w.navigate({ ...route(), page: 'threads', snapshot: 'live:one', thread: 't' });
  assert(f.calls.every(q => q.snapshotId === 'live:one'));
});
