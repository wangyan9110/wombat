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
