import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute,routeSearch,scopeOf,shiftDate,readUsage } from '../src/state.js';
import type {UsageClient,UsageResult} from '@wombat/client';
test('URL restores selection and filters; inclusive dates convert across DST without changing periods',()=>{
 const r=parseRoute('?page=threads&since=2026-03-08&until=2026-03-09&timezone=America%2FNew_York&project=%2Fproject&thread=a%2Fb&turn=t&offset=20&group=week&model=m&sort=cost');
 assert.deepEqual(parseRoute(routeSearch(r)),r);
 assert.equal(scopeOf(r).until,'2026-03-10');assert.equal(shiftDate('2026-12-31',1),'2027-01-01');
 assert.deepEqual(scopeOf({...r,group:'month'}),scopeOf(r));
 assert.equal(parseRoute('?offset=1.5').offset,1);assert.equal(parseRoute('?timezone=bad').timezone,'UTC');
 assert.equal(parseRoute('?since=2026-02-30',new Date('2026-10-01T00:00:00Z')).since,'2026-09-02');
});
test('live views use the live transport in cached mode; fixed snapshots stay offline',async()=>{
 const calls:unknown[]=[];const result={} as UsageResult;
 const client={query:async(q:unknown)=>{calls.push(q);return result;},live:async(q:unknown)=>{calls.push(q);return {result};}} as unknown as UsageClient;
 await readUsage(client,{action:'threads',snapshotId:'live:v1'});
 assert.deepEqual(calls.pop(),{query:{action:'threads',snapshotId:'live:v1'},mode:'cached'});
 await readUsage(client,{action:'usage',snapshotId:'saved-v1'});assert.deepEqual(calls.pop(),{action:'usage',snapshotId:'saved-v1'});
 result.freshness={status:'failed',revision:'old',error:'synthetic source unavailable'};
 await assert.rejects(readUsage(client,{action:'usage'}),{code:'STALE_RESULT'});
});
