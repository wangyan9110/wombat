import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {UsageClient,OptimizeResult,ConfigResult,UsageResult} from '@wombat/client';
import {findConfigSuggestion} from '../src/ConfigSuggestion.js';
import {readScopeContext} from '../src/useScopeContext.js';
import {returnRoute,parseRoute,relatedTurnRoute,routeSearch,linkedReturn,patchRoute} from '../src/state.js';
import {ViewPositions,readPosition} from '../src/navigation.js';
test('same-object recommendation lookup reaches later pinned pages without mixing source identities',async()=>{
 const calls:any[]=[];
 const client={optimize:async(request:any,options:any)=>{calls.push({request,signal:options.signal});return {readView:'config:pinned',suggestions:request.offset===0?[{id:'other',item:{id:'same-name-other-source'}}]:[{id:'target',item:{id:'target-source-item'}}],page:{nextOffset:request.offset===0?200:null}} as OptimizeResult;}} as UsageClient;
 const signal=new AbortController().signal;
 const match=await findConfigSuggestion(client,{action:'list',readView:'config:pinned',project:'/synthetic/project',group:'pending'},'target-source-item',signal);
 assert.equal(match?.suggestion.id,'target');assert.equal(match?.offset,180);
 assert.deepEqual(calls.map(c=>c.request.offset),[0,200]);assert.ok(calls.every(c=>c.request.readView==='config:pinned'&&c.request.project==='/synthetic/project'&&c.signal===signal));
 assert.equal(await findConfigSuggestion(client,{readView:'config:pinned'},'absent',signal),undefined);
});
test('nested overview, task and configuration journeys return through each exact scope',()=>{
 const overview=parseRoute('?page=usage&project=%2Fsynthetic&since=2026-09-25&until=2026-10-01&timezone=UTC&model=chosen&effort=high&dimension=models&offset=20&periodOffset=120');
 const task=patchRoute(overview,{page:'threads',returnTo:linkedReturn(overview),thread:'task',turn:'turn-9',turnOffset:20,snapshot:'live:fixed'});
 const config=patchRoute(task,{page:'instructions',returnTo:linkedReturn(task),configThread:'task',configId:'file',configView:'config:fixed'});
 const restoredTask=returnRoute(parseRoute(routeSearch(config)))!;
 assert.deepEqual(restoredTask,parseRoute(routeSearch(task)));
 assert.deepEqual(returnRoute(restoredTask),overview);
 assert.equal(returnRoute({...config,returnTo:'?page=unknown'}),undefined);
 assert.equal(returnRoute({...config,returnTo:'?page=usage&x='+ 'x'.repeat(32_768)}),undefined);
});
test('view positions remain bounded, scoped, and independent of background read revisions',()=>{
 const views=new ViewPositions(), original=parseRoute('?page=threads&project=%2Fa&thread=t&turn=u&eventsOffset=100');
 const position={x:0,y:620,details:[{selector:'[data-view-key="event"]',open:true}],scrollers:[]};
 views.save(original,position);
 assert.deepEqual(views.read({...original,snapshot:'live:new',returnTo:'?page=usage'}),position);
 assert.equal(views.read({...original,project:'/b'}),undefined);
 assert.equal(views.read({...original,eventsOffset:0}),undefined);
 assert.deepEqual(readPosition(position),position);
 for(const broken of [null,{...position,y:Infinity},{...position,details:[null]},{...position,focus:'x'.repeat(769)},{...position,scrollers:Array(17).fill({selector:'div',x:0,y:0})}])assert.equal(readPosition(broken),undefined);
 for(let n=0;n<24;n++)views.save({...original,thread:String(n)},position);
 assert.equal(views.read(original),undefined);
 const changed=patchRoute(original,{thread:'another'});assert.equal(changed.eventsOffset,0);
});
test('direct configuration/optimization menu reads reuse committed versions without collecting logs',async()=>{
 const calls:any[]=[];
 const client={config:async(request:any)=>{calls.push(request);return {authorizedProjects:['/synthetic/project'],usageRevision:'live:pinned'} as ConfigResult;},query:()=>{throw new Error('live identity is not a fixed snapshot');},live:async(request:any)=>{assert.equal(request.mode,'cached');calls.push(request.query);return {result:{facets:{directories:['/synthetic/history']}}};}} as unknown as UsageClient;
 const context=await readScopeContext(client,'config:pinned',new AbortController().signal);
 assert.deepEqual(context?.config.authorizedProjects,['/synthetic/project']);
 assert.equal(calls[0].readView,'config:pinned');assert.equal(calls[1].snapshotId,'live:pinned');assert.ok(calls.every(c=>c.limit===1));
});
test('configuration and recommendation return links preserve the full view and reject external destinations',()=>{
 const original=parseRoute('?page=extensions&configId=item&configView=config:one&extensionSearch=Token%20%E4%B8%AD%E6%96%87&extensionKind=skill&configOffset=30&model=source-model&effort=high');
 assert.deepEqual(returnRoute({...original,returnTo:routeSearch(original)}),{...original,returnTo:undefined});
 const turn={...original,...relatedTurnRoute(original,'live:one','thread','turn-23')};
 assert.deepEqual(returnRoute(turn),{...original,returnTo:undefined});
 assert.equal(returnRoute({...original,returnTo:'https://external.invalid/'}),undefined);
});
