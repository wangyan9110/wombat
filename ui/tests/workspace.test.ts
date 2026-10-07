import { withTokenAnalysis } from '../../tests/fixtures/token-analysis.js';
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
    summary: withTokenAnalysis({ measurementCount:1, tokens: { total: revision === 'live:one' ? 330 : 660 } }),
    items: [{ kind: 'usage', isSubtotal: true }],
    page: { offset: q.offset ?? 0, limit: q.limit ?? 1, total: 10000, nextOffset: (q.offset ?? 0) + (q.limit ?? 1) },
    freshness: { status: 'current', revision },
  } as UsageResult);
  const client = { live: async ({ query }: { query: UsageRequest }, options: QueryOptions = {}) => {
    calls.push(query); await intercept(query, options); return { result: result(query) };
  } } as UsageClient;
  return { client, calls, revise: () => { revision = 'live:two'; }, intercept: (f: typeof intercept) => { intercept = f; } };
}

test('completed projects remain readable while successive project batches advance', async t => {
  const f = fixture(), original = f.client.live!;
  let restoring = true;
  f.client.live = async (request, options) => {
    const response = await original(request, options);
    response.result.freshness = { ...response.result.freshness!, projectLoads: restoring ? [
      {project:'/synthetic/a',state:'ready'}, {project:'/synthetic/b',state:'loading'},
    ] : [] };
    return response;
  };
  const w = new Workspace(f.client); t.after(() => w.stop());
  const selected = {...route(),page:'threads' as const,project:'/synthetic/a',thread:'loaded-task'};
  await w.navigate(selected); w.setReading(true);
  restoring=false; f.revise(); await w.check();
  assert.equal(w.getSnapshot().data?.list.snapshotRef.snapshotId,'live:two');
  assert.equal(w.getSnapshot().data?.route.thread,'loaded-task');
  assert.equal(w.getSnapshot().updatesAvailable,false);
});

test('initial task results advance to the completed ledger while preserving the opened task', async t => {
  const f = fixture();
  const live = f.client.live!;
  let initial = true;
  f.client.live = async (request, options) => {
    const response = await live(request, options);
    response.result.freshness = { ...response.result.freshness!, initialScan: initial };
    return response;
  };
  const w = new Workspace(f.client); t.after(() => w.stop());
  const selected = { ...route(), page:'threads' as const, thread:'stable-task', search:'task' };
  await w.navigate(selected); w.setReading(true);
  assert.equal(w.getSnapshot().data?.freshness?.initialScan, true);
  initial = false; f.revise(); await w.check();
  assert.equal(w.getSnapshot().data?.list.snapshotRef.snapshotId, 'live:two');
  assert.equal(w.getSnapshot().data?.route.thread, 'stable-task');
  assert.equal(w.getSnapshot().data?.route.search, 'task');
  assert.equal(w.getSnapshot().updatesAvailable, false);
});

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
  f.intercept(async q => { if (!q.snapshotId) throw new CoreError('SYNC_PENDING', 'syncing'); });
  await w.check();
  assert.equal(w.getSnapshot().error, '');assert.equal(w.getSnapshot().pending,true);
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
    response.result.distribution = {tokenBasis:'analyzed_totals',maxTokens:660} as UsageResult['distribution'];
    response.result.items = [{kind:'usage',isSubtotal:true,scope:{},usage:withTokenAnalysis({measurementCount:1,tokens:{total:tokens}})}] as UsageResult['items'];
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
  await w.navigate({ ...route(), page: 'instructions' });
  await w.navigate({ ...route(), page: 'extensions' });
  assert.equal(f.calls.length, 0);
  await w.navigate({ ...route(), page: 'threads', snapshot: 'live:one' });
  assert(f.calls.every(q => q.snapshotId === 'live:one'));
  f.calls.length = 0; f.revise();
  await w.navigate({ ...route(), page: 'threads', snapshot: 'live:one', thread: 't' });
  assert(f.calls.every(q => q.snapshotId === 'live:one'));
});

test('first synchronization stays pending, keeps its elapsed origin and cancel cannot invent results',async t=>{
 const f=fixture(),w=new Workspace(f.client);t.after(()=>w.stop());
 f.intercept(async()=>{throw new CoreError('SYNC_PENDING','pending');});
 await w.navigate(route());const started=w.getSnapshot().waitingSince;
 assert.equal(w.getSnapshot().pending,true);assert.equal(w.getSnapshot().error,'');assert.equal(w.getSnapshot().data,undefined);
 await w.check();assert.equal(w.getSnapshot().waitingSince,started);
 w.cancel();assert.equal(w.getSnapshot().data,undefined);assert.equal(w.getSnapshot().pending,false);
 f.intercept(async()=>{});await w.check();assert.equal(w.getSnapshot().data,undefined);
 await w.navigate(route());assert.equal(w.getSnapshot().data?.overview.snapshotRef.snapshotId,'live:one');
});
test('source freshness remains separate from fixed subpage results and failures preserve usable ledger',async t=>{
 const f=fixture();let status='syncing';
 const client={...f.client,live:async(r:Parameters<NonNullable<UsageClient['live']>>[0],options:QueryOptions)=>{
  const response=await f.client.live!(r,options);
  response.freshness={status:r.query.snapshotId?'fixed':status,revision:'live:one',checkedAt:'2026-10-01T00:00:00Z'};
  return response;
 }} as UsageClient;
 const w=new Workspace(client);t.after(()=>w.stop());await w.navigate(route());
 assert.equal(w.getSnapshot().data?.overview.freshness?.status,'fixed');assert.equal(w.getSnapshot().data?.freshness?.status,'syncing');
 status='failed';await w.check();assert.equal(w.getSnapshot().data?.freshness?.status,'failed');assert.equal(w.getSnapshot().error,'');
 assert.equal(w.getSnapshot().data?.overview.summary.tokens.total,330);
});

test('a pending new scope is retried even when the committed global revision is unchanged',async t=>{
 const f=fixture(),w=new Workspace(f.client);t.after(()=>w.stop());await w.navigate(route());
 let pending=true;f.intercept(async q=>{if(pending&&q.scope?.model==='new')throw new CoreError('SYNC_PENDING','pending');});
 await w.navigate({...route(),model:'new'});assert.equal(w.getSnapshot().pending,true);assert.equal(w.getSnapshot().data?.route.model,undefined);
 pending=false;await w.check();assert.equal(w.getSnapshot().data?.route.model,'new');assert.equal(w.getSnapshot().pending,false);
});
test('successful-read time stays attached to retained data through failed updates',async()=>{
 const f=fixture(),workspace=new Workspace(f.client,60_000);
 try{await workspace.navigate(route());const first=workspace.getSnapshot().data!;assert.ok(first.readAt);f.intercept(async()=>{throw new CoreError('NETWORK','failed');});await workspace.check();assert.equal(workspace.getSnapshot().data,first);assert.equal(workspace.getSnapshot().data!.readAt,first.readAt);}finally{workspace.stop();}
});
