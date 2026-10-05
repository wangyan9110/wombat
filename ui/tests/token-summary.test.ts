import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {locale,t} from '@wombat/client/locale';
import type {UsageSummary,UsageClient} from '@wombat/client';
import {withTokenAnalysis} from '../../tests/fixtures/token-analysis.js';
import {SummaryToken,Pair,Composition,Basis} from '../src/components.js';
import {TaskListSummary,TaskRow} from '../src/tasks/TaskList.js';
import {RelatedUsageContent} from '../src/ReviewUsage.js';
import {inventoryFixture} from '../src/preview/inventory.js';
import {usageFixture} from '../src/preview/fixtures.js';
import {parseRoute} from '../src/state.js';
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url);}});
const {UsageView}=await import('../src/UsageView.js');
const base:UsageSummary=withTokenAnalysis({measurementCount:2,inputTotal:100,tokens:{rawInput:100,input:100,cacheRead:0,cacheCreate:0,output:20,reasoning:0,total:null},price:{status:'priced',cost:'0',knownCost:'0',currency:'USD',policy:'synthetic',priceRevision:'synthetic',components:[],basis:[],issues:[]}});
const partial:UsageSummary={...base,tokenAnalysis:{...base.tokenAnalysis,fields:{...base.tokenAnalysis.fields,total:{observedSubtotal:110,coveredRecords:1,missingRecords:1,conflictingRecords:0,invalidRecords:0,indeterminateRecords:0}}}};
const route=parseRoute('?page=usage&allTime=1&timezone=UTC');

test('usage, task, turn and related summaries share field-level subtotal labels in both languages',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const result=usageFixture({action:'threads',scope:{allTime:true}},'complete');result.summary=partial;
  const row=result.items.find(item=>item.kind==='thread');assert.ok(row&&row.kind==='thread');
  const config=inventoryFixture({action:'evidence'});config.items=[{...config.items[0],usage:partial}];
  const renders=[
   createElement(SummaryToken,{summary:partial}),createElement(Pair,{summary:partial}),createElement(Basis,{summary:partial,onPrices(){}}),
   createElement(TaskListSummary,{result}),createElement(TaskRow,{task:{...row,matchedUsage:partial},selected:false,route,open(){}}),
   createElement(RelatedUsageContent,{result:config,route,navigate(){},onPage(){}}),
  ];
  for(const render of renders){const html=renderToStaticMarkup(render);assert.ok(html.includes(t('usage.tokenAnalysis.subtotal')));assert.match(html,/110/);assert.ok(html.includes(t('usage.tokenAnalysis.covered',{count:1})));}
  const composition=renderToStaticMarkup(createElement(Composition,{summary:partial}));
  assert.match(composition,/100 Token/);assert.doesNotMatch(composition,/已知小计|Known subtotal/); // Input/output remain complete independently.
  for(const value of [0,null]){
   const fixture={...partial,tokenAnalysis:{...partial.tokenAnalysis,fields:{...partial.tokenAnalysis.fields,total:{...partial.tokenAnalysis.fields.total,observedSubtotal:value,coveredRecords:value==null?0:1}}}};
   const html=renderToStaticMarkup(createElement(SummaryToken,{summary:fixture}));
   if(value===0){assert.match(html,/0 Token/);assert.ok(html.includes(t('usage.tokenAnalysis.subtotal')));}else{assert.doesNotMatch(html,/0 Token/);assert.ok(html.includes(t('usage.tokenValueUnavailable')));}
  }
 }}finally{locale.setLocale(previous);}
});

test('partial token trend uses the core recorded peak and one color without rebuilding shares',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const overview=usageFixture({action:'usage',scope:{allTime:true}},'complete');
  overview.summary=partial;overview.items=[{kind:'usage',isSubtotal:true,date:'2026-10-04',scope:{},usage:partial,share:null}];
  overview.distribution={tokenBasis:'recorded_subtotals',maxTokens:110,maxCost:null,unpricedTokens:null,peakTokenDates:['2026-10-04'],peakCostDates:[],peakTokenScopes:[{}],peakCostScopes:[]};
  const html=renderToStaticMarkup(createElement(UsageView,{empty:null,setReading(){},client:{} as UsageClient,refresh(){},data:{overview,list:overview,route},route,navigate(){},drill(){},usage(){},basis(){}}));
  assert.match(html,/class="bar" style="height:100%"/);assert.match(html,/class="bar-recorded"/);
  assert.doesNotMatch(html,/class="bar-input"|class="bar-cache"|class="bar-output"/);
  assert.match(html,/peak-summary/);assert.ok(html.includes(t('usage.tokenAnalysis.subtotal')));
  assert.equal(overview.items[0].kind==='usage'?overview.items[0].share:undefined,null);
 }}finally{locale.setLocale(previous);}
});

test('complete native total is plotted without assuming category sums agree',()=>{
 const previous=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const usage=withTokenAnalysis({...base,measurementCount:1,inputTotal:100,tokens:{rawInput:100,input:100,output:20,cacheRead:0,cacheCreate:0,reasoning:0,total:119}});
  const overview=usageFixture({action:'usage',scope:{allTime:true}},'complete');overview.summary=usage;
  overview.items=[{kind:'usage',isSubtotal:true,date:'2026-10-04',scope:{},usage}];
  overview.distribution={tokenBasis:'recorded_subtotals',maxTokens:119,maxCost:null,unpricedTokens:null,peakTokenDates:['2026-10-04'],peakCostDates:[],peakTokenScopes:[{}],peakCostScopes:[]};
  const html=renderToStaticMarkup(createElement(UsageView,{empty:null,setReading(){},client:{} as UsageClient,refresh(){},data:{overview,list:overview,route},route,navigate(){},drill(){},usage(){},basis(){}}));
  assert.match(html,/class="bar" style="height:100%"/);assert.match(html,/class="bar-recorded" style="height:100%"/);
  assert.doesNotMatch(html,/class="bar-input"|class="bar-cache"|class="bar-output"|class="legend"/);
  assert.match(html,/119 Token/);assert.match(html,/100 Token/);assert.match(html,/20 Token/); // Independent categories remain available.
 }}finally{locale.setLocale(previous);}
});
