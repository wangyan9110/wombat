import {previewActivity} from './activity.js';
import { withTokenAnalysis, calculatedTokenFixture } from './token-analysis.js';
import {t} from '@wombat/client/locale';
import {previewTiming} from './timing.js';
import {accountScenarios,previewAccount} from './account.js';
import {directoryScenarios,previewDirectories} from './directories.js';
import {handoffScenarios,previewHandoff} from './handoff.js';
import {inventoryFixture} from './inventory.js';
import {previewChecks} from './checks.js';
import {previewTasks} from './tasks.js';
import {previewPrices} from './prices.js';
import {readScenarios,previewReadState} from './read-states.js';
import {previewStartup} from './startup.js';
import { CoreError, type UsageClient, type UsageRequest, type UsageResult, type UsageSummary, type QueryOptions } from '@wombat/client';
export const scenarios = ['complete', 'token-calculated', 'token-partial-calculated', 'empty', 'error', 'loading', 'running', 'missing', 'dense', 'mcp-only', 'mcp-mixed', 'initial', 'resolved', 'rule-upgraded', 'evidence-gap','uses-failure','uses-expired','tasks-pages','tasks-delayed','tasks-refresh-failed','partial','config-details','config-detail-failed','prices-update-failed','prices-unavailable','initial-pending','cancelled','interrupted','failed','rules-format','rules-reference','rules-hook','rules-clean',...readScenarios,...accountScenarios,...directoryScenarios,...handoffScenarios] as const;
export type Scenario = typeof scenarios[number];
export function scenarioFromQuery(value:string|null):Scenario {return scenarios.find(scenario=>scenario===value)??'complete';}
const at = '2026-10-04T02:00:00Z';
const page = {offset:0,limit:20,total:0,nextOffset:null};
export const summary: UsageSummary = withTokenAnalysis({measurementCount:1,inputTotal:1000,tokens:{input:800,cacheRead:200,cacheCreate:0,output:100,reasoning:30,total:1100},price:{currency:'USD',policy:'synthetic',priceRevision:'preview',knownCost:'0.001',cost:'0.001',status:'priced',components:[],basis:[],issues:[]}});
export function usageFixture(request:UsageRequest,scenario:Scenario):UsageResult {
 const scope=request.scope??{};
 const tokenScenario=scenario==='token-calculated'||scenario==='token-partial-calculated';
 const tokens=tokenScenario?calculatedTokenFixture(summary,scenario==='token-partial-calculated'):undefined;
 const usage=tokens?.summary??(scenario==='empty'?withTokenAnalysis({...summary,measurementCount:0,inputTotal:0,tokens:{input:0,cacheRead:0,cacheCreate:0,output:0,total:0},price:{...summary.price,cost:'0',knownCost:'0'}}):summary);
 let items:UsageResult['items']=scenario==='empty'?[]:request.action==='threads'?[{kind:'thread',id:'preview-task',upstreamId:'synthetic-task',agentKind:'codex',sourceInstanceId:'preview',title:t('preview.task'),project:'/synthetic/wombat',startedAt:at,lastActivityAt:at,matchedLastActivityAt:at,matchedTurnCount:1,models:['synthetic-model'],reasoningEfforts:['medium'],threadUsage:usage,matchedUsage:usage}]:request.action==='turns'?[{kind:'turn',id:'preview-turn',threadId:'preview-task',ordinal:1,startedAt:at,endedAt:scenario==='running'?null:'2026-10-04T02:01:40Z',status:scenario==='running'?'running':scenario==='cancelled'?'cancelled':scenario==='interrupted'?'unknown':scenario==='failed'?'failed':'completed',models:['synthetic-model'],reasoningEfforts:['medium'],usage,matchedUsage:usage}]:request.action==='steps'?[{kind:'measurement',id:'preview-measurement',threadId:'preview-task',turnId:'preview-turn',timestamp:at,model:'synthetic-model',usage,sequence:1,timePrecision:'second',matchesScope:true}]:[{kind:'usage',isSubtotal:false,usage,scope:{...scope,project:'/synthetic/wombat'},share:1,costShare:1}];
 if(tokens&&request.action==='steps')items=tokens.measurements.map((usage,index)=>({kind:'measurement',id:`preview-measurement-${index+1}`,threadId:'preview-task',turnId:'preview-turn',timestamp:at,model:'synthetic-model',usage,sequence:index+1,timePrecision:'second',matchesScope:true,share:tokens.measurements.length===1?1:null}));
 if(tokens&&request.action==='usage')items=[{kind:'usage',isSubtotal:true,date:'2026-10-04',model:'synthetic-model',scope:{...scope,project:'/synthetic/wombat'},usage,share:scenario==='token-calculated'?1:null,costShare:scenario==='token-calculated'?1:null}];
 const distribution:UsageResult['distribution']=tokens&&request.action==='usage'?{tokenBasis:'analyzed_totals',maxTokens:1100,maxCost:usage.price.cost??null,unpricedTokens:usage.unpricedTokens??null,peakTokenDates:['2026-10-04'],peakCostDates:usage.price.cost?['2026-10-04']:[],peakTokenScopes:[{...scope,since:'2026-10-04',until:'2026-10-05',allTime:null}],peakCostScopes:usage.price.cost?[{...scope,since:'2026-10-04',until:'2026-10-05',allTime:null}]:[]}:undefined;
 return {outputVersion:5,...(distribution?{distribution}:{}),action:request.action??'usage',snapshotRef:{snapshotId:'preview:1',createdAt:at},scope,availableRange:{since:'2026-10-04',until:'2026-10-05'},summary:usage,items,page:{...page,total:items.length},quality:{status:'complete',issues:[],sources:[]},facets:{directories:['/synthetic/wombat'],hasUnassigned:false,models:['synthetic-model'],reasoningEfforts:['medium'],agents:['codex'],discoveredThreadCount:scenario==='empty'?0:1}};
}
export function createPreviewClient(scenario:Scenario):UsageClient {
 const account=previewAccount(scenario);
 const rules=previewChecks(scenario==='empty',scenario==='resolved'?'resolved':scenario==='rule-upgraded'?'incomparable':scenario==='evidence-gap'?'unknown':'unchanged',scenario);
 const taskQuery=previewTasks(scenario);const taskScenario=['tasks-pages','tasks-delayed','tasks-refresh-failed','partial','config-details','config-detail-failed','initial','initial-pending'].includes(scenario);
 const readState=previewReadState(scenario);const specialized=readScenarios.some(value=>value===scenario);
 const ready=async(options?:QueryOptions)=>{if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');if(scenario==='error')throw new CoreError('SOURCE_UNREADABLE','Synthetic source error');if(scenario==='loading')await new Promise<void>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new CoreError('CANCELLED','Cancelled')),{once:true}));};
 return {
  timing:previewTiming(scenario),
  ...(specialized?{live:readState.live}:{}),
  handoff:previewHandoff(scenario),
  directories:previewDirectories(scenario),
  ...(['initial','initial-pending'].includes(scenario)?{live:previewStartup(scenario)}:{}),
  async query(request,options){
   if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
   if(scenario==='error')throw new CoreError('SOURCE_UNREADABLE','Synthetic source error');
   if(scenario==='loading')return new Promise<UsageResult>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new CoreError('CANCELLED','Cancelled')),{once:true}));
   return specialized?readState.query(request,options):taskScenario?taskQuery(request,options):usageFixture(request,scenario);
  },
  prices:previewPrices(scenario),
  async account(request,options){await ready(options);return account(request,options);},
  async config(request,options){await ready(options);if(scenario==='config-detail-failed'&&request.action!=='list')throw new CoreError('SOURCE_UNREADABLE','Synthetic configuration detail unavailable');return scenario==='empty'?{...inventoryFixture(request),items:[],evidence:[],relatedScopes:[],summary:{currentItems:0,historicalItems:0,observedItems:0},page:{offset:request.offset??0,limit:request.limit??30,total:0,nextOffset:null}}:inventoryFixture(request);},
  async optimize(request,options){await ready(options);return request.action==='activity'?previewActivity(scenario)(request):rules(request,options);},
 };
}
