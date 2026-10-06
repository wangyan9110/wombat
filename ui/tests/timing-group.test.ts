import test from 'node:test';
import assert from 'node:assert/strict';
import {CoreError,type UsageClient,type UsageRequest,type QueryOptions,type TimingRequest} from '@wombat/client';
import {TurnReadGroup} from '../src/useTiming.js';
import {timingFixture} from '../src/preview/timing.js';
import {usageFixture} from '../src/preview/fixtures.js';
const request=(snapshotId='list-request'):UsageRequest=>({action:'turns',snapshotId,threadId:'preview-task',scope:{allTime:true,timezone:'UTC'}});
function fixture(){
 const calls:TimingRequest[]=[];let version='returned:one';let intercept=async(_q:TimingRequest,_options?:QueryOptions)=>{};
 const client:UsageClient={query:async q=>({...usageFixture(q,'complete'),snapshotRef:{snapshotId:version}}),timing:async(q,options)=>{calls.push(q);await intercept(q,options);return timingFixture('complete',q.action==='capabilities'?'none':q.snapshotId??version,q.action==='capabilities'?'none':q.threadId,q.action==='capabilities'?'none':q.turnId);}};
 return {client,calls,revise:(value:string)=>{version=value;},intercept:(value:typeof intercept)=>{intercept=value;}};
}
test('timing identity comes from the presented turn query result, never the caller snapshot prop',async()=>{
 const f=fixture(),group=new TurnReadGroup(f.client);await group.read(request(),'preview-turn');
 assert.equal(f.calls[0].action,'summary');assert.equal(f.calls[0].action==='summary'&&f.calls[0].snapshotId,'returned:one');
 assert.equal(group.getSnapshot().usage?.snapshotRef.snapshotId,group.getSnapshot().summary?.readView.snapshotId);
 group.stop();
});
test('refresh retains the previous whole group until replacement timing completes',async()=>{
 const f=fixture(),group=new TurnReadGroup(f.client);await group.read(request(),'preview-turn');
 f.revise('returned:two');let release!:()=>void;f.intercept(()=>new Promise(resolve=>{release=resolve;}));
 const read=group.read(request('replacement'),'preview-turn');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(group.getSnapshot().usage?.snapshotRef.snapshotId,'returned:one');assert.equal(group.getSnapshot().summary?.readView.snapshotId,'returned:one');assert.equal(group.getSnapshot().loading,true);
 release();await read;assert.equal(group.getSnapshot().usage?.snapshotRef.snapshotId,'returned:two');assert.equal(group.getSnapshot().summary?.readView.snapshotId,'returned:two');group.stop();
});
test('refresh failure and expiry retain the old group without renewing or falling back to latest',async()=>{
 const f=fixture(),group=new TurnReadGroup(f.client);await group.read(request(),'preview-turn');f.revise('returned:two');
 f.intercept(async()=>{throw new CoreError('VIEW_EXPIRED','expired');});await group.read(request('replacement'),'preview-turn');
 assert.equal(group.getSnapshot().expired,true);assert.equal(group.getSnapshot().usage?.snapshotRef.snapshotId,'returned:one');assert.equal(group.getSnapshot().summary?.readView.snapshotId,'returned:one');assert.equal(f.calls.length,2);group.stop();
});
test('target switches abort prior reads and ignore late completion even when transports ignore abort',async()=>{
 const f=fixture(),group=new TurnReadGroup(f.client);let release!:()=>void,signal:AbortSignal|undefined;
 f.intercept(async(_q,options)=>{signal=options?.signal;await new Promise<void>(resolve=>{release=resolve;});});
 const first=group.read(request(),'preview-turn');await new Promise(resolve=>setImmediate(resolve));
 f.intercept(async()=>{});await group.read(request(),'closed');assert.equal(signal?.aborted,true);release();await first;
 assert.equal(group.getSnapshot().turnId,undefined);assert.equal(group.getSnapshot().summary,undefined);group.stop();
});
test('unsupported timing leaves usage available, and mismatched result identities do not commit as a group',async()=>{
 const f=fixture(),group=new TurnReadGroup({...f.client,timing:undefined});await group.read(request(),'preview-turn');assert.ok(group.getSnapshot().usage);assert.equal(group.getSnapshot().unavailable,true);group.stop();
 const broken=new TurnReadGroup({...f.client,timing:async()=>timingFixture('complete','wrong')});await broken.read(request(),'preview-turn');assert.equal(broken.getSnapshot().errorCode,'PROTOCOL_ERROR');assert.equal(broken.getSnapshot().summary,undefined);broken.stop();
});
test('initial timing failure keeps the usage result, distinguishes failure and leaves summary unavailable',async()=>{
 const f=fixture();f.intercept(async()=>{throw new CoreError('SOURCE_UNREADABLE','synthetic');});const group=new TurnReadGroup(f.client);await group.read(request(),'preview-turn');assert.ok(group.getSnapshot().usage);assert.equal(group.getSnapshot().summary,undefined);assert.equal(group.getSnapshot().errorCode,'SOURCE_UNREADABLE');assert.equal(group.getSnapshot().timingLoading,false);group.stop();
});
test('changed source and sort invalidate pending scope, while locale changes never alter request identity',async()=>{
 const f=fixture(),group=new TurnReadGroup(f.client);let release!:()=>void;f.intercept(()=>new Promise(resolve=>{release=resolve;}));const old=request();const first=group.read(old,'preview-turn');await new Promise(resolve=>setImmediate(resolve));assert.equal(group.matches(old,'preview-turn'),true);
 f.intercept(async()=>{});const changed={...request(),sort:'time' as const,scope:{allTime:true,sourceInstanceId:'other'}};await group.read(changed,'preview-turn');assert.equal(group.matches(old,'preview-turn'),false);release();await first;assert.deepEqual(group.getSnapshot().usage?.scope,changed.scope);group.stop();
});
test('explicit replacement keeps expired evidence blocked until a new entire group commits',async()=>{
 const f=fixture(),group=new TurnReadGroup(f.client);await group.read(request(),'preview-turn');f.intercept(async()=>{throw new CoreError('VIEW_EXPIRED','expired');});await group.read(request('expired'),'preview-turn');assert.equal(group.getSnapshot().expired,true);
 f.revise('returned:two');let release!:()=>void;f.intercept(()=>new Promise(resolve=>{release=resolve;}));const pending=group.read(request('replace'),'preview-turn');await new Promise(resolve=>setImmediate(resolve));assert.equal(group.getSnapshot().expired,true);assert.equal(group.getSnapshot().summary?.readView.snapshotId,'returned:one');release();await pending;assert.equal(group.getSnapshot().expired,undefined);assert.equal(group.getSnapshot().summary?.readView.snapshotId,'returned:two');group.stop();
});
