import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ConfigRequest,ConfigResult,UsageClient} from '@wombat/client';
import {followInventory} from '../src/config/readInventory.js';

function result(view:string,status:string,nextOffset:number|null=null):ConfigResult {
  return {readView:view,items:[],coverage:{historyStatus:status},page:{offset:0,limit:200,total:0,nextOffset}} as ConfigResult;
}
test('initial inventory follows new versions, pins each pagination pass, and preserves filters',async()=>{
  const calls:ConfigRequest[]=[];
  const replies=[result('temporary','syncing',200),result('temporary','syncing'),result('ready','partial',200),result('ready','partial')];
  const client={config:async(r:ConfigRequest)=>{calls.push(r);return replies.shift()!;}} as UsageClient;
  const received:string[]=[];
  await followInventory(client,{readView:'temporary',scope:{project:'/synthetic',allTime:true},search:'name',kind:'skill',offset:30},true,new AbortController().signal,r=>received.push(r.readView!),0);
  assert.deepEqual(received,['temporary','ready']);
  assert.deepEqual(calls.map(r=>r.readView),['temporary','temporary',undefined,'ready']);
  assert.ok(calls.every(r=>r.scope?.project==='/synthetic'&&r.scope.allTime&&r.search==='name'&&r.kind==='skill'));
  assert.equal(calls[2].snapshotId,undefined);
});
test('cancellation stops initialization polling and ignores late responses',async()=>{
  const c=new AbortController();let calls=0,published=0;
  const client={config:async()=>{calls++;return result('temporary','syncing');}} as unknown as UsageClient;
  await assert.rejects(followInventory(client,{},false,c.signal,()=>{published++;c.abort();},1),{name:'AbortError'});
  assert.equal(calls,1);assert.equal(published,1);
  const late=new AbortController();
  const delayed={config:async()=>{late.abort();return result('old','current');}} as unknown as UsageClient;
  await assert.rejects(followInventory(delayed,{},false,late.signal,()=>assert.fail('stale response published'),0),{name:'AbortError'});
});
test('unavailable pinned views recover once; genuine failure and committed partial views do not loop',async()=>{
  for(const status of ['unavailable','partial','current','fixed']){
    const calls:ConfigRequest[]=[];
    const client={config:async(r:ConfigRequest)=>{calls.push(r);return result('view',status);}} as UsageClient;
    await followInventory(client,{readView:'old',offset:30},false,new AbortController().signal,()=>{},0);
    assert.equal(calls.length,status==='unavailable'?2:1);
    assert.ok(calls.every(r=>r.offset===30));
  }
});
test('expired bookmarked views recover without dropping the selection scope',async()=>{
  const calls:ConfigRequest[]=[];
  const client={config:async(r:ConfigRequest)=>{calls.push(r);if(calls.length===1)throw Object.assign(new Error('expired'),{code:'VIEW_EXPIRED'});return result('ready','current');}} as UsageClient;
  await followInventory(client,{readView:'expired',snapshotId:'live:old',scope:{threadId:'task'}},false,new AbortController().signal,()=>{},0);
  assert.equal(calls.length,2);assert.equal(calls[1].readView,undefined);assert.equal(calls[1].snapshotId,undefined);assert.equal(calls[1].scope?.threadId,'task');
});
