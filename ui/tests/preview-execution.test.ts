import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createUsageClient} from '@wombat/client';
import {locale} from '@wombat/client/locale';
import {timingFixture,previewTiming} from '../src/preview/timing.js';
import {usageFixture} from '../src/preview/fixtures.js';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}});
const {Execution}=await import('../src/tasks/Execution.js');
const {TimingDetailReader}=await import('../src/tasks/TurnExecution.js');
const render=(summary:ReturnType<typeof timingFixture>)=>renderToStaticMarkup(createElement(Execution,{summary,refresh(){},onEvidence(){},onShare(){}}));
test('production execution consumes real DTOs, keeps zero unknown and five states distinct in both languages',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);for(const state of ['completed','running','failed','cancelled','unknown'] as const){const summary=timingFixture();summary.time.state=state;summary.time.nativeWallClockMs.value=0;const html=render(summary);assert.match(html,language==='zh'?/执行过程/:/Execution/);if(state==='running')assert.doesNotMatch(html,/<strong>0 ms<\/strong>/);else assert.match(html,/<strong>0 ms<\/strong>/);assert.doesNotMatch(html,language==='zh'?/对象级使用投影尚未提供/:/Object-level use projection is not available/);}}}finally{locale.setLocale(previous);}
});
test('missing reliable window uses the same production list fallback and unknowns never become zero',()=>{
 const html=render(timingFixture('missing'));assert.match(html,/execution-no-window/);assert.doesNotMatch(html,/NaN|Infinity|<strong>0 ms<\/strong>/);assert.match(html,/missing_time/);
});
test('timeline and expandable distribution preserve core ranges and concurrent union versus sum',()=>{
 const summary=timingFixture(),html=render(summary);assert.equal(summary.time.command.unionMs.value,5000);assert.equal(summary.time.command.sumMs.value,6000);assert.match(html,/1000–4000 ms/);assert.match(html,/5000 ms/);assert.match(html,/6000 ms/);assert.doesNotMatch(html,/11000 ms/);assert.match(html,/execution-gap/);assert.equal(summary.time.timeline.tracks.length,3);
});
test('synthetic timing client passes the real generated validator for local share and evidence',async()=>{
 const client=createUsageClient({query:async request=>usageFixture(request,'complete'),timing:previewTiming('complete')});
 const common={snapshotId:'preview:1',threadId:'preview-task',turnId:'preview-turn'};
 const local=await client.timing!({action:'summary',...common,privacyProfile:'local'});assert.equal(local.action,'summary');
 const share=await client.timing!({action:'summary',...common,privacyProfile:'share-v1'});assert.equal(share.profile,'share-v1');assert.doesNotMatch(JSON.stringify(share),/preview-task|preview-turn|preview:1|collection:turn|event:start|event:end/);
 const page=await client.timing!({action:'evidence',...common});assert.equal(page.action,'evidence');
});
test('evidence and share stay on the fixed version; expired readers stop issuing further queries',async()=>{
 const calls:Parameters<NonNullable<import('@wombat/client').UsageClient['timing']>>[0][]=[];
 const timing=previewTiming('complete');let expired=false;
 const reader=new TimingDetailReader({query:async request=>usageFixture(request,'complete'),timing:async(request,options)=>{calls.push(request);if(expired)throw new (await import('@wombat/client')).CoreError('VIEW_EXPIRED','expired');return timing(request,options);}},'preview:fixed','preview-task','preview-turn');
 const first=await reader.evidence({token:'core-located-page'});assert.equal(first.snapshotId,'preview:fixed');const share=await reader.share();assert.equal(share.profile,'share-v1');assert.ok(calls.every(request=>request.action!=='capabilities'&&request.snapshotId==='preview:fixed'));
 expired=true;await assert.rejects(reader.evidence(),{code:'VIEW_EXPIRED'});const count=calls.length;await assert.rejects(reader.share(),{code:'VIEW_EXPIRED'});assert.equal(calls.length,count);reader.stop();
});
test('initial failures expose recovery actions and old-group refresh errors remain visible beside retained facts',async()=>{
 const {TurnExecution}=await import('../src/tasks/TurnExecution.js');
 const client={query:async(request:import('@wombat/client').UsageRequest)=>usageFixture(request,'complete')};
 const props={client,snapshotId:'preview:1',threadId:'preview-task',turnId:'preview-turn',refresh(){}};
 for(const code of ['VIEW_EXPIRED','SOURCE_UNREADABLE']){
  const first=renderToStaticMarkup(createElement(TurnExecution,{...props,errorCode:code,expired:code==='VIEW_EXPIRED'}));assert.match(first,/role="alert"/);assert.match(first,/<button/);
  const retained=renderToStaticMarkup(createElement(TurnExecution,{...props,summary:timingFixture(),errorCode:code,expired:code==='VIEW_EXPIRED'}));assert.match(retained,/role="alert"/);assert.match(retained,/<strong>10000 ms<\/strong>/);assert.match(retained,/disabled=""/);
 }
});
test('actual ThreadsView renders its turn hook on the server with a stable loading state',async()=>{
 const {ThreadsView}=await import('../src/ThreadsView.js');const {parseRoute}=await import('../src/state.js');
 const route=parseRoute('?page=threads&allTime=true&thread=preview-task');
 const client={query:async(request:import('@wombat/client').UsageRequest)=>usageFixture(request,'complete')};
 const list=usageFixture({action:'threads'},'complete');
 const html=renderToStaticMarkup(createElement(ThreadsView,{client,data:{list,overview:list,route},route,navigate(){},refresh(){},basis(){},usage(){},empty:null}));
 assert.match(html,/task-turns/);assert.match(html,/role="status"/);assert.doesNotMatch(html,/Missing getServerSnapshot/);
});
test('dense core tracks fold by category without dropping intervals or creating object use counts',()=>{
 const summary=timingFixture('dense'),html=render(summary);assert.equal(summary.time.timeline.tracks.length,200);assert.equal((html.match(/aria-label="[^"<>]* ms"/g)??[]).length,201);assert.match(html,/execution-track-group/);assert.doesNotMatch(html,/class="execution-track-group" open/);assert.doesNotMatch(html,/200 uses|200 次/);
});
test('stopping a detail reader prevents late evidence from completing after a target change',async()=>{
 let release!:()=>void,signal:AbortSignal|undefined;const timing=previewTiming('complete');
 const reader=new TimingDetailReader({query:async q=>usageFixture(q,'complete'),timing:async(q,options)=>{signal=options?.signal;await new Promise<void>(resolve=>{release=resolve;});return timing(q);}},'preview:old','preview-task','preview-turn');
 const old=reader.evidence({token:'opaque-locator'},200);reader.stop();assert.equal(signal?.aborted,true);release();await assert.rejects(old,{code:'CANCELLED'});
});
test('execution preview renders the production loading entry without an alternate fake input model',async()=>{
 const {ExecutionPreview}=await import('../src/preview/execution.js');const html=renderToStaticMarkup(createElement(ExecutionPreview,{scenario:'complete'}));assert.match(html,/role="status"/);assert.match(html,/execution/);assert.doesNotMatch(html,/<strong>10000 ms<\/strong>/);
});
test('switching from a pending located interval to an unlocatable interval invalidates and aborts the old read',async()=>{
 const {TimingDetailSelection}=await import('../src/tasks/TurnExecution.js');let release!:()=>void,signal:AbortSignal|undefined;const calls:unknown[]=[];const timing=previewTiming('complete');
 const reader=new TimingDetailReader({query:async q=>usageFixture(q,'complete'),timing:async(q,options)=>{calls.push(q);signal=options?.signal;await new Promise<void>(resolve=>{release=resolve;});return timing(q);}},'preview:fixed','preview-task','preview-turn');
 const selection=new TimingDetailSelection(reader);
 const pages=selection.select('interval-a',[{intervalAlias:'interval-a',pages:[{cursor:{token:'core-page-a'},limit:200,evidenceRefs:['event:a']}]}]);assert.equal(pages?.[0]?.cursor?.token,'core-page-a');
 const pending=selection.read('evidence',pages?.[0]?.cursor??undefined,200);
 assert.deepEqual(selection.select('interval-b',[]),[]);assert.equal(signal?.aborted,true);release();
 const outcome=await pending;assert.equal(outcome.superseded,true);assert.equal(outcome.result,undefined);assert.equal(calls.length,1);
});
test('evidence timestamps show occurrence time in the selected timezone, with epoch milliseconds only in details',async()=>{
 const {TimingEvidenceRecord}=await import('../src/tasks/TurnExecution.js');const timestampMs=Date.UTC(2026,9,5,0,0,0);
 const row={reference:'event:time',recordKind:'lifecycle',phase:'completed',timestampMs,gapCodes:[]};
 for(const [timezone,hour] of [['UTC','00:00:00'],['Asia/Shanghai','08:00:00']]){
  const html=renderToStaticMarkup(createElement(TimingEvidenceRecord,{row,selected:false,timezone}));const primary=html.slice(0,html.indexOf('<details>'));
  assert.match(primary,new RegExp(`2026-10-05 ${hour}`));assert.doesNotMatch(primary,new RegExp(`${timestampMs} ms`));assert.match(html.slice(html.indexOf('<details>')),new RegExp(`${timestampMs} ms`));
 }
 const unknown=renderToStaticMarkup(createElement(TimingEvidenceRecord,{row:{...row,timestampMs:undefined},selected:false,timezone:'UTC'}));assert.doesNotMatch(unknown,/NaN|Invalid Date|未记录 ms|Not recorded ms/);
});
