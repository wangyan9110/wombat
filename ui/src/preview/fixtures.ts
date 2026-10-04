import {t} from '@wombat/client/locale';
import {accountFixture} from './account.js';
import {configFixture,createRuleFixture} from './configuration.js';
import { CoreError, type UsageClient, type UsageRequest, type UsageResult, type UsageSummary, type QueryOptions } from '@wombat/client';
export const scenarios = ['complete', 'empty', 'error', 'loading', 'running', 'missing', 'dense'] as const;
export type Scenario = typeof scenarios[number];
const at = '2026-10-04T02:00:00Z';
const page = {offset:0,limit:20,total:0,nextOffset:null};
export const summary: UsageSummary = {measurementCount:1,inputTotal:1000,tokens:{input:800,cacheRead:200,cacheCreate:0,output:100,reasoning:30,total:1100},price:{currency:'USD',policy:'synthetic',priceRevision:'preview',knownCost:'0.001',cost:'0.001',status:'priced',components:[],basis:[],issues:[]}};
export function usageFixture(request:UsageRequest,scenario:Scenario):UsageResult {
 const scope=request.scope??{};
 const usage=scenario==='empty'?{...summary,measurementCount:0,inputTotal:0,tokens:{input:0,cacheRead:0,cacheCreate:0,output:0,total:0},price:{...summary.price,cost:'0',knownCost:'0'}}:summary;
 const items:UsageResult['items']=scenario==='empty'?[]:request.action==='threads'?[{kind:'thread',id:'preview-task',upstreamId:'synthetic-task',agentKind:'codex',sourceInstanceId:'preview',title:t('preview.task'),project:'/synthetic/wombat',startedAt:at,lastActivityAt:at,matchedLastActivityAt:at,matchedTurnCount:1,models:['synthetic-model'],reasoningEfforts:['medium'],threadUsage:usage,matchedUsage:usage}]:request.action==='turns'?[{kind:'turn',id:'preview-turn',threadId:'preview-task',ordinal:1,startedAt:at,endedAt:scenario==='running'?null:'2026-10-04T02:01:40Z',status:scenario==='running'?'running':'completed',models:['synthetic-model'],reasoningEfforts:['medium'],usage,matchedUsage:usage}]:request.action==='steps'?[{kind:'measurement',id:'preview-measurement',threadId:'preview-task',turnId:'preview-turn',timestamp:at,model:'synthetic-model',usage,sequence:1,timePrecision:'second',matchesScope:true}]:[{kind:'usage',isSubtotal:false,usage,scope:{...scope,project:'/synthetic/wombat'},share:1,costShare:1}];
 return {outputVersion:3,action:request.action??'usage',snapshotRef:{snapshotId:'preview:1',createdAt:at},scope,availableRange:{since:'2026-10-04',until:'2026-10-05'},summary:usage,items,page:{...page,total:items.length},quality:{status:'complete',issues:[],sources:[]},facets:{directories:['/synthetic/wombat'],hasUnassigned:false,models:['synthetic-model'],reasoningEfforts:['medium'],agents:['codex'],discoveredThreadCount:scenario==='empty'?0:1}};
}
export function createPreviewClient(scenario:Scenario):UsageClient {
 const rules=createRuleFixture(scenario==='empty');
 const ready=async(options?:QueryOptions)=>{if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');if(scenario==='error')throw new CoreError('SOURCE_UNREADABLE','Synthetic source error');if(scenario==='loading')await new Promise<void>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new CoreError('CANCELLED','Cancelled')),{once:true}));};
 return {
  async query(request,options){
   if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
   if(scenario==='error')throw new CoreError('SOURCE_UNREADABLE','Synthetic source error');
   if(scenario==='loading')return new Promise<UsageResult>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new CoreError('CANCELLED','Cancelled')),{once:true}));
   return usageFixture(request,scenario);
  },
  async prices(request){return {outputVersion:1,action:request.action??'status',origin:'synthetic',updated:false,source:'synthetic',catalogHash:'preview',catalog:{revision:'preview',verifiedAt:at,policy:'synthetic',currency:'USD',models:[]}};},
  async account(request,options){await ready(options);return accountFixture(request,scenario==='empty');},
  async config(request,options){await ready(options);return configFixture(request,scenario==='empty');},
  async optimize(request,options){await ready(options);return rules(request);},
 };
}
