import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UsageResult } from '@wombat/client';
import { locale } from '@wombat/client/locale';
import { EmptyUsage,QueryError } from '../src/Feedback.js';
locale.setLocale('en');
const noop=()=>{};
function empty(status:string,agents:string[],filtered=false,range?:{since:string;until:string}) {
 const result={quality:{status:status==='complete'?'complete':'partial',sources:[{status}]},facets:{agents},availableRange:range} as UsageResult;
 return renderToStaticMarkup(createElement(EmptyUsage,{result,filtered,sources:noop,clear:noop,dates:noop}));
}
test('empty source onboarding differs from unavailable sources and filtered existing history',()=>{
 const first=empty('complete',[]);
 assert.match(first,/No records/);assert.match(first,/Check the source folder/);assert.doesNotMatch(first,/Clear filters/);
 const failed=empty('notFound',[]);
 assert.match(failed,/Source not found/);assert.doesNotMatch(failed,/No records/);
 const filtered=empty('complete',['codex'],true,{since:'2026-09-01',until:'2026-09-02'});
 assert.match(filtered,/Clear filters and search/);assert.match(filtered,/Show available dates/);assert.doesNotMatch(filtered,/No records/);
});
test('expired credentials explain recovery without offering an ineffective retry',()=>{
 const html=renderToStaticMarkup(createElement(QueryError,{error:'HTTP 403',code:'HTTP_403',retry:noop}));
 assert.match(html,/latest full link/);assert.doesNotMatch(html,/<button|HTTP 403/);
 const ordinary=renderToStaticMarkup(createElement(QueryError,{error:'temporary failure',code:'NETWORK',retry:noop}));
 assert.match(ordinary,/Retry/);
 const preview=renderToStaticMarkup(createElement(QueryError,{error:'CANCELLED',code:'CANCELLED',retry:noop,provisional:true}));
 assert.match(preview,/tasks found so far/);assert.doesNotMatch(preview,/committed/);
});
test('failed refresh identifies the retained successful read beside the error in both languages',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const html=renderToStaticMarkup(createElement(QueryError,{error:'failed',retry:noop,previousResultAt:'2026-10-02 10:00:00'}));assert.match(html,/2026-10-02 10:00:00/);assert.match(html,language==='en'?/Showing the last successful result/:/显示上次读取结果/);const fresh=renderToStaticMarkup(createElement(QueryError,{error:'failed',retry:noop,hasResult:false}));assert.doesNotMatch(fresh,/last successful result|上次读取结果/);}}finally{locale.setLocale(saved);}
});
test('source failure causes and globally unmetered tasks do not collapse into filtered emptiness', () => {
 const {quality}= {quality:{status:'complete',sources:[{status:'complete'}]}};
 const baseline={quality,scope:{allTime:true},summary:{measurementCount:0},facets:{discoveredThreadCount:1,agents:[]}} as UsageResult;
 const rendered=(result:UsageResult)=>renderToStaticMarkup(createElement(EmptyUsage,{result,filtered:false,sources:noop,clear:noop,dates:noop}));
 assert.match(rendered(baseline),/Usage records unavailable/);
 const initial={...baseline,freshness:{status:'syncing',revision:'live:initial',initialScan:true},quality:{...baseline.quality,status:'partial'}};
 assert.match(rendered(initial),/Preparing your history/);
 assert.doesNotMatch(rendered(initial),/Sources could not be fully read|Check.*problem|Usage records unavailable/);
 assert.match(rendered({...initial,freshness:{...initial.freshness,status:'failed'}}),/Sources could not be fully read/);
 for(const patch of [{allTime:false},{allTime:true,model:'synthetic'},{allTime:true,sourceInstanceId:'other'},{allTime:true,projectUnknown:true}]) assert.doesNotMatch(rendered({...baseline,scope:patch}),/Usage records unavailable/);
 assert.match(rendered({...baseline,quality:{...baseline.quality,sources:[{status:'failed'}] as UsageResult['quality']['sources']}}),/Cannot read source/);
 assert.match(rendered({...baseline,quality:{...baseline.quality,sources:[{status:'notFound'},{status:'complete'}] as UsageResult['quality']['sources']}}),/Sources could not be fully read/);
});

test('send failures provide installation recovery and unknown delivery remains distinct in both languages',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const render=(code:string,operation:'read'|'send'='send')=>renderToStaticMarkup(createElement(QueryError,{operation,error:'Codex unavailable',code,retry:noop}));
  const failed=render('CODEX_UNAVAILABLE');
  assert.match(failed,language==='en'?/Could not send to Codex\./:/未能发送给 Codex/);
  assert.match(failed,language==='en'?/installed.*executable path/:/已安装 Codex.*可执行文件路径/);
  assert.match(failed,language==='en'?/Review and send again/:/重新确认并发送/);
  assert.doesNotMatch(failed,/The read did not complete|本次读取未完成|Delivery is unknown|是否送达未知/);
  const unknown=render('HANDOFF_UNKNOWN');
  assert.match(unknown,/Delivery is unknown|是否送达未知/);
  assert.match(unknown,/no automatic resend|不自动重发/);
  assert.doesNotMatch(unknown,/Could not send to Codex|未能发送给 Codex|executable path|可执行文件路径/);
  assert.match(render('NETWORK','read'),/The read did not complete|本次读取未完成/);
  assert.match(render('VIEW_EXPIRED'),/Reload current data|重新加载当前数据/);
  assert.doesNotMatch(render('HTTP_403'),/<button/);
 }}finally{locale.setLocale(saved);}
});
