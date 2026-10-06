import test from 'node:test';
import assert from 'node:assert/strict';
import {activityAccess} from '../src/timing.js';
import {activityResult} from '../../tests/fixtures/activity.js';
import type {OptimizeRequest,UsageClient} from '@wombat/client';
const request:OptimizeRequest={action:'activity',activity:{snapshotId:'live:synthetic:fixed',threadId:'task',turnId:'turn'}};
test('activity access uses published fixed views and revalidates grants around the read',async()=>{
 const published=new Set(['live:synthetic:fixed']);const calls:OptimizeRequest[]=[];
 const client:UsageClient={query:async()=>{throw Error('No scan');},optimize:async input=>{calls.push(input);return activityResult();}};
 const read=activityAccess(client,published,()=>['/synthetic/logs'],async()=>{});
 await assert.rejects(read({...request,activity:{...request.activity!,snapshotId:'arbitrary'}}),{code:'INVALID_ARGUMENT'});
 await assert.rejects(read({...request,roots:['/arbitrary']}),{code:'INVALID_ARGUMENT'});
 await assert.rejects(read({...request,projectRoots:['/arbitrary']}),{code:'INVALID_ARGUMENT'});
 await read(request);assert.equal(calls.length,1);assert.deepEqual(calls[0].roots,['/synthetic/logs']);
 await assert.rejects(activityAccess(client,published,()=>[],async()=>{published.clear();})(request),{code:'VIEW_EXPIRED'});assert.equal(calls.length,1);
 published.add('live:synthetic:fixed');
 await assert.rejects(activityAccess({...client,optimize:async()=>{published.clear();return activityResult();}},published,()=>[],async()=>{})(request),{code:'VIEW_EXPIRED'});
});
