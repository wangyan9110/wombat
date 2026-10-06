import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsageClient} from '@wombat/client';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {locale} from '@wombat/client/locale';
import {taskFixture,previewTasks} from '../src/preview/tasks.js';
import {previewPrices} from '../src/preview/prices.js';
import {inventoryFixture,previewInventory} from '../src/preview/inventory.js';
import {previewStartup} from '../src/preview/startup.js';
import {HookRegistry} from '../src/config/HookRegistry.js';
import {InvocationCounts} from '../src/config/InvocationCounts.js';
import {PriceCatalog} from '../src/prices/Catalog.js';
import {Workspace} from '../src/workspace.js';
import {parseRoute} from '../src/state.js';
import {createPreviewClient} from '../src/preview/fixtures.js';
import {previewChecks} from '../src/preview/checks.js';
import {Preparation} from '../src/Preparation.js';
import {UsageView} from '../src/UsageView.js';
import {AssessmentRows} from '../src/optimize/Assessments.js';
import {StartupDirectories} from '../src/StartupDirectories.js';
const query={action:'threads' as const,scope:{allTime:true},limit:10};
function client(scenario='complete'){return createUsageClient({query:previewTasks(scenario),prices:previewPrices(scenario),config:previewInventory(scenario),live:previewStartup(scenario)});}
test('synthetic task truth filters and locates bounded pages while preserving whole-scope totals',async()=>{
 const c=client(),first=await c.query(query);assert.equal(first.page.total,43);assert.equal(first.items.length,10);assert.equal(first.summary.measurementCount,84);const second=await c.query({...query,offset:10,snapshotId:first.snapshotRef.snapshotId});assert.equal(second.summary.tokens.total,first.summary.tokens.total);assert.equal(second.items.length,10);assert.notEqual('id' in first.items[0]&&first.items[0].id,'id' in second.items[0]&&second.items[0].id);
 const selected=await c.query({...query,scope:{allTime:true,project:'/synthetic/reporter'}});assert.equal(selected.page.total,21);assert.equal(selected.summary.measurementCount,40);const model=await c.query({...query,scope:{allTime:true,modelUnknown:true}});assert.ok(model.items.every(row=>row.kind==='thread'&&!row.models.length));
 const located=await c.query({...query,locateThreadId:'preview-task-39'});assert.ok(located.items.some(row=>row.kind==='thread'&&row.id==='preview-task-39'));assert.ok(located.page.offset>0);
 assert.equal((await c.query({...query,search:'preview-task-42'})).page.total,1);assert.equal((await c.query({...query,scope:{undated:true}})).page.total,1);assert.equal((await c.query({...query,scope:{allTime:true,sourceInstanceId:'unrelated'}})).page.total,0);
 const recent=await c.query({...query,sort:'recent'});assert.ok(recent.items[0].kind==='thread');assert.ok(recent.items[0].lastActivityAt?.startsWith('2026-10-04'));
 for(const request of [{action:'usage' as const,group:'day' as const},{action:'usage' as const,presentation:'projects' as const},{action:'usage' as const,presentation:'models' as const},{action:'turns' as const,threadId:'preview-task',matchedOnly:true},{action:'steps' as const,threadId:'preview-task',turnId:'preview-turn'}])await c.query({...request,scope:{allTime:true}});
 await assert.rejects(c.query({...query,snapshotId:'unavailable'}),{code:'VIEW_EXPIRED'});
});
test('task zero-metering headers remain discoverable and scope changes can cancel slow queries',async()=>{
 const noUsage=taskFixture({...query,search:'preview-task-41'},'complete');assert.equal(noUsage.page.total,1);assert.equal(noUsage.summary.measurementCount,0);assert.ok(noUsage.items[0].kind==='thread');assert.equal(noUsage.items[0].matchedTurnCount,null);
 const c=client('tasks-delayed'),controller=new AbortController(),slow=c.query({...query,scope:{allTime:true,project:'/synthetic/wombat'}},{signal:controller.signal});controller.abort();await assert.rejects(slow,{code:'CANCELLED'});assert.equal((await c.query({...query,scope:{allTime:true,project:'/synthetic/reporter'}})).page.total,21);
 const failed=client('tasks-refresh-failed');await failed.query({action:'usage',scope:{allTime:true}});const previous=await failed.query({...query,snapshotId:'preview:1'});await failed.query({...query,offset:10,snapshotId:'preview:1'});await assert.rejects(failed.query({action:'usage',scope:{allTime:true}}),{code:'SOURCE_UNREADABLE'});assert.equal(previous.summary.measurementCount,84);
});
test('configuration mocks preserve measurement parse history native registry and authorized membership distinctions',async()=>{
 const c=client(),list=await c.config!({action:'list',limit:3});assert.equal(list.page.total,7);assert.equal(list.items.length,3);const invalid=await c.config!({action:'detail',itemId:'preview-invalid-skill'});assert.equal(invalid.items[0].skillMetadata?.status,'invalid');assert.deepEqual(invalid.items[0].skillMetadata?.diagnostics[0],{code:'nameTypeInvalid',field:'name',line:2,column:7,current:'array',expected:'string'});
 const historical=await c.config!({action:'detail',itemId:'preview-historical-rule'});assert.equal(historical.items[0].current,false);assert.equal(historical.items[0].contentTokens,null);assert.equal(historical.items[0].estimate,null);assert.equal(historical.coverage.historyStatus,'partial');assert.equal(historical.capabilities.historicalContent,false);
 const hook=await c.config!({action:'evidence',itemId:'preview-hook'});assert.equal(hook.items[0].usageCount,null);assert.equal(hook.evidence.length,0);assert.equal(hook.hookRegistry.contexts.length,2);
 const secondary=await c.config!({action:'list',scope:{sourceInstanceId:'preview-secondary'}});assert.equal(secondary.items.length,1);assert.equal(secondary.items[0].observation,'unknown');assert.equal(secondary.items[0].usageCount,null);
 const outside=await c.config!({action:'list',scope:{project:'/unauthorized'}});assert.equal(outside.items.length,0);await assert.rejects(c.config!({action:'detail',readView:'wrong',itemId:'preview-skill'}),{code:'VIEW_EXPIRED'});
 const evidence=await c.config!({action:'evidence',itemId:'preview-skill',limit:2});assert.equal(evidence.page.total,3);assert.equal(evidence.evidence[1].outcome,'failed');assert.equal(evidence.page.nextOffset,2);
});
test('production configuration and startup components display native registry uncertainty and known facts in both languages',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const result=inventoryFixture({action:'evidence',itemId:'preview-hook'});const hook=renderToStaticMarkup(createElement(HookRegistry,{registry:result.hookRegistry,itemId:'preview-hook',timezone:'UTC'}));assert.match(hook,/\/synthetic\/wombat/);assert.match(hook,/\/synthetic\/reporter/);assert.match(hook,language==='zh'?/不能|不代表/:/does not|never|not prove/);assert.match(hook,language==='zh'?/不完整/:/incomplete|partial/i);
 const counts=renderToStaticMarkup(createElement(InvocationCounts,{counts:{fileReads:0,toolCalls:2,resourceReads:0,succeeded:2,failed:0,outcomeUnknown:0},coverage:result.coverage}));assert.match(counts,/2/);assert.match(counts,language==='zh'?/未知/:/Unknown/);
 const startup=renderToStaticMarkup(createElement(StartupDirectories,{directories:['/synthetic/wombat','/synthetic/reporter'],open(){},instructions(){}}));assert.equal((startup.match(/<li/g)??[]).length,2);assert.doesNotMatch(startup,/43%|100%/);
 }}finally{locale.setLocale(saved);}
});
test('catalog rows keep native decimals missing zero and both tiers while update failure preserves previous data',async()=>{
 const c=client(),first=await c.prices({action:'status'});assert.equal(first.catalog.models.length,2);assert.equal(first.catalog.models[0].rates.cacheCreate,null);assert.equal(first.catalog.models[1].rates.input,'0');assert.equal(first.catalog.models[0].longContext?.rates.input,'2.000');const updated=await c.prices({action:'update'});assert.equal(updated.updated,true);assert.notEqual(first.catalog.revision,updated.catalog.revision);assert.equal(first.catalog.models[0].rates.input,'1.000');
 const failed=client('prices-update-failed'),old=await failed.prices({action:'status'});await assert.rejects(failed.prices({action:'update'}),{code:'PRICE_UPDATE_FAILED'});assert.equal(old.catalog.revision,(await failed.prices({action:'status'})).catalog.revision);await assert.rejects(client('prices-unavailable').prices({action:'status'}),{code:'PRICES_UNAVAILABLE'});
});
test('initial metadata never becomes a completed ledger; explicit retry completes one caller and fixed provisional reads stay provisional',async()=>{
 const c=client('initial'),first=await c.live!({query});assert.equal(first.freshness.initialScan,true);assert.equal(first.result.summary.tokens.total,null);assert.equal(first.result.facets?.directories.length,2);assert.equal(first.result.page.total,43);const controller=new AbortController(),pending=c.live!({query,mode:'fresh'},{signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'CANCELLED'});assert.equal((await c.live!({query})).freshness.initialScan,true);
 const completed=await c.live!({query,mode:'fresh'});assert.equal(completed.freshness.initialScan,undefined);assert.equal(completed.result.summary.measurementCount,84);const fixed=await c.live!({query:{...query,snapshotId:first.result.snapshotRef.snapshotId},mode:'cached'});assert.equal(fixed.freshness.initialScan,true);assert.equal(fixed.result.summary.tokens.total,null);
 const awaiting=client('initial-pending');await assert.rejects(awaiting.live!({query}),{code:'SYNC_PENDING'});assert.equal((await awaiting.live!({query,mode:'fresh'})).result.summary.measurementCount,84);
});

