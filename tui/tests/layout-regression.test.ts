import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import type { Renderable } from '@opentui/core';
import { CoreError, type PricingResult, type UsageClient, type UsageItem, type UsageResult, type UsageSummary } from '@wombat/client';
import { locale } from '@wombat/client/locale';
import { TerminalUI } from '../src/components/terminal-ui.js';
import { terminalThemes } from '../src/themes/index.js';
import { runTerminalAppWithUI, screenFrame } from '../src/app.js';
import { priceFrame } from '../src/screens/prices.js';
import { editTerminalFilters } from '../src/state/filters.js';

const stamp='2026-09-30T10:00:00Z', scope={timezone:'UTC',since:'2026-09-01',until:'2026-10-01'};
const summary:UsageSummary={measurementCount:1,tokens:{input:100,cacheRead:800,cacheCreate:0,output:100,total:1000},price:{status:'priced',cost:'0.4',knownCost:'0.4',currency:'USD',policy:'synthetic',priceRevision:'fixture',components:[],basis:[],issues:[]}};
const thread:Extract<UsageItem,{kind:'thread'}>={kind:'thread',id:'thread',agentKind:'codex',sourceInstanceId:'fixture',title:'Synthetic conversation',project:'/synthetic/project',startedAt:stamp,lastActivityAt:stamp,models:['model-example'],reasoningEfforts:['high'],threadUsage:summary,matchedUsage:summary};
const turn:Extract<UsageItem,{kind:'turn'}>={kind:'turn',id:'turn',threadId:'thread',ordinal:1,startedAt:stamp,endedAt:stamp,status:'completed',models:['model-example'],reasoningEfforts:['high'],usage:summary,matchedUsage:summary,share:1,costShare:1};
const measurement:Extract<UsageItem,{kind:'measurement'}>={kind:'measurement',id:'measurement',threadId:'thread',turnId:'turn',timestamp:stamp,model:'model-example',reasoningEffort:'high',sequence:0,timePrecision:'second',usage:summary,share:1,costShare:1};
const operation:Extract<UsageItem,{kind:'operation'}>={kind:'operation',id:'operation',threadId:'thread',turnId:'turn',timestamp:stamp,name:'read_file',status:'completed',sequence:1,timePrecision:'second',operationType:'tool'};
const usage:Extract<UsageItem,{kind:'usage'}>={kind:'usage',date:'2026-09-30',isSubtotal:true,scope:{...scope,since:'2026-09-30'},usage:summary};
const result=(action:UsageResult['action'],items:UsageItem[]):UsageResult=>({action,outputVersion:3,snapshotRef:{snapshotId:'fixture',createdAt:stamp},scope,summary,items,page:{offset:0,limit:6,total:items.length},quality:{status:'complete',sources:[],issues:[]}});
const prices:PricingResult={outputVersion:1,action:'status',origin:'builtin',updated:false,source:'https://example.test/prices',catalogHash:'fixture',catalog:{revision:'fixture',verifiedAt:'2026-09-30',policy:'synthetic',currency:'USD',models:[{id:'model-example',aliases:[],source:'https://example.test/model',rates:{input:'0.125',cacheRead:'0.025',cacheCreate:null,output:'1.5'},longContext:{inputAbove:200000,rates:{input:'0.25',cacheRead:'0.05',cacheCreate:null,output:'3'}}}]}};
const captures:unknown[]=[];
function geometry(node:Renderable):unknown[]{return [{id:node.id,x:node.x,y:node.y,width:node.width,height:node.height},...node.getChildren().flatMap(geometry)];}
for(const language of ['zh','en'] as const)for(const [width,height]of [[40,14],[80,24],[120,32]])for(const theme of Object.values(terminalThemes))test(`page structure ${language}/${theme.id}/${width}x${height}`,{timeout:15000},async()=>{
 locale.setLocale(language);
 const setup=await createTestRenderer({width,height}),ui=new TerminalUI(setup.renderer,theme,true);
 const capture=async(state:string)=>{
  await setup.flush();await setup.waitForVisualIdle();
  const root=setup.renderer.root,footer=root.findDescendantById('footer')!,heading=root.findDescendantById('heading')!;
  assert(footer&&heading,state);assert(footer.y+footer.height<=height,state+' footer stays within the terminal');
  assert(footer.height<=3,state+' footer contains shortcuts only');
  const title=root.findDescendantById('title')!;assert(title.y>=heading.y&&title.y+title.height<=heading.y+heading.height);
  captures.push({name:`${state}-${language}-${theme.id}-${width}x${height}`,width,height,plain:setup.captureCharFrame(),spans:setup.captureSpans(),geometry:geometry(root)});
 };
 const show=async(action:'usage'|'threads'|'turns',items:UsageItem[],expanded=false)=>{
  void ui.choose(screenFrame({request:{action,presentation:'details',scope},result:result(action,items),selected:0,expanded:expanded?new Map([['turn',result('steps',[measurement,operation])]]):new Map(),details:expanded?new Set(['step:turn:measurement']):new Set(),...(action==='turns'?{thread}:{})},action==='usage'?0:1));
  await capture(action+(expanded?'-expanded':''));
 };
 try{
  const emptyFrame=screenFrame({request:{action:'usage',presentation:'distribution',scope},result:result('usage',[]),selected:0,expanded:new Map(),details:new Set()},0);
  const emptyLayout=emptyFrame.layout!(width);
  assert.equal(emptyLayout.distributionHeader,undefined,'empty distribution has no misleading scale');
  assert.equal(emptyLayout.total,undefined,'empty distribution has no misleading total');
  assert.match(emptyLayout.footer!,/R /);assert.doesNotMatch(emptyLayout.footer!,/Enter|B /);
  void ui.choose(emptyFrame);await capture('empty-distribution');
  await show('threads',[]);await capture('empty-threads');
  await show('usage',[usage,{...usage,isSubtotal:false,model:'model-example',reasoningEffort:'high'}]);
  await show('threads',[thread]);
  await show('turns',[turn]);
  assert(setup.renderer.root.findDescendantById('meter-0'),'turn consumption stays available at compact height');
  assert(setup.renderer.root.findDescendantById('context-0'),'compact turn context stays in the body');
  await show('turns',[turn],true);
  const footer=setup.renderer.root.findDescendantById('footer')!;
  assert(!footer.findDescendantById('disclosure-action'));
  for(const tier of ['standard','long'] as const){
   void ui.choose(priceFrame(prices,{tier,cursor:0}));await capture('prices-'+tier);
   void ui.choose(priceFrame(prices,{tier,cursor:0,expanded:'model-example',notes:true}));await capture('prices-'+tier+'-expanded');
   assert.equal(setup.renderer.root.findDescendantById('notes')!.parent?.id,'data-disclosure');
  }
  const filters=editTerminalFilters({action:'usage',scope:{timezone:'UTC'}},stamp,{form:ui.form.bind(ui)},{models:['model-example'],projects:['/synthetic/project']});
  await capture('filters');
  setup.mockInput.pressEscape();await filters;
  let finish!:()=>void;
  const loading=ui.task({kind:'open',activeTab:'threads'},()=>new Promise<void>(resolve=>{finish=resolve;}));
  await capture('loading');
  const root=setup.renderer.root,cancel=root.findDescendantById('loading-cancel')!,scene=root.findDescendantById('startup-scene')!,loadingFooter=root.findDescendantById('footer')!;
  assert.equal(cancel.parent?.id,scene.id,'cancel belongs beneath the loading phase');assert(cancel.y+cancel.height<=loadingFooter.y,'loading content fits above footer');
  finish();await loading;
  let fail=true;
  const client:UsageClient={async prices(){return prices;},async query(request){if(fail)throw new CoreError('SOURCE_UNREADABLE','Synthetic source cannot be read');return result(request.action,[usage]);}};
  const running=runTerminalAppWithUI({action:'usage',snapshotId:'fixture',scope},client,ui);
  await setup.waitForFrame(frame=>frame.includes('Synthetic source'));
  await capture('failed-read');
  assert.doesNotMatch(setup.captureCharFrame(),/model-example/,'failed read exposes no stale records');
  fail=false;setup.mockInput.pressKey('RETURN');
  await setup.waitForFrame(frame=>frame.includes(language==='zh'?'9月30日':'9/30'));
  await capture('retried-read');
  setup.mockInput.pressKey('q');await running;
 }finally{ui.destroy();locale.setLocale('zh');}
});
test.after(async()=>{if(process.env.WOMBAT_FIDELITY_OUTPUT){await mkdir(process.env.WOMBAT_FIDELITY_OUTPUT,{recursive:true});await writeFile(join(process.env.WOMBAT_FIDELITY_OUTPUT,'layout-screens.json'),JSON.stringify(captures,null,2)+'\n');}});
