import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CoreError,createUsageClient,type TimingResult,type UsageClient,type TimingRequest} from '@wombat/client';
import {locale,t} from '@wombat/client/locale';
import {timingFixture,previewTiming,timingShareFixture} from '../src/preview/timing.js';
import {useRefs} from '../src/preview/uses.js';
import {usageFixture} from '../src/preview/fixtures.js';
import {UsesSelection} from '../src/tasks/uses-reader.js';
import {TurnUses,UseObjectRow,UseRecordRow} from '../src/tasks/Uses.js';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}});
const {TurnExecution}=await import('../src/tasks/TurnExecution.js');
const common={snapshotId:'preview:1',threadId:'preview-task',turnId:'preview-turn'};
function client(scenario:Parameters<typeof previewTiming>[0]='complete') {return createUsageClient({query:async q=>usageFixture(q,'complete'),timing:previewTiming(scenario)});}
test('real validators accept use summaries, object pages and record pages without counting replay or page rows as uses',async()=>{
 const c=client('dense'),summary=await c.timing!({action:'summary',...common});assert.ok(summary.action==='summary'&&summary.profile==='local');assert.equal(summary.uses.objects.length,50);assert.equal(summary.uses.totals.objectCount.value,53);assert.ok(summary.uses.nextCursor);
 assert.equal(summary.uses.objects[2].associatedUseCount.value,0);assert.equal(summary.uses.objects[2].associatedUseCount.basis,'canonical_use_identity');assert.equal(summary.uses.objects[3].associatedUseCount.value,0);assert.equal(summary.uses.objects[0].project,null);const mcp=await c.timing!({action:'evidence',collection:'use_records',objectRef:useRefs.mcp,...common});assert.ok(mcp.action==='evidence'&&mcp.collection==='use_records');assert.equal(mcp.rows.length,3);assert.equal(mcp.rows.filter(row=>row.replayOf===null).length,2);assert.equal(summary.uses.objects[1].associatedUseCount.value,2);assert.equal(summary.uses.objects[1].associatedUseCount.basis,'canonical_use_identity');assert.equal(mcp.rows[2].replayOf,'use:mcp-1');assert.equal(mcp.totals.unassignedMcpRecords.value,1);assert.ok(mcp.rows.every(row=>!row.gapCodes.includes('missing_turn')));
 const page=await c.timing!({action:'evidence',collection:'use_objects',...common,cursor:summary.uses.nextCursor,limit:200});assert.ok(page.action==='evidence'&&page.collection==='use_objects');assert.equal(page.rows.length,3);assert.equal(page.total.value,53);assert.deepEqual(page.totals,summary.uses.totals);
 const records=await c.timing!({action:'evidence',collection:'use_records',objectRef:useRefs.skill,...common,limit:2});assert.ok(records.action==='evidence'&&records.collection==='use_records');assert.equal(records.total.value,214);assert.equal(records.rows[1].outcome,'failed');assert.ok(records.nextCursor);
 const next=await c.timing!({action:'evidence',collection:'use_records',objectRef:useRefs.skill,...common,limit:2,cursor:records.nextCursor});assert.ok(next.action==='evidence'&&next.collection==='use_records');assert.equal(next.rows[1].replayOf,'use:skill-1');assert.equal(summary.uses.objects[0].useCount.value,213);assert.equal(next.total.value,214);
 const firstFull=await c.timing!({action:'evidence',collection:'use_records',objectRef:useRefs.skill,...common,limit:200});assert.ok(firstFull.action==='evidence'&&firstFull.collection==='use_records');assert.equal(firstFull.rows.length,200);assert.ok(firstFull.nextCursor);const last=await c.timing!({action:'evidence',collection:'use_records',objectRef:useRefs.skill,...common,limit:200,cursor:firstFull.nextCursor});assert.ok(last.action==='evidence'&&last.collection==='use_records');assert.equal(last.rows.length,14);assert.equal(last.total.value,214);assert.deepEqual(last.totals,summary.uses.totals);
 await assert.rejects(c.timing!({action:'evidence',collection:'use_records',objectRef:useRefs.mcp,...common,cursor:records.nextCursor}),{code:'INVALID_CURSOR'});
 await assert.rejects(c.timing!({action:'evidence',collection:'use_records',objectRef:useRefs.skill,...common,snapshotId:'preview:other',cursor:records.nextCursor}),{code:'INVALID_CURSOR'});
 await assert.rejects(c.timing!({action:'evidence',collection:'use_objects',...common,cursor:records.nextCursor}),{code:'INVALID_CURSOR'});
});
test('known empty and missing use facts remain distinct and share contains only numeric use totals',async()=>{
 for(const scenario of ['empty','missing','complete','running'] as const){const c=client(scenario);const response=await c.timing!({action:'summary',...common});assert.ok(response.action==='summary'&&response.profile==='local');if(scenario==='empty')assert.equal(response.uses.totals.recordCount.value,0);if(scenario==='missing')assert.equal(response.uses.totals.recordCount.value,null);const share=await c.timing!({action:'summary',privacyProfile:'share-v1',...common});assert.ok(share.action==='summary'&&share.profile==='share-v1');assert.deepEqual(share.uses,response.uses.totals);assert.doesNotMatch(JSON.stringify(share),/\/synthetic|object:|use:skill|synthetic-tools|preview:1|preview-task/);}
 assert.doesNotMatch(JSON.stringify(timingShareFixture(timingFixture())),/"objects"|"path"|"server"|"project"/);
});
test('production use components label whole-turn versus associated counts and preserve zero unknown and all states in both languages',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const summary=timingFixture();const html=renderToStaticMarkup(createElement(TurnUses,{client:client(),summary,refresh(){},onExpired(){},timezone:'UTC'}));assert.match(html,language==='zh'?/使用次数/:/Uses/);assert.match(html,language==='zh'?/已关联次数/:/Associated uses/);assert.match(html,/SKILL\.md/);assert.match(html,/synthetic-tools/);assert.match(html,language==='zh'?/候选，未确认派发/:/Candidate, dispatch unconfirmed/);assert.match(html,language==='zh'?/未分类/:/Unclassified/);assert.match(html,/<dd>0<\/dd>/);assert.match(html,language==='zh'?/完整使用次数/:/Full use count/);assert.match(html,language==='zh'?/0 不证明未使用/:/0 does not prove absence of use/);
 const object={...summary.uses.objects[0],useCount:{...summary.uses.objects[0].useCount,value:99},associatedUseCount:{...summary.uses.objects[0].associatedUseCount,value:30}};const row=renderToStaticMarkup(createElement(UseObjectRow,{object,inspect(){}}));assert.match(row,/<dd>99<\/dd>/);assert.match(row,/<dd>30<\/dd>/);assert.doesNotMatch(row,/<dd>4<\/dd>.*<dd>4<\/dd>/);
 const empty=renderToStaticMarkup(createElement(TurnUses,{client:client(),summary:timingFixture('empty'),refresh(){},onExpired(){},timezone:'UTC'}));assert.match(empty,language==='zh'?/没有可展示的使用对象/:/No use objects can be shown/);
 }}finally{locale.setLocale(saved);}
});
test('production record presentation shows native zero, failure, replay, gaps and occurrence time without inventing duration',async()=>{
 const page=await client().timing!({action:'evidence',collection:'use_records',...common,objectRef:useRefs.skill});assert.ok(page.action==='evidence'&&page.collection==='use_records');const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);for(const row of page.rows){const html=renderToStaticMarkup(createElement(UseRecordRow,{row,timezone:'UTC'}));if(row.nativeDurationMs===0)assert.match(html,/0 ms/);if(row.outcome==='failed')assert.match(html,language==='zh'?/失败/:/Failed/);if(row.replayOf)assert.match(html,language==='zh'?/事件重放/:/Event replay/);const primary=html.slice(0,html.indexOf('<details>'));assert.match(primary,/2026-10-04 02:00:00/);assert.doesNotMatch(primary,/1791079200000 ms/);}
 const row={...page.rows[0],outcome:'failed' as const,nativeDurationMs:null,timestampMs:null,gapCodes:['missing_time']};const noOptionalTime=renderToStaticMarkup(createElement(UseRecordRow,{row,timezone:'UTC'}));const primary=noOptionalTime.slice(0,noOptionalTime.indexOf('<details>'));assert.doesNotMatch(primary,/未记录|Not recorded|Invalid Date|NaN/);assert.match(primary,language==='zh'?/失败/:/Failed/);assert.match(noOptionalTime,/missing_time/);
 const declined=renderToStaticMarkup(createElement(UseRecordRow,{row:{...row,outcome:'declined'},timezone:'UTC'}));assert.match(declined,language==='zh'?/已拒绝/:/Declined/);
 const conflict=renderToStaticMarkup(createElement(UseRecordRow,{row:{...row,state:'candidate',outcome:'unknown',gapCodes:['operation_result_conflict']},timezone:'UTC'}));const conflictPrimary=conflict.slice(0,conflict.indexOf('<details>'));assert.match(conflictPrimary,language==='zh'?/候选/:/Candidate/);assert.doesNotMatch(conflictPrimary,language==='zh'?/尚未确认结果|结果未知/:/Outcome not established|Outcome unknown/);assert.match(conflict,language==='zh'?/结果记录不一致/:/Result records conflict/);assert.match(conflict,/operation_result_conflict/);
 }}finally{locale.setLocale(saved);}
});
test('actual turn execution includes uses from its summary and expiry disables every use detail action',()=>{
 const summary=timingFixture('dense'),html=renderToStaticMarkup(createElement(TurnExecution,{client:client('dense'),summary,...common,expired:true,refresh(){}}));assert.match(html,/53/);assert.match(html,/SKILL\.md/);assert.doesNotMatch(html,/对象级使用投影尚未提供|Object-level use projection is not available/);const uses=html.slice(html.indexOf('aria-label="'+t('execution.uses')+'"'));assert.match(uses,/disabled=""/);
});
test('use reader binds collection, method, source, target, object and snapshot and never selects a new view',async()=>{
 const calls:TimingRequest[]=[],summary=timingFixture();const timing=previewTiming('complete');const c:UsageClient={query:async q=>usageFixture(q,'complete'),timing:async(request,options)=>{calls.push(request);return timing(request,options);}};const reader=new UsesSelection(c,summary);
 const outcome=await reader.read({collection:'use_records',objectRef:useRefs.skill});assert.ok(outcome.result?.collection==='use_records');assert.equal(calls[0].action,'evidence');assert.ok(calls[0].action==='evidence');assert.equal(calls[0].snapshotId,summary.readView.snapshotId);assert.equal(calls[0].scope?.sourceInstanceId,summary.scope.sourceInstanceId);assert.equal(calls[0].limit,200);assert.equal('mode' in calls[0],false);
 for(const mutate of [(r:any)=>({...r,snapshotId:'other'}),(r:any)=>({...r,methodVersion:'other'}),(r:any)=>({...r,collection:'turn_events'}),(r:any)=>({...r,scope:{...r.scope,turnId:'other'}}),(r:any)=>({...r,scope:{...r.scope,sourceInstanceId:'other'}}),(r:any)=>({...r,objectRef:'other'})]){const wrong=new UsesSelection({...c,timing:async request=>mutate(await timing(request)) as TimingResult},summary);const result=await wrong.read({collection:'use_records',objectRef:useRefs.skill});assert.equal((result.error as CoreError).code,'PROTOCOL_ERROR');}
});
test('changing object selection and cancelling suppress late responses even when transport ignores abort',async()=>{
 const pending:{release:()=>void;request:TimingRequest;signal?:AbortSignal}[]=[];const timing=previewTiming('complete');const reader=new UsesSelection({query:async q=>usageFixture(q,'complete'),timing:async(request,options)=>{await new Promise<void>(release=>pending.push({release,request,signal:options?.signal}));return timing(request);}},timingFixture());
 const old=reader.read({collection:'use_records',objectRef:useRefs.skill}),current=reader.read({collection:'use_records',objectRef:useRefs.mcp});assert.equal(pending[0].signal?.aborted,true);pending[1].release();const next=await current;assert.ok(next.result?.collection==='use_records');assert.equal(next.result.objectRef,useRefs.mcp);pending[0].release();assert.equal((await old).superseded,true);
 const stopped=reader.read({collection:'use_objects'});reader.stop();pending[2].release();const cancelled=await stopped;assert.equal(cancelled.superseded,true);assert.equal(cancelled.result,undefined);
});
test('expiration stops further fixed reads and a superseded expired response cannot poison the current selection',async()=>{
 let calls=0;const summary=timingFixture(),reader=new UsesSelection({query:async q=>usageFixture(q,'complete'),timing:async()=>{calls++;throw new CoreError('VIEW_EXPIRED','expired');}},summary);assert.equal(((await reader.read({collection:'use_objects'})).error as CoreError).code,'VIEW_EXPIRED');await reader.read({collection:'use_records'});assert.equal(calls,1);
 let reject!:(e:Error)=>void;const timing=previewTiming('complete');let first=true;const current=new UsesSelection({query:async q=>usageFixture(q,'complete'),timing:async request=>{if(first){first=false;return new Promise((_,r)=>{reject=r;});}return timing(request);}},summary);const old=current.read({collection:'use_records',objectRef:useRefs.skill});assert.ok((await current.read({collection:'use_objects'})).result);reject(new CoreError('VIEW_EXPIRED','old expired'));assert.equal((await old).superseded,true);assert.equal(current.expired,false);
});
test('use detail failure and expiry scenarios keep the same useful summary and return safe fixed errors',async()=>{
 for(const scenario of ['uses-failure','uses-expired'] as const){const c=client(scenario);const summary=await c.timing!({action:'summary',...common});assert.ok(summary.action==='summary'&&summary.profile==='local');const original=structuredClone(summary);await assert.rejects(c.timing!({action:'evidence',collection:'use_records',...common}),{code:scenario==='uses-expired'?'VIEW_EXPIRED':'SOURCE_UNREADABLE'});assert.deepEqual(summary,original);}
});
test('use expiry latches the shared detail selection before late event failure or successful share can commit',async()=>{
 const {TimingDetailReader,TimingDetailSelection}=await import('../src/tasks/TurnExecution.js');
 for(const late of ['SOURCE_UNREADABLE','share'] as const){let release!:()=>void,signal:AbortSignal|undefined,calls=0;const timing=previewTiming('complete');const reader=new TimingDetailReader({query:async q=>usageFixture(q,'complete'),timing:async(request,options)=>{calls++;signal=options?.signal;await new Promise<void>(resolve=>{release=resolve;});if(late==='SOURCE_UNREADABLE')throw new CoreError(late,'late failure');return timing(request);}},common.snapshotId,common.threadId,common.turnId);const selection=new TimingDetailSelection(reader);
  const pending=selection.read(late==='share'?'share':'evidence');selection.expire();assert.equal(signal?.aborted,true);release();const outcome=await pending;assert.equal(outcome.superseded,true);assert.equal(outcome.result,undefined);assert.equal(reader.expired,true);const stopped=await selection.read('share');assert.equal((stopped.error as CoreError).code,'VIEW_EXPIRED');assert.equal(calls,1);
 }
 const replacement=new TimingDetailSelection(new TimingDetailReader(client(),common.snapshotId,common.threadId,common.turnId));assert.ok((await replacement.read('share')).result);
});


test('partial use objects show retained associated counts before whole counts and explain partial zero', () => {
 const saved=locale.getSnapshot().locale;
 try {for(const language of ['zh','en'] as const){locale.setLocale(language);
  const summary=timingFixture();
  for(const index of [1,2,3]){
   const object=summary.uses.objects[index];
   const html=renderToStaticMarkup(createElement(UseObjectRow,{object,inspect(){}}));
   assert.match(html,new RegExp(`<dd>${object.associatedUseCount.value}</dd>`));
   assert.match(html,language==='zh'?/完整使用次数/:/Full use count/);
   assert.match(html,language==='zh'?/证据缺口/:/evidence gaps/);
   assert.match(html,language==='zh'?/0 不证明未使用/:/0 does not prove absence of use/);
   assert.doesNotMatch(html,/<dd>未记录<\/dd>|<dd>Not recorded<\/dd>/);
   assert.equal(object.associatedUseCount.status,'observed');
   assert.equal(object.useCount.value,null);
  }
 }}finally{locale.setLocale(saved);}
});
