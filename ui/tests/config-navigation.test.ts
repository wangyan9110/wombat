import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {UsageClient,OptimizeResult,ConfigResult,UsageResult} from '@wombat/client';
import {findConfigSuggestion} from '../src/ConfigSuggestion.js';
import {readScopeContext} from '../src/useScopeContext.js';
import {detailReturnRoute,parseRoute,relatedTurnRoute,reviewReturnRoute,routeSearch} from '../src/state.js';
test('same-object recommendation lookup reaches later pinned pages without mixing source identities',async()=>{
 const calls:any[]=[];
 const client={optimize:async(request:any,options:any)=>{calls.push({request,signal:options.signal});return {readView:'config:pinned',suggestions:request.offset===0?[{id:'other',item:{id:'same-name-other-source'}}]:[{id:'target',item:{id:'target-source-item'}}],page:{nextOffset:request.offset===0?200:null}} as OptimizeResult;}} as UsageClient;
 const signal=new AbortController().signal;
 const match=await findConfigSuggestion(client,{action:'list',readView:'config:pinned',project:'/synthetic/project',group:'pending'},'target-source-item',signal);
 assert.equal(match?.suggestion.id,'target');assert.equal(match?.offset,180);
 assert.deepEqual(calls.map(c=>c.request.offset),[0,200]);assert.ok(calls.every(c=>c.request.readView==='config:pinned'&&c.request.project==='/synthetic/project'&&c.signal===signal));
 assert.equal(await findConfigSuggestion(client,{readView:'config:pinned'},'absent',signal),undefined);
});
test('direct configuration/optimization menu reads reuse committed versions without collecting logs',async()=>{
 const calls:any[]=[];
 const client={config:async(request:any)=>{calls.push(request);return {authorizedProjects:['/synthetic/project'],usageRevision:'live:pinned'} as ConfigResult;},query:()=>{throw new Error('live identity is not a fixed snapshot');},live:async(request:any)=>{assert.equal(request.mode,'cached');calls.push(request.query);return {result:{facets:{directories:['/synthetic/history']}}};}} as unknown as UsageClient;
 const context=await readScopeContext(client,'config:pinned',new AbortController().signal);
 assert.deepEqual(context?.config.authorizedProjects,['/synthetic/project']);
 assert.equal(calls[0].readView,'config:pinned');assert.equal(calls[1].snapshotId,'live:pinned');assert.ok(calls.every(c=>c.limit===1));
});
test('configuration and recommendation return links preserve the full view and reject external destinations',()=>{
 const original=parseRoute('?page=config&configId=item&configView=config:one&configSearch=Token%20%E4%B8%AD%E6%96%87&configKind=skill&configSort=size&configOffset=30&model=source-model&effort=high');
 assert.deepEqual(detailReturnRoute({...original,detailReturn:routeSearch(original)}),{...original,detailReturn:undefined});
 const turn={...original,...relatedTurnRoute(original,'live:one','thread','turn-23')};
 assert.deepEqual(reviewReturnRoute(turn),{...original,optimizeReturn:undefined});
 assert.equal(detailReturnRoute({...original,detailReturn:'https://external.invalid/'}),undefined);
});
