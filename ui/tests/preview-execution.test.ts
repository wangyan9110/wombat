import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createUsageClient} from '@wombat/client';
import {locale,t} from '@wombat/client/locale';
import {timingFixture,previewTiming} from '../src/preview/timing.js';
import {usageFixture} from '../src/preview/fixtures.js';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}});
const {Execution}=await import('../src/tasks/Execution.js');
const {TimingDetailReader}=await import('../src/tasks/TurnExecution.js');
const render=(summary:ReturnType<typeof timingFixture>)=>renderToStaticMarkup(createElement(Execution,{summary,refresh(){},onEvidence(){},onShare(){}}));
test('production execution consumes real DTOs, keeps zero unknown and five states distinct in both languages',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);for(const state of ['completed','running','failed','cancelled','unknown'] as const){const summary=timingFixture();summary.time.state=state;summary.time.nativeWallClockMs.value=0;const html=render(summary);assert.match(html,language==='zh'?/执行过程/:/Execution/);if(state==='running')assert.doesNotMatch(html,/<strong>0 ms<\/strong>/);else assert.match(html,/<strong>0 ms<\/strong>/);if(state==='unknown')assert.doesNotMatch(html,language==='zh'?/现有时间记录不足以确认轮次状态/:/Available timing records do not establish the turn state/);assert.doesNotMatch(html,language==='zh'?/对象级使用投影尚未提供/:/Object-level use projection is not available/);}}}finally{locale.setLocale(previous);}
});
test('missing reliable window uses the same production list fallback and unknowns never become zero',()=>{
 const html=render(timingFixture('missing'));assert.match(html,/execution-no-window/);assert.doesNotMatch(html,/NaN|Infinity|<strong>0 ms<\/strong>/);assert.match(html,/missing_time/);assert.ok(html.includes(t('timing.partial')));
});
test('missing measures and quality reasons use basis-specific explanations in both locales',()=>{
 const summary=timingFixture('missing');summary.time.nativeWallClockMs.basis='missing_time';summary.quality.reasonCodes=['missing_time','source_partial','boundary_conflict'];summary.coverage.sourceStatus='partial';
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['en','zh'] as const){locale.setLocale(language);const html=render(summary);if(language==='en'){assert.match(html,/Usable timing records are missing for calculation or placement/);assert.match(html,/Some source records or required evidence are incomplete/);assert.match(html,/Boundary or content evidence conflicts across records/);assert.match(html,/missing_time, source_partial, boundary_conflict/);assert.doesNotMatch(html,/Timing is incomplete\. Missing is not zero/);}else{assert.match(html,/缺少可用于计算或定位的时间记录/);assert.match(html,/部分来源记录或所需依据不完整/);assert.match(html,/记录中的边界或内容依据存在冲突/);assert.match(html,/missing_time, source_partial, boundary_conflict/);assert.doesNotMatch(html,/时间记录不完整。未记录不等于零/);}}}finally{locale.setLocale(previous);}
});
test('running and censored timing have separate explanations; partial without reasons stays a neutral status',()=>{
 const previous=locale.getSnapshot().locale;
 try{locale.setLocale('en');const running=render(timingFixture('running'));assert.match(running,/The turn is still running; only observed records are shown/);assert.match(running,/Results are limited to the current observation window/);const partial=timingFixture('missing');partial.quality.reasonCodes=[];assert.match(render(partial),/Partial results/);}finally{locale.setLocale(previous);}
});
test('timeline and expandable distribution preserve core ranges and concurrent union versus sum',()=>{
 const summary=timingFixture(),html=render(summary);assert.equal(summary.time.command.unionMs.value,3020);assert.equal(summary.time.command.sumMs.value,9000);assert.match(html,/1000–4000 ms/);assert.match(html,/3020 ms/);assert.match(html,/9000 ms/);assert.doesNotMatch(html,/11000 ms/);assert.match(html,/execution-gap/);assert.equal(summary.time.timeline.tracks.length,3);
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
 const summary=timingFixture('dense'),html=render(summary);assert.equal(summary.time.timeline.tracks.length,200);assert.equal((html.match(/aria-label="[^"<>]* ms"/g)??[]).length,200);assert.match(html,/execution-track-group/);assert.doesNotMatch(html,/class="execution-track-group" open/);assert.doesNotMatch(html,/200 uses|200 次/);
});
test('stopping a detail reader prevents late evidence from completing after a target change',async()=>{
 let release!:()=>void,signal:AbortSignal|undefined;const timing=previewTiming('complete');
 const reader=new TimingDetailReader({query:async q=>usageFixture(q,'complete'),timing:async(q,options)=>{signal=options?.signal;await new Promise<void>(resolve=>{release=resolve;});return timing(q);}},'preview:old','preview-task','preview-turn');
 const old=reader.evidence({token:'opaque-locator'},200);reader.stop();assert.equal(signal?.aborted,true);release();await assert.rejects(old,{code:'CANCELLED'});
});
test('execution preview renders the production loading entry without an alternate fake input model',async()=>{
 const {ExecutionPreview}=await import('../src/preview/execution.js');const html=renderToStaticMarkup(createElement(ExecutionPreview,{scenario:'complete'}));assert.match(html,/role="status"/);assert.match(html,/execution/);assert.doesNotMatch(html,/<strong>10000 ms<\/strong>/);
});
test('execution preview validates full snapshot metadata and commits a fixed turn group through the public client',async()=>{
 const {createExecutionPreviewClient}=await import('../src/preview/execution.js');const {TurnReadGroup}=await import('../src/useTiming.js');
 const request={action:'turns',snapshotId:'preview:2',threadId:'preview-task',scope:{allTime:true,timezone:'UTC'}} as const;
 for(const scenario of ['complete','running','missing','dense','cancelled','interrupted','failed','empty'] as const){
  const client=createExecutionPreviewClient(scenario),usage=await client.query(request);
  assert.deepEqual(usage.snapshotRef,{...usageFixture(request,scenario).snapshotRef,snapshotId:'preview:2'});
  const group=new TurnReadGroup(client);await group.read(request,'preview-turn');const state=group.getSnapshot();
  assert.equal(state.errorCode,undefined);assert.equal(state.loading,false);assert.equal(state.usage?.snapshotRef.snapshotId,'preview:2');
  if(scenario==='empty')assert.equal(state.summary,undefined);else assert.equal(state.summary?.readView.snapshotId,'preview:2');
  group.stop();
 }
 const failed=new TurnReadGroup(createExecutionPreviewClient('error'));await failed.read(request,'preview-turn');
 assert.equal(failed.getSnapshot().errorCode,'SOURCE_UNREADABLE');assert.equal(failed.getSnapshot().summary,undefined);failed.stop();
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
test('events without an applicable phase do not receive a missing-state label',async()=>{
 const {TimingEvidenceRecord}=await import('../src/tasks/TurnExecution.js');const row={reference:'event:no-phase',recordKind:'message',phase:null,timestampMs:null,gapCodes:[]};const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);for(const phase of [null,'unknown'] as const){const html=renderToStaticMarkup(createElement(TimingEvidenceRecord,{row:{...row,phase},selected:false,timezone:'UTC'}));const primary=html.slice(0,html.indexOf('<details>'));assert.doesNotMatch(primary,language==='zh'?/现有时间记录不足以确认轮次状态|状态未知|未知/:/Available timing records do not establish the turn state|Status unknown|Unknown/);assert.match(primary,language==='zh'?/安全事实记录/:/Safe fact record/);if(phase==='unknown')assert.match(html,/unknown/);}}}finally{locale.setLocale(previous);}
});

test('MCP-only and four-category previews render production tracks and core intersections in both languages',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){
  locale.setLocale(language);
  const only=timingFixture('mcp-only'),mixed=timingFixture('mcp-mixed');
  assert.deepEqual(only.time.timeline.tracks.map(track=>track.category),['mcp']);
  assert.equal(only.time.mcp.unionMs.value,5000);assert.equal(only.time.command.unionMs.value,0);
  assert.equal(only.time.coveredMs.value,5000);assert.equal(only.time.intersectionMasksMs[8].value,5000);
  assert.equal(only.time.intersectionMasksMs.length,16);
  const onlyHtml=render(only);assert.match(onlyHtml,language==='zh'?/<summary>MCP 调用<\/summary>/:/<summary>MCP calls<\/summary>/);assert.match(onlyHtml,/2000–7000 ms/);assert.match(onlyHtml,/5000 ms/);
  assert.deepEqual(mixed.time.timeline.tracks.map(track=>track.category),['command','compaction','reasoning','mcp']);
  assert.deepEqual(mixed.time.intersectionMasksMs.map(metric=>metric.value),[2000,2000,0,1000,1000,0,0,1000,0,0,0,0,1000,1000,0,1000]);
  assert.equal(mixed.time.coveredMs.value,8000);assert.equal(mixed.time.unclassifiedMs.value,2000);
  const html=render(mixed);assert.match(html,language==='zh'?/命令 ∩ 压缩 ∩ 推理 ∩ MCP 调用/:/Commands ∩ Compaction ∩ Reasoning ∩ MCP calls/);assert.match(html,/4000–7000 ms/);assert.match(html,/8000 ms/);assert.doesNotMatch(html,/17000 ms/);
  mixed.time.coveredMs.value=7777;assert.match(render(mixed),/7777 ms/);
 }}finally{locale.setLocale(previous);}
});
test('MCP preview uses the public validator for local and share; sharing has relative coordinates and no tool identities',async()=>{
 for(const scenario of ['mcp-only','mcp-mixed'] as const){
  const client=createUsageClient({query:async request=>usageFixture(request,scenario),timing:previewTiming(scenario)});
  const common={snapshotId:'preview:1',threadId:'preview-task',turnId:'preview-turn'};
  const local=await client.timing!({action:'summary',...common});assert.ok('time' in local);assert.equal(local.time.mcp.unionMs.value,scenario==='mcp-only'?5000:3000);
  const share=await client.timing!({action:'summary',...common,privacyProfile:'share-v1'});assert.ok('time' in share);assert.equal(share.time.timeline.tracks.find(track=>track.category==='mcp')?.startMs,scenario==='mcp-only'?2000:4000);
  assert.doesNotMatch(JSON.stringify(share),/server|tool|preview-task|preview-turn|preview:1|collection:turn|event:start|event:end/);
 }
});

