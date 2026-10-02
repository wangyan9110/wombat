import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { CoreError, type UsageClient, type UsageResult } from '@wombat/client';
import { createHttpClient } from '@wombat/client/http';
import { startWebHost } from '../src/index.js';

const response: UsageResult = {
  outputVersion: 3, action: 'usage', snapshotRef: { snapshotId: 'synthetic', createdAt: '2026-10-01T00:00:00Z' },
  scope: {}, availableRange: {}, summary: { tokens: { input: 10, output: 2, total: 12 }, measurementCount: 1,
    price: { currency: 'USD', policy: 'synthetic', priceRevision: 'synthetic', cost: '0.1', knownCost: '0.1', status: 'priced', components: [], basis: [], issues: [] } },
  items: [], page: { offset: 0, limit: 50, total: 0 }, quality: { status: 'complete', issues: [], sources: [] },
};
async function fixture(client: UsageClient) {
  const assets = await mkdtemp(path.join(tmpdir(), 'wombat-web-host-'));
  await writeFile(path.join(assets, 'index.html'), '<title>synthetic</title>');
  const host = await startWebHost({ client, assets, roots: ['/synthetic/scope'] });
  const token = new URLSearchParams(new URL(host.url).hash.slice(1)).get('token')!;
  const headers = { Origin: host.origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const send = (body = '{"action":"usage"}', patch: Record<string, string> = {}) => fetch(host.origin + '/api/query', { method: 'POST', headers: { ...headers, ...patch }, body });
  const browser = createHttpClient({ origin: host.origin, token, fetch: (input, init) => fetch(input, { ...init, headers: { ...init?.headers, Origin: host.origin } }) });
  return { host, headers, send, browser, close: async () => { await host.close(); await rm(assets, { recursive: true }); } };
}
const normal: UsageClient = { query: async () => response, prices: async () => { throw new CoreError('SYNTHETIC', 'Synthetic'); } };

test('host authenticates API, rejects foreign origins and hosts, and serves only build assets', async () => {
  let calls = 0;
  const f = await fixture({ ...normal, query: async () => { calls++; return response; } });
  try {
    for (const headers of [{ Authorization: '' }, { Origin: 'https://foreign.invalid' }, { Origin: '' }]) assert.equal((await f.send(undefined, headers)).status, 403);
    const status = await new Promise<number>(resolve => {
      const req = httpRequest(f.host.origin + '/', { headers: { Host: 'foreign.invalid' } }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
    });
    assert.equal(status, 403); assert.equal(calls, 0);
    const root = await fetch(f.host.origin);
    assert.equal(root.status, 200); assert.equal(root.headers.get('referrer-policy'), 'no-referrer');
    assert.match(root.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal((await fetch(f.host.origin + '/package.json')).status, 404);
    assert.equal((await f.send('{}', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await f.send('x'.repeat(65 * 1024))).status, 413);
    assert.equal((await f.send('{')).status, 400);
    assert.match(await (await f.send('{"action":"shell"}')).text(), /INVALID_ARGUMENT/);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test('browser transport preserves DTOs, progress, fixed scope and issued snapshots', async () => {
  const requests: unknown[] = [], stages: string[] = [];
  const f = await fixture({ ...normal, query: async (request, options) => { requests.push(request); options?.onProgress?.('synthetic-stage'); return response; } });
  try {
    assert.deepEqual(await f.browser.query({ action: 'usage' }, { onProgress: s => stages.push(s) }), response);
    assert.deepEqual(stages, ['synthetic-stage']);
    assert.deepEqual(requests, [{ action: 'usage', roots: ['/synthetic/scope'] }]);
    await f.browser.query({ action: 'usage', snapshotId: 'synthetic' });
    assert.deepEqual(requests[1], { action: 'usage', snapshotId: 'synthetic', roots: undefined });
    await assert.rejects(f.browser.query({ action: 'usage', roots: ['/foreign'] }), /fixed at startup/);
    await assert.rejects(f.browser.query({ action: 'usage', snapshotId: '/foreign/snapshot' }), /fixed at startup/);
    await assert.rejects(f.browser.prices({ action: 'status' }), (error: unknown) => error instanceof CoreError && error.code === 'SYNTHETIC');
    assert.equal(requests.length, 2);
  } finally { await f.close(); }
});

test('disconnect and shutdown cancel active core work', async () => {
  let started!: () => void, cancelled!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const f = await fixture({ ...normal, query: async (_request, options) => {
    started(); await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => { cancelled(); resolve(); }, { once: true }));
    throw new CoreError('CANCELLED', 'Cancelled');
  } });
  try {
    const abort = new AbortController();
    const pending = f.browser.query({ action: 'usage' }, { signal: abort.signal });
    await ready; abort.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof CoreError && error.code === 'CANCELLED');
    await Promise.race([aborted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('No cancellation')), 2000); timer.unref(); })]);
  } finally { await f.close(); }
});