test('shared price catalog component renders exact decimal rates missing zero and long-context absence in both languages',async()=>{
 const result=await client().prices({action:'status'}),saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const standard=renderToStaticMarkup(createElement(PriceCatalog,{catalog:result.catalog,tier:'standard'}));assert.match(standard,/\$1\.000/);assert.match(standard,/\$0<\/td>/);assert.match(standard,language==='zh'?/未单列/:/Not listed/);const long=renderToStaticMarkup(createElement(PriceCatalog,{catalog:result.catalog,tier:'longContext'}));assert.match(long,/\$2\.000/);assert.match(long,/128,000/);assert.match(long,/<td>—<\/td>/);}}finally{locale.setLocale(saved);}
});

test('task turn and measurement fixtures conserve metering and reject nonexistent turn targets',async()=>{
 const c=client(),thread=await c.query({...query,search:'preview-task',scope:{allTime:true,threadId:'preview-task'}}),turns=await c.query({action:'turns',threadId:'preview-task',scope:{allTime:true}});
 let measurements=0;
 for(const row of turns.items){assert.equal(row.kind,'turn');if(row.kind!=='turn')continue;const steps=await c.query({action:'steps',threadId:'preview-task',turnId:row.id,scope:{allTime:true}});assert.equal(steps.summary.measurementCount,row.usage.measurementCount);assert.equal(steps.items.length,row.usage.measurementCount);measurements+=steps.summary.measurementCount;}
 assert.equal(measurements,2);assert.equal(thread.summary.measurementCount,measurements);assert.equal(turns.summary.measurementCount,measurements);
 await assert.rejects(c.query({action:'steps',threadId:'preview-task',turnId:'missing',scope:{allTime:true}}),{code:'NOT_FOUND'});
 assert.equal((await c.query({action:'steps',threadId:'preview-task',turnId:'preview-turn',scope:{allTime:true,project:'/synthetic/reporter'}})).summary.measurementCount,0);
});
function settled(workspace:Workspace){return new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{off();reject(new Error('Workspace did not settle'));},1000);const off=workspace.subscribe(()=>{if(!workspace.getSnapshot().loading){clearTimeout(timer);off();resolve();}});});}
const taskRoute=()=>parseRoute('?page=threads&allTime=1&timezone=UTC');
test('production workspace consumes preview pages and discards prior scope completion while retaining failed refresh data',async t=>{
 const workspace=new Workspace(createPreviewClient('tasks-pages'),60_000);t.after(()=>workspace.stop());await workspace.navigate(taskRoute());assert.equal(workspace.getSnapshot().data?.list.items.length,10);assert.equal(workspace.getSnapshot().data?.list.page.total,43);await workspace.navigate({...taskRoute(),offset:10});assert.equal(workspace.getSnapshot().data?.list.page.offset,10);
 const slow=new Workspace(createPreviewClient('tasks-delayed'),60_000);t.after(()=>slow.stop());const pending=slow.navigate({...taskRoute(),project:'/synthetic/wombat'});await slow.navigate({...taskRoute(),project:'/synthetic/reporter'});await pending;assert.equal(slow.getSnapshot().data?.route.project,'/synthetic/reporter');assert.equal(slow.getSnapshot().data?.list.page.total,21);assert.equal(slow.getSnapshot().error,'');
 const failed=new Workspace(createPreviewClient('tasks-refresh-failed'),60_000);t.after(()=>failed.stop());await failed.navigate(taskRoute());const previous=failed.getSnapshot().data;const done=settled(failed);failed.refresh();await done;assert.equal(failed.getSnapshot().data,previous);assert.equal(failed.getSnapshot().errorCode,'SOURCE_UNREADABLE');
});
test('production startup cancellation retains native headers and retry completes the same workspace without fabricating scan progress',async t=>{
 const initial=new Workspace(createPreviewClient('initial'),60_000);t.after(()=>initial.stop());await initial.navigate(taskRoute());const headers=initial.getSnapshot().data;assert.equal(headers?.overview.summary.tokens.total,null);assert.equal(headers?.list.items.length,10);initial.refresh();initial.cancel();assert.equal(initial.getSnapshot().errorCode,'CANCELLED');assert.equal(initial.getSnapshot().data,headers);await initial.check();assert.equal(initial.getSnapshot().data,headers);const done=settled(initial);initial.refresh();await done;assert.equal(initial.getSnapshot().data?.overview.summary.measurementCount,84);assert.equal(initial.getSnapshot().data?.freshness?.initialScan,undefined);
 const waiting=new Workspace(createPreviewClient('initial-pending'),60_000);t.after(()=>waiting.stop());await waiting.navigate(taskRoute());assert.equal(waiting.getSnapshot().pending,true);assert.equal(waiting.getSnapshot().data,undefined);waiting.cancel();assert.equal(waiting.getSnapshot().pending,false);assert.equal(waiting.getSnapshot().data,undefined);const retry=settled(waiting);waiting.refresh();await retry;assert.equal(waiting.getSnapshot().data?.list.page.total,43);
 const scoped=await client('initial').live!({query:{...query,scope:{allTime:true,project:'/synthetic/reporter'}}});assert.equal(scoped.result.page.total,21);
});
test('production overview parse assessment and initial waiting views expose synthetic facts through shared bilingual components',async t=>{
 const w=new Workspace(createPreviewClient('tasks-pages'),60_000);t.after(()=>w.stop());const route=parseRoute('?page=usage&allTime=1&timezone=UTC');await w.navigate(route);const data=w.getSnapshot().data!;
 const checksClient=createUsageClient({query:previewTasks('complete'),prices:previewPrices('complete'),optimize:previewChecks(false,'unchanged')});const checks=await checksClient.optimize!({action:'checks',itemId:'preview-invalid-skill'});assert.equal(checks.checks[0].outcome,'hit');assert.equal(checks.checks[0].basis.measurement.kind,'skill_metadata');
 await assert.rejects(checksClient.optimize!({action:'checks',itemId:'preview-invalid-skill',project:'/unauthorized'}),{code:'NOT_FOUND'});await assert.rejects(checksClient.optimize!({action:'checks',itemId:'preview-invalid-skill',sourceInstanceId:'outside-source'}),{code:'NOT_FOUND'});await assert.rejects(checksClient.optimize!({action:'checks',itemId:'preview-invalid-skill',readView:'expired'}),{code:'VIEW_EXPIRED'});
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const overview=renderToStaticMarkup(createElement(UsageView,{data,route,client:createPreviewClient('tasks-pages'),empty:null,setReading(){},refresh(){},navigate(){},drill(){},usage(){},basis(){}}));assert.equal((overview.match(/class="bar"/g)??[]).length,4);assert.match(overview,/reporter/);assert.match(overview,/wombat/);assert.match(overview,/20\.0/);
 const invalid=renderToStaticMarkup(createElement(AssessmentRows,{checks:checks.checks,timezone:'UTC'}));assert.match(invalid,language==='zh'?/格式无效/:/Invalid format/);
 const waiting=renderToStaticMarkup(createElement(Preparation,{since:Date.now(),pending:true,initial:true,progress:'',cancel(){}}));assert.match(waiting,language==='zh'?/停止等待/:/Stop waiting/);assert.match(waiting,language==='zh'?/共享后台读取可能仍在继续/:/Shared background reading may continue/);assert.doesNotMatch(waiting,/43%|100%/);
 }}finally{locale.setLocale(saved);}
});
