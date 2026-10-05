import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Basis,amount,currency,timestamp,Token } from '../src/components.js';
import type { UsageSummary } from '@wombat/client';
import {locale} from '@wombat/client/locale';
import {QueryError} from '../src/Feedback.js';
import {stateLabel} from '../src/config/presentation.js';
const summary:UsageSummary={measurementCount:2,inputTotal:100,tokens:{input:80,cacheRead:20,cacheCreate:0,output:10,total:110},price:{currency:'USD',policy:'synthetic',priceRevision:'test',cost:null,knownCost:'0.125',status:'partial',components:[{category:'input',tokens:80,cost:'0.125',knownCost:'0.125',status:'priced',ratePerMillion:null}],basis:[],issues:[]}};
test('rule state explains native loads and unconfirmed history',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const base={kind:'rule',current:true,stale:false,configuredState:'discovered'} as any;assert.equal(stateLabel({...base,observation:'loaded_only'}),language==='zh'?'已加载到 Codex':'Loaded by Codex');assert.equal(stateLabel({...base,observation:'unknown'}),language==='zh'?'已发现，是否加载无法确认':'Discovered; load unconfirmed');}}finally{locale.setLocale(saved);}
});
test('Skill state separates current availability from observed use',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const base={kind:'skill',current:true,stale:false,configuredState:'enabled'} as any;assert.equal(stateLabel({...base,observation:'unknown'}),language==='zh'?'最近一轮可用':'Available in latest turn');assert.equal(stateLabel({...base,observation:'used'}),language==='zh'?'观察到使用':'Use observed');}}finally{locale.setLocale(saved);}
});
test('unknown and known-subtotal costs are distinct, and mixed-rate aggregates do not invent a rate',()=>{
 assert.equal(amount(summary),'$0.1250*');
 assert.doesNotMatch(amount({...summary,price:{...summary.price,status:'unknown'}}),/\$0/);
 const html=renderToStaticMarkup(createElement(Basis,{summary,onPrices:()=>{}}));
 assert.doesNotMatch(html,/×/);assert.match(html,/\$0\.125/);
});
test('compact tokens retain exact accessible values and date-only evidence does not invent times',()=>{
 const html=renderToStaticMarkup(createElement(Token,{value:1234567,interactive:true}));
 assert.match(html,/1\.23M/);assert.match(html,/1,234,567 Token/);
 assert.equal(timestamp('2026-09-29','America/Los_Angeles','date'),'2026-09-29');
});

test('display rounding preserves positive subthreshold amounts independently of ledger precision',()=>{
 assert.equal(currency(0.0000001),'<$0.0001');assert.equal(currency(0.0001),'$0.0001');
 assert.equal(currency(0.00001,2),'<$0.01');assert.equal(currency(0,2),'$0.00');
 assert.equal(amount({...summary,price:{...summary.price,knownCost:'0.0000001'}}),'<$0.0001*');
});

test('review text distinguishes product reminders, specification limits and reference body tokens in both languages',async()=>{
 const {locale,reviewFindingLabel,reviewFindingNote}=await import('@wombat/client/locale');
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);assert.match(reviewFindingNote('descriptionStandard'),/1,024/);assert.match(reviewFindingNote('bodyTokens'),/o200k_base/);assert.notEqual(reviewFindingLabel('descriptionStandard'),reviewFindingLabel('descriptionSize'));assert.notEqual(reviewFindingLabel('bodyTokens'),reviewFindingLabel('fileSize'));}}finally{locale.setLocale(saved);}
});

test('expired review feedback gives a localized reload action while unknown diagnostics remain literal',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
 const html=renderToStaticMarkup(createElement(QueryError,{error:'处理记录版本已变化，请刷新',code:'VIEW_EXPIRED',retry:()=>{}}));
 assert.match(html,language==='en'?/Reload current data/:/重新加载当前数据/);
 if(language==='en')assert.doesNotMatch(html,/处理记录版本/);
 const diagnostic='literal/中文 Tokenss';
 assert.match(renderToStaticMarkup(createElement(QueryError,{error:diagnostic,code:'UNKNOWN_SOURCE',retry:()=>{}})),/literal\/中文 Tokenss/);
 assert.equal(amount({...summary,price:{...summary.price,status:'unknown'}}),language==='en'?'Not priced':'未计价');
 }}finally{locale.setLocale(saved);}
});

test('time trend excludes undated buckets while the headline retains every recorded token',async()=>{
 const {UsageView}=await import('../src/UsageView.js'),{parseRoute}=await import('../src/state.js');
 const base={...summary,measurementCount:2,tokens:{input:3200,output:390,total:3590},inputTotal:3200};
 const bucket=(date:string|null,total:number)=>({kind:'usage',isSubtotal:true,date,scope:date?{since:date,until:'2026-10-02'}:{undated:true},usage:{...base,tokens:{input:total,output:0,total}},unpricedTokens:0});
 const overview={action:'usage',snapshotRef:{snapshotId:'fixed',createdAt:'2026-10-02T00:00:00Z'},quality:{status:'complete'},summary:base,items:[bucket(null,50),bucket('2026-10-01',3540)],page:{offset:0,limit:60,total:2},distribution:{maxTokens:3540}} as any;
 const route=parseRoute('?page=usage&allTime=1&timezone=UTC');
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);const html=renderToStaticMarkup(createElement(UsageView,{client:{} as any,data:{overview,list:{...overview,items:[]},route},route,navigate:()=>{},refresh:()=>{},setReading:()=>{},drill:()=>{},usage:()=>{},basis:()=>{},empty:null}));assert.equal((html.match(/class="bar"/g)??[]).length,1);assert.match(html,/2026-10-01/);assert.match(html,/3,590 Token/);assert.doesNotMatch(html,/aria-label="(?:Unknown date|日期未知),/);assert.match(html,/<details class="provenance"><summary>(?:Trend details|趋势说明)<\/summary><p>/);assert.doesNotMatch(html,/<details class="provenance"[^>]*open/);assert.match(html,language==='en'?/only records with known dates/:/仅包含日期已知/);}}finally{locale.setLocale(saved);}
});


test('pricing basis explains unavailable costs without erasing recorded tokens or known subtotal',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
 const fixture={...summary,price:{...summary.price,issues:['requestContextUnknown','catalogPriceMissing']}};
 const before=JSON.stringify(fixture);
 const html=renderToStaticMarkup(createElement(Basis,{summary:fixture,onPrices(){}}));
 assert.match(html,language==='en'?/pricing tier/:/价格档位/);
 assert.match(html,language==='en'?/catalog has no rate/:/价表缺少/);
 assert.match(html,/110 Token/);assert.match(html,/\$0\.1250\*/);
 assert.equal(JSON.stringify(fixture),before);
 const missing=renderToStaticMarkup(createElement(Token,{value:null}));
 assert.match(missing,language==='en'?/No token count is available/:/此项未提供 Token 数量/);
 assert.doesNotMatch(missing,/0 Token|Unknown|未知/);
 }}finally{locale.setLocale(saved);}
});
