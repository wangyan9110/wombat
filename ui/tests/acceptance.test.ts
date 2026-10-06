import { withTokenAnalysis } from '../../tests/fixtures/token-analysis.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {UsageClient,UsageResult,UsageSummary} from '@wombat/client';
import {locale} from '@wombat/client/locale';
import {parseRoute} from '../src/state.js';
// These tests inspect rendered structure; styles are built and checked separately.
registerHooks({load(url,context,next){return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}});
const {ConfigView}=await import('../src/ConfigView.js');
const {ExtensionInventory}=await import('../src/Inventory.js');
const {ThreadsView}=await import('../src/ThreadsView.js');
const {readTaskSuggestionCounts}=await import('../src/tasks/useTaskSuggestions.js');
const noop=()=>{};

test('separate configuration pages describe their own scope and extension columns use generic token estimates',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const render=(page:string)=>renderToStaticMarkup(createElement(ConfigView,{client:{} as UsageClient,route:parseRoute(`?page=${page}`),navigate:noop,pin:noop,projects:noop,refresh:noop}));
  const instructions=render('instructions'),extensions=render('extensions');
  assert.match(instructions,/AGENTS\.md/);assert.doesNotMatch(instructions,/Skills|MCP|Hooks/);
  assert.match(extensions,/Skills.*MCP.*Hooks/);assert.doesNotMatch(extensions,/AGENTS\.md/);
  for(const html of [instructions,extensions])assert.match(html,/Current configuration does not establish.*past tasks|当前配置不代表历史任务实际加载的版本/);
  const inventory=renderToStaticMarkup(createElement(ExtensionInventory,{items:[],coverage:{status:'complete',historyStatus:'current',issues:[]},suggestions:new Map(),route:parseRoute('?page=extensions'),onOpen:noop,onSuggestion:noop}));
  assert.match(inventory,/Estimated tokens|预估 Token/);assert.doesNotMatch(inventory,/Estimated instruction tokens|指令预估/);
 }}finally{locale.setLocale(saved);}
});

test('task titles do not fall back to hashes and fixed versions remain available behind closed disclosure',()=>{
 const saved=locale.getSnapshot().locale;
 const summary:UsageSummary=withTokenAnalysis({measurementCount:1,inputTotal:100,tokens:{input:100,cacheRead:0,cacheCreate:0,output:12,total:112},price:{currency:'USD',policy:'synthetic',priceRevision:'test',cost:null,knownCost:null,status:'unknown',components:[],basis:[],issues:[]}});
 const route=parseRoute('?page=threads&timezone=UTC');
 const thread={kind:'thread',id:'internal-task-hash',upstreamId:'upstream-task-hash',sourceInstanceId:'synthetic-source',title:' ',project:'/synthetic',agentKind:'codex',matchedLastActivityAt:'2026-10-04T02:00:00Z',models:[],reasoningEfforts:[],matchedTurnCount:null,matchedUsage:summary,threadUsage:summary};
 const list={items:[thread],summary,snapshotRef:{snapshotId:'live:full-version-hash'},quality:{status:'partial'},page:{offset:0,limit:20,total:1,nextOffset:null}} as unknown as UsageResult;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const html=renderToStaticMarkup(createElement(ThreadsView,{client:{} as UsageClient,empty:null,data:{overview:list,list,route},route,navigate:noop,refresh:noop,basis:noop,usage:noop}));
  assert.match(html,/<strong><span>(?:Untitled task|未命名任务)<\/span>/);assert.match(html,/<h2>(?:Untitled task|未命名任务)<\/h2>/);
  assert.doesNotMatch(html,/<strong>[^]*hash<\/strong>|<h2>[^<]*hash/);
  assert.match(html,/<details class="provenance"><summary>(?:Data version|数据版本)<\/summary><p>[^<]*live:full-version-hash/);
  assert.doesNotMatch(html,/<details[^>]*open/);assert.match(html,/upstream-task-hash/);
  assert.match(html,/Find an Agent task|查找一次 Agent 工作/);assert.match(html,/Current task-list summary|当前任务列表汇总/);
  assert.match(html,/Source does not provide turn associations|来源未提供轮次/);assert.doesNotMatch(html,/>0 (?:turns|个轮次)</);
  assert.match(html,/2026-10-04/);assert.match(html,/112/);assert.match(html,/Not priced|未计价/);
  assert.match(html,/List usage follows the current filters|列表用量按当前筛选统计/);
 }}finally{locale.setLocale(saved);}
});

test('task recommendation counts reuse configuration evidence and count distinct suggestions',async()=>{
 const calls:{thread?:string;readView?:string}[]=[];
 const item=(id:string,kind:'rule'|'skill')=>({id,kind});
 const client={
  config:async(request:any)=>{calls.push({thread:request.scope?.threadId,readView:request.readView});return {readView:'view-1',items:request.scope?.threadId==='task-a'?[item('rule-a','rule'),item('skill-a','skill')]:request.scope?.threadId==='task-b'?[item('skill-a','skill')]:[],page:{offset:0,limit:200,total:0,nextOffset:null}};},
  optimize:async()=>({suggestions:[{id:'suggestion-rule',item:item('rule-a','rule')},{id:'suggestion-skill',item:item('skill-a','skill')},{id:'suggestion-skill',item:item('skill-a','skill')}],page:{offset:0,limit:200,total:3,nextOffset:null}}),
 } as unknown as UsageClient;
 const result=await readTaskSuggestionCounts(client,'snapshot-1',parseRoute('?page=threads&timezone=UTC'),['task-a','task-b','task-c'],new AbortController().signal);
 assert.deepEqual(result.byThread.get('task-a'),{count:2,target:'instructions'});
 assert.deepEqual(result.byThread.get('task-b'),{count:1,target:'extensions'});
 assert.equal(result.byThread.has('task-c'),false);
 assert(calls.slice(1).every(call=>call.readView==='view-1'));
 assert.deepEqual(calls.slice(1).map(call=>call.thread),['task-a','task-b','task-c']);
});