test('event evidence displays native duration and first Token delay without inventing timestamps',async()=>{
 const {TimingEvidenceRecord}=await import('../src/tasks/TurnExecution.js');
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  for(const durationMs of [0,25]){
   const row={reference:'event:native',recordKind:'turn',phase:'completed',timestampMs:null,durationMs,firstTokenMs:0,gapCodes:['missing_time']};
   const html=renderToStaticMarkup(createElement(TimingEvidenceRecord,{row,selected:false,timezone:'UTC'}));
   assert.ok(html.includes(`${t('execution.nativeDuration')} · ${durationMs} ms`));
   assert.ok(html.includes(`${t('execution.nativeTtft')} · 0 ms`));
   assert.doesNotMatch(html,/NaN|Invalid Date/);
   const absent=renderToStaticMarkup(createElement(TimingEvidenceRecord,{row:{...row,durationMs:null,firstTokenMs:null},selected:false,timezone:'UTC'}));
   assert.ok(!absent.includes(t('execution.nativeDuration')));assert.ok(!absent.includes(t('execution.nativeTtft')));
  }
 }}finally{locale.setLocale(saved);}
});

test('operation residual uses shared components with independent union and explicit bounded coverage explanations',()=>{
 const previous=locale.getSnapshot().locale;
 try {for(const language of ['en','zh'] as const){locale.setLocale(language);const mixed=timingFixture('mcp-mixed');assert.equal(mixed.time.unclassifiedMs.value,2000);assert.equal(mixed.time.operationCoverage.residualMs.value,3000);const html=render(mixed);assert.match(html,/7000–10000 ms/);assert.match(html,/3000 ms/);assert.doesNotMatch(html,/execution\.operations\.|undefined/);
 const noPairs=timingFixture();noPairs.time.operationCoverage.coveredMs.value=0;noPairs.time.operationCoverage.reasonCodes=['no_paired_operations','identity_gaps','source_partial','detail_limit'];noPairs.time.operationCoverage.detail={support:'unavailable',reason:'resource_limit'};noPairs.time.operationCoverage.residualRanges=[];noPairs.time.operationCoverage.residualRangeCount.value=250;const limited=render(noPairs);assert.match(limited,/0 ms/);assert.match(limited,/250/);assert.match(limited,language==='en'?/no operation duration was subtracted/:/没有从轮次窗口减去操作时长/);assert.match(limited,language==='en'?/full durations and interval counts remain/:/完整时长和区间数量仍保留/);}}
 finally{locale.setLocale(previous);}
});

