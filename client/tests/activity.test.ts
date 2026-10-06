import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsageClient,type OptimizeRequest} from '../src/index.js';
import {activityResult} from '../../tests/fixtures/activity.js';
const request:OptimizeRequest={action:'activity',activity:{snapshotId:'live:synthetic:fixed',threadId:'task',turnId:'turn'},sourceInstanceId:'synthetic'};
const client=(value:unknown)=>createUsageClient({query:async()=>{throw Error('No usage scan');},optimize:async()=>value});
test('activity validates fixed scope, methods and positive advice independently of static reviews',async()=>{
 const valid=activityResult();assert.equal(await client(valid).optimize!(request),valid);
 const variants=[{...valid,outputVersion:1},{...valid,activity:null},{...valid,privateFields:'sensitive'},
 {...valid,activity:{...valid.activity,formatVersion:2}},
 {...valid,activity:{...valid.activity,scope:{...valid.activity!.scope,turnId:'foreign'}}},
 {...valid,activity:{...valid.activity,readView:{...valid.activity!.readView,snapshotId:'live:other'}}},
 {...valid,activity:{...valid.activity,advice:['inspect_repeated_requests']}},
 {...valid,activity:{...valid.activity,checks:valid.activity!.checks.map((check,index)=>index===0?{...check,observed:{...check.observed,value:0}}:check)}},
 {...valid,activity:{...valid.activity,checks:valid.activity!.checks.map((check,index)=>index===0?{...check,observed:{...check.observed,basis:'native_record'}}:check)}}];
 for(const variant of variants)await assert.rejects(client(variant).optimize!(request),{code:'PROTOCOL_ERROR'});
 for(const invalid of [{...request,readView:'config:other'},{...request,projectRoots:[]},{...request,ruleOverrides:{}},{...request,action:'keep' as const},{...request,activity:undefined}])await assert.rejects(client(valid).optimize!(invalid),{code:'INVALID_ARGUMENT'});
});
test('activity discards late responses after cancellation',async()=>{
 const controller=new AbortController();let finish!:()=>void;
 const transport=createUsageClient({query:async()=>{throw new Error('No scan');},optimize:async()=>{await new Promise<void>(resolve=>{finish=resolve;});return activityResult();}});
 const read=transport.optimize!(request,{signal:controller.signal});await new Promise(resolve=>setTimeout(resolve,0));controller.abort();finish();await assert.rejects(read,{code:'CANCELLED'});
});
