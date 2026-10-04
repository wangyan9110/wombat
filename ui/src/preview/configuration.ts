import {t} from '@wombat/client/locale';
import type {ConfigItem,ConfigRequest,ConfigResult,OptimizeRequest,OptimizeResult,OptimizeSuggestion} from '@wombat/client';
const at='2026-10-04T02:00:00Z';
const project='/synthetic/wombat';
export const inventory:ConfigItem[]=(['rule','skill','mcp','hook'] as const).map((kind,index)=>({id:`preview-${kind}`,name:['AGENTS.md','query-review','project-docs','format-check'][index],kind,sourceInstanceId:'preview',path:`${project}/${['AGENTS.md','skills/query-review/SKILL.md','config.toml','hooks.json'][index]}`,project,authorizedProjects:[project],sourceContexts:[],configuredState:'enabled',contentHash:`synthetic-${kind}`,observedAt:at,current:true,stale:false,bytes:kind==='skill'?24000:800,contentTokens:kind==='skill'?6200:200,estimateStatus:'estimated',measurementStatus:'measured',bodyEstimateStatus:'estimated',usageCount:kind==='skill'?3:1,observation:'used',counts:{fileReads:kind==='skill'?3:0,toolCalls:kind==='mcp'?1:0,resourceReads:0,succeeded:kind==='skill'?2:1,failed:kind==='skill'?1:0,outcomeUnknown:0},relatedTasks:1,relatedTurns:1,lastRecordAt:at}));
function paginate<T>(items:T[],q:{offset?:number|null;limit?:number|null}){const offset=q.offset??0,limit=q.limit??20;return {items:items.slice(offset,offset+limit),page:{offset,limit,total:items.length,nextOffset:offset+limit<items.length?offset+limit:null}};}
export function configFixture(request:ConfigRequest,empty=false):ConfigResult {
 const rows=empty?[]:inventory.filter(i=>(!request.itemId||request.itemId===i.id)&&(!request.kind||request.kind===i.kind)&&(!request.kinds||request.kinds.includes(i.kind))&&(!request.search||i.name.toLowerCase().includes(request.search.toLowerCase()))&&(!request.observation||request.observation===i.observation));
 const result=paginate(rows,request);
 const evidence=request.action==='evidence'&&!empty?rows.flatMap(i=>Array.from({length:i.usageCount??0},(_,index)=>({id:`${i.id}-operation-${index}`,sourceInstanceId:'preview',itemId:i.id,threadId:'preview-task',turnId:'preview-turn',title:t('preview.task'),project,timestamp:at,eventType:i.kind==='mcp'?'mcpToolCall':'fileRead',outcome:index===1?'failed':'completed',association:'exact'}))):[];
 const evidencePage=paginate(evidence,request);
 return {outputVersion:1,action:request.action??'list',capabilities:{kinds:['rule','skill','mcp','hook'],evidenceTypes:['fileRead','mcpToolCall'],tokenEstimates:true,historicalContent:false,writes:false,projectRegistry:false},readView:'preview-config',usageRevision:'preview:1',configRevision:'preview',checkedAt:at,scope:request.scope??{},authorizedProjects:[project],summary:{currentItems:rows.length,historicalItems:0,observedItems:rows.length},items:result.items,evidence:evidencePage.items,relatedScopes:[],page:request.action==='evidence'?evidencePage.page:result.page,coverage:{status:'complete',historyStatus:'current',issues:[],supportedEvidence:['fileRead','mcpToolCall'],absenceObservable:false},hookRegistry:{status:'unavailable',contexts:[]}};
}
export function createRuleFixture(empty=false){
 let revision=1;
 const findings=[{rule:'bodyTokens',status:'hit',observed:6200,threshold:5000,evidenceCodes:['bodyTokenEstimate']}];
 const checks:OptimizeResult['checks']=[['bodyTokens','hit'],['localReference','miss'],['skillInactivity','insufficient'],['runtimeDuplicateInjection','unsupported'],['declaredCopyDrift','error']].map(([rule,outcome])=>({rule,outcome:outcome as OptimizeResult['checks'][number]['outcome'],ruleVersion:'preview',itemId:'preview-skill',contentVersion:'synthetic-skill',checkedAt:at,findings:rule==='bodyTokens'?findings:[],reason:rule==='skillInactivity'?'continuousCoverageUnavailable':null}));
 const suggestion:OptimizeSuggestion={id:'preview-suggestion',item:inventory[1],category:'trim',status:'pending',checks,findings,checkedAt:at,ruleVersion:'preview'};
 return (request:OptimizeRequest):OptimizeResult=>{
  if(request.action==='keep'||request.action==='not_applicable'){suggestion.decision={kind:request.action,reason:request.decisionReason??'necessary',recordedAt:at};revision++;}
  if(request.action==='redisplay'){suggestion.decision=null;revision++;}
  if(request.action==='recheck'){suggestion.status='stillNeedsReview';revision++;}
  const all=empty?[]:[structuredClone(suggestion)];
  const filtered=all.filter(s=>(!request.suggestionId||request.suggestionId===s.id)&&(!request.itemId||request.itemId===s.item.id)&&(!request.category||request.category===s.category)&&(!request.group||(request.group==='history')===!!s.decision));
  const result=paginate(filtered,request);
  return {outputVersion:1,action:request.action??'list',capabilities:{staticChecks:true,manualEditReview:true,decisions:true,inactivity:false,mcpFaults:false,spaceCleanup:false,loadingBudgetDiagnosis:false,exactInstructionBlocks:false,declaredCopyDrift:false,hookSupport:{effectiveRegistry:false,status:'no_verified_adapter'}},readView:'preview-config',configRevision:'preview',usageRevision:'preview:1',decisionRevision:`preview-${revision}`,checkedAt:at,suggestions:result.items,pending:all.filter(s=>!s.decision).length,history:all.filter(s=>s.decision).length,page:result.page,issues:[],resultStatus:'complete',ruleParameters:{version:'preview',agentsBytesDefault:16384,descriptionCharactersDefault:500,overrides:{},bodyTokens:5000,descriptionStandardMax:1024,applicability:'synthetic'},ruleCatalog:[],checks:empty?[]:checks.filter(c=>!request.itemId||c.itemId===request.itemId),followUps:[]};
 };
}