test('host bounds concurrency and shutdown closes all active requests', async () => {
  let started = 0, cancelled = 0;
  let ready!: () => void; const allStarted = new Promise<void>(resolve => { ready = resolve; });
  const f = await fixture({ ...normal, query: async (_request, options) => {
    if (++started === 8) ready();
    await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => { cancelled++; resolve(); }, { once: true }));
    throw new CoreError('CANCELLED', 'Cancelled');
  } });
  try {
    const requests = Array.from({ length: 8 }, () => f.send().catch(() => undefined));
    await allStarted; assert.equal((await f.send()).status, 429);
    await f.host.close(); await Promise.all(requests); assert.equal(cancelled, 8);
  } finally { await f.close(); }
});

test('automatic prices return the first ledger promptly, share one flight and retain fixed revisions', async () => {
  let calls=0,finish!:(value:import('@wombat/client').PricingResult)=>void;
  const delayed=new Promise<import('@wombat/client').PricingResult>(resolve=>{finish=resolve;});
  const ledger={...response,snapshotRef:{...response.snapshotRef,snapshotId:'live:one'},summary:{...response.summary,price:{...response.summary.price,issues:['catalogPriceMissing']}}};
  const f=await fixture({...normal,live:async()=>({outputVersion:1,result:ledger,freshness:{status:'current',revision:'live:one'}}),prices:async()=>{calls++;return delayed;}});
  try{
    const deadline=new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Initial usage waited for prices')),1000);timer.unref();});
    const values=await Promise.race([Promise.all([f.browser.live!({query:{action:'usage'}}),f.browser.live!({query:{action:'usage'}})]),deadline]);
    assert.equal(calls,1);assert.equal(values[0].result.summary.tokens.total,12);
    assert.equal(values[0].result.priceUpdate,undefined);
    finish({outputVersion:1,action:'auto_update',origin:'bundled',updated:true,source:'synthetic',catalogHash:'new',catalog:{revision:'new',verifiedAt:'synthetic',policy:'synthetic',currency:'USD',models:[]},automatic:{status:'updated',attemptId:'synthetic',attemptedAt:new Date().toISOString(),retryAt:new Date(Date.now()+86400_000).toISOString()}});
    await new Promise(resolve=>setImmediate(resolve));
    const fixed=await f.browser.live!({query:{action:'usage',snapshotId:'live:one'},mode:'cached'});
    assert.equal(fixed.result.priceUpdate,undefined);
    const live=await f.browser.live!({query:{action:'usage'}});
    assert.equal(live.result.priceUpdate?.status,'updated');assert.equal(calls,1);
    assert.equal(live.result.snapshotRef.snapshotId,'live:one');assert.equal(ledger.priceUpdate,undefined);
  }finally{await f.close();}
});

test('closing the host cancels shared automatic prices; cancelling a page wait does not',async()=>{
 let priceSignal:AbortSignal|undefined,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const ledger={...response,snapshotRef:{...response.snapshotRef,snapshotId:'live:one'},summary:{...response.summary,price:{...response.summary.price,issues:['catalogPriceMissing']}}};
 const f=await fixture({...normal,live:async()=>({outputVersion:1,result:ledger,freshness:{status:'current',revision:'live:one'}}),prices:async(_,options)=>{
  priceSignal=options?.signal;started();await new Promise<void>(resolve=>priceSignal!.addEventListener('abort',()=>resolve(),{once:true}));throw new CoreError('CANCELLED','Cancelled');
 }});
 try{
  const page=new AbortController();await f.browser.live!({query:{action:'usage'}},{signal:page.signal});await ready;
  page.abort();assert.equal(priceSignal?.aborted,false);await f.host.close();assert.equal(priceSignal?.aborted,true);
 }finally{await f.close();}
});

test('price failures are exposed on subsequent live queries without an immediate retry storm',async()=>{
 let calls=0;const ledger={...response,summary:{...response.summary,price:{...response.summary.price,issues:['catalogPriceMissing']}}};
 const f=await fixture({...normal,live:async()=>({outputVersion:1,result:ledger,freshness:{status:'current',revision:'synthetic'}}),prices:async()=>{calls++;throw new CoreError('PRICE_NETWORK','Synthetic unavailable');}});
 try{
  await f.browser.live!({query:{action:'usage'}});await new Promise(resolve=>setImmediate(resolve));
  const next=await f.browser.live!({query:{action:'usage'}});
  assert.equal(next.result.priceUpdate?.status,'failed');assert.equal(next.result.priceUpdate?.errorCode,'PRICE_NETWORK');assert.equal(calls,1);
 }finally{await f.close();}
});