test('repeat production panel preserves subtotal coverage and explains all core reasons in both locales',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['en','zh'] as const){
  locale.setLocale(language);const fixture=timingFixture(),r=fixture.time.repeatedBehavior;
  r.afterFailure.count.value=2;r.afterFailure.duration.missingCount.value=1;r.combinedOperationCount.value=2;r.coverage.partial=true;
  r.coverage.reasonCodes=['missing_matching','excluded_receivers','identity_gaps','conflicting_operations','missing_start','indeterminate_outcomes','order_gaps','context_boundaries','crossed_context','missing_clock_domain','source_metadata_gaps','duration_conflicts','missing_durations','missing_recovery_spans','missing_intervals','missing_window','source_partial','resource_limit','numeric_range'];
  const html=render(fixture);
  assert.match(html,language==='en'?/Known duration subtotal: 40 ms/:/可计算耗时小计: 40 ms/);
  assert.match(html,language==='en'?/equal ranges, file versions and content are not established/:/未据此判定读取范围、文件版本或内容相同/);
  assert.match(html,language==='en'?/not wasted time/:/不表示浪费/);
  assert.doesNotMatch(html,/execution\.repeats\.|timing\.basis\.repeat|undefined|NaN|未知/);
  const missing=render(timingFixture('missing'));assert.match(missing,language==='en'?/request observation counts remain available/:/请求出现次数仍可保留/);
 }}finally{locale.setLocale(previous);}
});
