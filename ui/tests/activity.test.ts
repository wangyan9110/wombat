import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {locale} from '@wombat/client/locale';
import {registerHooks} from 'node:module';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}});
const {createExecutionPreviewClient}=await import('../src/preview/execution.js');
import {ActivityFacts} from '../src/tasks/ActivityInspection.js';
test('production activity preview retains positive advice, fixed scope and partial request observations',async()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const scenario of ['complete','missing','mcp-only'] as const){
  const client=createExecutionPreviewClient(scenario);
  const result=await client.optimize!({action:'activity',activity:{snapshotId:'preview:fixed',threadId:'preview-task',turnId:'preview-turn'},sourceInstanceId:'preview'});
  assert.ok(result.activity);assert.equal(result.activity.readView.snapshotId,'preview:fixed');
  assert.deepEqual(result.activity.advice,scenario==='complete'?['inspect_calls_after_failure','inspect_repeated_reads']:scenario==='missing'?['inspect_repeated_requests']:[]);
  for(const language of ['en','zh'] as const){locale.setLocale(language);const html=renderToStaticMarkup(createElement(ActivityFacts,{activity:result.activity,onEvidence(){}}));assert.doesNotMatch(html,/activity\.|undefined|NaN|未知/);assert.match(html,language==='en'?/inspection signals/:/供检查的线索/);if(scenario==='complete')assert.match(html,language==='en'?/same path does not establish identical content/:/同路径不证明内容/);if(scenario==='missing')assert.match(html,language==='en'?/Source order alone cannot establish execution order/:/来源记录顺序不能单独确认执行先后/);}
 }}finally{locale.setLocale(previous);}
});


test('production failed-turn preview shows scoped failure-share advice and explicit minimum samples in both languages',async()=>{
 const previous=locale.getSnapshot().locale;
 try{
  const client=createExecutionPreviewClient('failed');const result=await client.optimize!({action:'activity',activity:{snapshotId:'preview:fixed',threadId:'preview-task',turnId:'preview-turn'},sourceInstanceId:'preview'});
  assert.ok(result.activity);assert.ok(result.activity.advice.includes('inspect_failure_share'));
  for(const language of ['zh','en'] as const){locale.setLocale(language);const html=renderToStaticMarkup(createElement(ActivityFacts,{activity:result.activity,onEvidence(){}}));assert.match(html,/60%/);assert.match(html,/40%/);assert.match(html,language==='zh'?/5 次结果可判定/:/at least 5 operations/);assert.doesNotMatch(html,/activity\.|undefined|NaN|未知/);}
 }finally{locale.setLocale(previous);}
});

test('input-change inspection and production summary share the synthetic endpoints in both languages',async()=>{
 const {Execution}=await import('../src/tasks/Execution.js');
 const previous=locale.getSnapshot().locale;
 try{for(const scenario of ['failed','missing'] as const){
  const client=createExecutionPreviewClient(scenario);
  const summary=await client.timing!({action:'summary',threadId:'preview-task',turnId:'preview-turn',snapshotId:'preview:fixed'});
  assert.ok(summary.action==='summary'&&summary.profile==='local');
  const response=await client.optimize!({action:'activity',activity:{snapshotId:'preview:fixed',threadId:'preview-task',turnId:'preview-turn'}});
  assert.equal(response.activity!.checks[4].observed.value,summary.context.inputChange.statistics!.maximumIncrease.value);
  for(const language of ['zh','en'] as const){locale.setLocale(language);
   const html=renderToStaticMarkup(createElement(Execution,{summary,refresh(){},onEvidence(){},onShare(){}}));
   assert.match(html,language==='zh'?/请求输入变化/:/Request input change/);
   assert.match(html,scenario==='failed'?/20000/:/100/);
   assert.match(html,language==='zh'?/缺少时间不影响比较/:/Missing times do not prevent comparison/);
   assert.doesNotMatch(html,/inputChange\.|undefined|NaN|未知/);
  }
 }}finally{locale.setLocale(previous);}
});
