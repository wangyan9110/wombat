import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {registerHooks} from 'node:module';
import {createUsageClient,type UsageClient} from '@wombat/client';
import {locale,t as copyText} from '@wombat/client/locale';
import {createPreviewClient,type Scenario} from '../src/preview/fixtures.js';
import {readScenarios} from '../src/preview/read-states.js';
import {ruleScenarios} from '../src/preview/rule-examples.js';
import {EmptyUsage,QueryError,emptyReason} from '../src/Feedback.js';
import {FreshnessNotice} from '../src/Preparation.js';
import {UsageView} from '../src/UsageView.js';
import {Workspace} from '../src/workspace.js';
import {parseRoute} from '../src/state.js';
import {AssessmentRows} from '../src/optimize/Assessments.js';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}});
const {Execution}=await import('../src/tasks/Execution.js');
const {ThreadsView}=await import('../src/ThreadsView.js');
const {SuggestionDetail}=await import('../src/optimize/SuggestionDetail.js');
const query={action:'threads' as const,scope:{allTime:true},limit:10},route=()=>parseRoute('?page=usage&allTime=1&timezone=UTC');
const client=(scenario:Scenario):UsageClient=>createUsageClient(createPreviewClient(scenario));
function languages(action:(language:'zh'|'en')=>void){const previous=locale.getSnapshot().locale;try{for(const language of ['zh','en'] as const){locale.setLocale(language);action(language);}}finally{locale.setLocale(previous);}}
const noop=()=>{};
test('source absence unreadability and unsupported format remain distinct in typed shared empty states',async()=>{
 for(const [scenario,reason] of [['source-missing','sourceNotFound'],['source-unreadable','sourceUnreadable'],['source-unsupported','sourceUnsupported']] as const){const c=client(scenario),response=await c.query(query);assert.equal(response.summary.tokens.total,null);assert.equal(response.page.total,0);assert.equal(emptyReason(response),reason);assert.equal(response.quality.sources.length,1);assert.equal((await c.timing!({action:'capabilities'})).action,'capabilities');await assert.rejects(c.timing!({action:'summary',snapshotId:'preview:1',threadId:'preview-task',turnId:'preview-turn'}),{code:'NOT_FOUND'});
 languages(()=>{const html=renderToStaticMarkup(createElement(EmptyUsage,{result:response,sources:noop,clear:noop,dates:noop,filtered:false}));assert.match(html,/<button/);assert.doesNotMatch(html,/NaN|Infinity/);});}
});
test('stale and failed source freshness stay separate from cached fixed pages and are visible beside retained facts',async t=>{
 for(const scenario of ['source-stale','source-sync-failed'] as const){const c=client(scenario),w=new Workspace(c,60_000);t.after(()=>w.stop());await w.navigate(route());const data=w.getSnapshot().data!;assert.equal(data.overview.summary.measurementCount,84);assert.equal(data.overview.freshness?.status,'fixed');assert.equal(data.freshness?.status,scenario==='source-stale'?'stale':'failed');languages(()=>{const notice=renderToStaticMarkup(createElement(FreshnessNotice,{data}));assert.match(notice,/role="status"/);assert.match(notice,/<p/);});}
});
test('session expiry stops workspace retry while fixed-view expiry replaces the whole main group once',async t=>{
 const expired=new Workspace(client('session-expired'),60_000);t.after(()=>expired.stop());await expired.navigate(route());const previous=expired.getSnapshot().data;await expired.check();assert.equal(expired.getSnapshot().data,previous);assert.equal(expired.getSnapshot().errorCode,'HTTP_403');await expired.check();assert.equal(expired.getSnapshot().data,previous);
 languages(()=>{const error=renderToStaticMarkup(createElement(QueryError,{error:'Synthetic browser session expired',code:'HTTP_403',retry:noop}));assert.doesNotMatch(error,/<button/);});
 const moving=new Workspace(client('view-expired'),60_000);t.after(()=>moving.stop());await moving.navigate({...route(),page:'threads'});await moving.navigate({...route(),page:'threads',offset:10});await moving.navigate({...route(),page:'threads',offset:20});const next=moving.getSnapshot().data!;assert.equal(next.overview.snapshotRef.snapshotId,'preview:2');assert.equal(next.list.snapshotRef.snapshotId,'preview:2');assert.equal(moving.getSnapshot().renewed,true);
});
test('priced known subtotals and completely unknown amounts retain recorded Tokens and per-turn metering',async t=>{
 for(const scenario of ['usage-partial-price','usage-unpriced'] as const){const c=client(scenario),w=new Workspace(c,60_000);t.after(()=>w.stop());await w.navigate(route());const data=w.getSnapshot().data!;assert.equal(data.overview.summary.tokens.total,92400);assert.equal(data.overview.summary.price.cost,null);assert.equal(data.overview.summary.price.status,scenario==='usage-partial-price'?'partial':'unknown');assert.equal(data.overview.summary.unpricedTokens,scenario==='usage-partial-price'?46200:92400);
 languages(language=>{const html=renderToStaticMarkup(createElement(UsageView,{client:c,data,route:route(),empty:null,setReading:noop,refresh:noop,navigate:noop,drill:noop,usage:noop,basis:noop}));assert.match(html,/92,400/);assert.doesNotMatch(html,/NaN|Infinity/);if(scenario==='usage-partial-price')assert.ok(html.includes(copyText('webui.knownSubtotal')));});
 if(scenario==='usage-partial-price'){const turns=await c.query({action:'turns',threadId:'preview-task',scope:{allTime:true}});assert.equal(turns.summary.price.knownCost,'0.001000');const first=await c.query({action:'steps',threadId:'preview-task',turnId:'preview-turn',scope:{allTime:true}}),second=await c.query({action:'steps',threadId:'preview-task',turnId:'preview-task-turn-2',scope:{allTime:true}});assert.equal(first.summary.price.status,'priced');assert.equal(second.summary.price.status,'unknown');assert.equal(Number(first.summary.price.knownCost)+Number(second.summary.price.knownCost),Number(turns.summary.price.knownCost));}
 }
});
test('unknown project and unassigned measurement turn remain scopeable without invented reliable turn membership',async()=>{
 const c=client('usage-unassigned'),list=await c.query({...query,scope:{allTime:true,projectUnknown:true}});assert.equal(list.page.total,1);assert.equal(list.summary.measurementCount,2);assert.equal(list.facets?.hasUnassigned,true);const row=list.items[0];assert.equal(row.kind,'thread');if(row.kind!=='thread')return;assert.equal(row.project,null);assert.equal(row.matchedTurnCount,1);const turns=await c.query({action:'turns',threadId:row.id,scope:{allTime:true}}),unassigned=turns.items.find(item=>item.kind==='turn'&&item.ordinal===null);assert.ok(unassigned&&unassigned.kind==='turn');const steps=await c.query({action:'steps',threadId:row.id,turnId:unassigned.id,scope:{allTime:true}});assert.equal(steps.summary.measurementCount,1);assert.ok(steps.items[0].kind==='measurement');assert.equal(steps.items[0].turnId,null);await assert.rejects(c.timing!({action:'summary',snapshotId:'preview:1',threadId:row.id,turnId:unassigned.id}),{code:'NOT_FOUND'});
 languages(language=>{const current={...route(),page:'threads' as const,unassigned:true},html=renderToStaticMarkup(createElement(ThreadsView,{client:c,data:{list,overview:list,route:current},route:current,navigate:noop,refresh:noop,basis:noop,usage:noop,empty:null}));assert.match(html,language==='zh'?/项目归属未知/:/Unknown project|Project unknown|Unassigned/i);});
});
test('all static rule examples enter the actual suggestion detail with safe diagnostics or authorized missing target evidence',async()=>{
 for(const scenario of ['rules-format','rules-reference','rules-hook'] as const){const c=client(scenario),result=await c.optimize!({action:'list'}),selected=result.suggestions[0];assert.ok(selected);assert.equal(selected.checks[0].outcome,'hit');assert.equal(selected.reviewBaseline?.item.id,selected.item.id);assert.equal((await c.optimize!({action:'list',project:'/outside'})).suggestions.length,0);
 languages(language=>{const html=renderToStaticMarkup(createElement(SuggestionDetail,{selected,result,client:c,route:{...route(),page:'optimize',suggestion:selected.id},busy:false,navigate:noop,refresh:noop,run:async()=>{}}));assert.match(html,/\/synthetic\/wombat/);if(scenario==='rules-format'){assert.match(html,/SKILL\.md/);assert.match(html,/array/);assert.match(html,/string/);assert.match(html,language==='zh'?/错误原因/:/Reason/);}else assert.match(html,scenario==='rules-hook'?/hooks\/missing\.js/:/docs\/missing\.md/);});
 const retained=await c.optimize!({action:'keep',suggestionId:selected.id,decisionReason:'necessary'});assert.equal(retained.suggestions[0].decision?.kind,'keep');const checked=await c.optimize!({action:'recheck',suggestionId:selected.id});assert.equal(checked.suggestions[0].decision?.kind,'keep');assert.equal(checked.suggestions[0].checks[0].outcome,'hit');assert.deepEqual(checked.suggestions[0].reviewBaseline,result.suggestions[0].reviewBaseline);
 }
});
test('clean static checks are complete misses with explicit measurements rather than empty or unsupported assessments',async()=>{
 const c=client('rules-clean'),result=await c.optimize!({action:'list'});assert.equal(result.suggestions.length,0);assert.equal(result.pending,0);assert.equal(result.checks.length,1);assert.equal(result.checks[0].outcome,'miss');assert.deepEqual(result.checks[0].basis.measurement,{kind:'static',complete:true,findings:0});languages(language=>{const html=renderToStaticMarkup(createElement(AssessmentRows,{checks:result.checks,timezone:'UTC'}));assert.match(html,language==='zh'?/未发现问题/:/No issue|No finding|No problem|check found no/i);assert.match(html,language==='zh'?/已完整检查/:/Completely checked/);});
});
test('cancelled failed and interrupted scenarios use only declared turn states and retain unknown interruption timing',async()=>{
 for(const [scenario,state] of [['cancelled','cancelled'],['failed','failed'],['interrupted','unknown']] as const){const response=await client(scenario).timing!({action:'summary',snapshotId:'preview:1',threadId:'preview-task',turnId:'preview-turn'});assert.ok(response.action==='summary'&&response.profile==='local');assert.equal(response.time.state,state);if(scenario==='interrupted'){assert.equal(response.time.nativeWallClockMs.value,null);assert.equal(response.quality.censored,true);}languages(()=>{const html=renderToStaticMarkup(createElement(Execution,{summary:response,refresh:noop,onEvidence:noop,onShare:noop}));assert.doesNotMatch(html,/NaN|Infinity/);});}
});
test('all declared additional scenario transports pass current generated contracts',async()=>{
 for(const scenario of [...readScenarios,...ruleScenarios,'cancelled','failed','interrupted'] as const){const c=client(scenario);await c.query(query);await c.config!({action:'list'});await c.optimize!({action:'list'});await c.prices({action:'status'});}
});
