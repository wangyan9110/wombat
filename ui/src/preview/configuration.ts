import {syntheticUseBasis} from './use-basis.js';
import {ruleExample} from './rule-examples.js';
import {t} from '@wombat/client/locale';
import type {ConfigItem,ConfigRequest,ConfigResult,OptimizeRequest,OptimizeResult,OptimizeSuggestion} from '@wombat/client';
const at='2026-10-04T02:00:00Z';
const project='/synthetic/wombat';
export const inventory:ConfigItem[]=(['rule','skill','mcp','hook'] as const).map((kind,index)=>({id:`preview-${kind}`,name:['AGENTS.md','query-review','project-docs','format-check'][index],kind,sourceInstanceId:'preview',path:`${project}/${['AGENTS.md','skills/query-review/SKILL.md','config.toml','hooks.json'][index]}`,project,authorizedProjects:[project],sourceContexts:[],configuredState:'enabled',contentHash:`synthetic-${kind}`,observedAt:at,current:true,stale:false,bytes:kind==='skill'?24000:800,contentTokens:kind==='skill'?6200:200,estimateStatus:'estimated',measurementStatus:'complete',bodyEstimateStatus:'estimated',bodyTokenEstimate:kind==='skill'?{tokens:6200,method:'synthetic-fixed-body-v1',encoding:'synthetic',payload:'skillBody',applicability:'referenceEncodingOnly',contentHash:'synthetic-body',tokenizerVersion:'v1'}:null,usageCount:kind==='skill'?3:kind==='mcp'?1:null,useBasis:kind==='hook'?null:syntheticUseBasis(kind==='rule'?'rule_load_or_read':'object_use',kind==='mcp'?'partial':'observed'),observation:'used',counts:{fileReads:kind==='skill'?3:kind==='rule'?1:0,toolCalls:kind==='mcp'?1:0,resourceReads:0,succeeded:kind==='skill'?2:1,failed:kind==='skill'?1:0,outcomeUnknown:0},relatedTasks:1,relatedTurns:1,lastRecordAt:at}));
function paginate<T>(items:T[],q:{offset?:number|null;limit?:number|null}){const offset=q.offset??0,limit=q.limit??20;return {items:items.slice(offset,offset+limit),page:{offset,limit,total:items.length,nextOffset:offset+limit<items.length?offset+limit:null}};}
export function configFixture(request:ConfigRequest,empty=false):ConfigResult {
 const rows=empty?[]:inventory.filter(i=>(!request.itemId||request.itemId===i.id)&&(!request.kind||request.kind===i.kind)&&(!request.kinds||request.kinds.includes(i.kind))&&(!request.search||i.name.toLowerCase().includes(request.search.toLowerCase()))&&(!request.observation||request.observation===i.observation));
 const result=paginate(rows,request);
 const evidence=request.action==='evidence'&&!empty?rows.flatMap(i=>Array.from({length:i.usageCount??0},(_,index)=>({id:`${i.id}-operation-${index}`,sourceInstanceId:'preview',itemId:i.id,threadId:'preview-task',turnId:'preview-turn',title:t('preview.task'),project,timestamp:at,eventType:i.kind==='mcp'?'mcpToolCall':'fileRead',outcome:index===1?'failed':'completed',association:'exact'}))):[];
 const evidencePage=paginate(evidence,request);
 return {outputVersion:1,action:request.action??'list',capabilities:{kinds:['rule','skill','mcp','hook'],evidenceTypes:['fileRead','mcpToolCall'],tokenEstimates:true,historicalContent:false,historicalContentHashes:true,writes:false,projectRegistry:false},readView:'preview-config',usageRevision:'preview:1',configRevision:'preview',checkedAt:at,scope:request.scope??{},authorizedProjects:[project],summary:{currentItems:rows.length,historicalItems:0,observedItems:rows.length},items:result.items.map(item=>({...item,useBasis:item.kind==='hook'?null:syntheticUseBasis(item.kind==='rule'?'rule_load_or_read':'object_use',item.kind==='mcp'?'partial':'observed',request.scope)})),evidence:evidencePage.items,relatedScopes:[],page:request.action==='evidence'?evidencePage.page:result.page,coverage:{status:'complete',historyStatus:'current',issues:[],supportedEvidence:['fileRead','mcpToolCall'],absenceObservable:false},hookRegistry:{status:'unavailable',contexts:[]}};
}
export type ReviewScenario='unchanged'|'resolved'|'incomparable'|'unknown';
export function createRuleFixture(empty=false, scenario:ReviewScenario='unchanged',example='complete',exampleItem?:ConfigItem){
 let revision=1;
 const scope:OptimizeResult['checks'][number]['basis']['scope']={sourceInstanceId:null,itemProject:project,global:false,project,sourceInstances:['preview'],authorizedProjects:[project],roots:[project],projectRoots:[project],sourceRoots:[project],complete:true};
 const findings:OptimizeSuggestion['findings']=[{identity:{version:1,findingId:'synthetic-body-problem',gap:null},rule:'bodyTokens',status:'failed',observed:6200,threshold:5000,evidenceCodes:['bodyTokenEstimate'],basis:'agentSkillsRecommendation'}];
 const outcomes:[string,OptimizeResult['checks'][number]['outcome']][]=[['bodyTokens','hit'],['localReference','miss'],['skillInactivity','insufficient'],['runtimeDuplicateInjection','unsupported'],['declaredCopyDrift','error']];
 const checks:OptimizeResult['checks']=outcomes.map(([rule,outcome])=>{
  const complete=outcome==='hit'||outcome==='miss';
  const reason=rule==='skillInactivity'?'continuousCoverageUnavailable':rule==='runtimeDuplicateInjection'?'runtimeInjectionUnavailable':rule==='declaredCopyDrift'?'invalidAnalysisEvidence':null;
  const measurement:OptimizeResult['checks'][number]['basis']['measurement']=rule==='bodyTokens'?{kind:'numeric',basis:'agentSkillsRecommendation',observed:6200,threshold:5000,inclusive:true,standardMax:null,suppressedByStandard:false}:rule==='localReference'||rule==='declaredCopyDrift'?{kind:'static',complete:outcome==='miss',findings:0}:{kind:'unsupported',reason:reason!};
  const method=rule==='bodyTokens'?'synthetic-fixed-body-v1':rule==='localReference'?'synthetic-markdown-v1':rule==='declaredCopyDrift'?'raw-utf8/identity-v1':'unavailable-v1';
  return {rule,outcome,ruleVersion:'preview',ruleSemanticsVersion:1,methodVersions:[{method,version:1}],itemId:'preview-skill',contentVersion:'synthetic-skill',checkedAt:at,findings:rule==='bodyTokens'?findings:[],reason,
   assessmentId:complete?`synthetic-assessment-${rule}`:null,identityGap:complete?null:reason,
   basis:{version:1,dependencyRevision:complete?`synthetic-dependency-${rule}`:null,scope,cutoff:at,applicability:'synthetic',measurement,gaps:complete?[]:[reason!]},
   comparison:{status:'not_requested',baselineAssessmentId:null,reason:null}};
 });
 let suggestion:OptimizeSuggestion={reviewFormatVersion:1,id:'preview-suggestion',scopeProject:project,item:inventory[1],category:'trim',status:'pending',checks,findings,checkedAt:at,ruleVersion:'preview',reviewBaseline:{version:1,item:structuredClone(inventory[1]),scope:structuredClone(scope),assessments:structuredClone(checks)}};
 const replacement=ruleExample({suggestions:[suggestion]} as OptimizeResult,example,exampleItem??inventory[1]);if(replacement)suggestion=replacement;
 return (request:OptimizeRequest):OptimizeResult=>{
  if(request.action==='keep'||request.action==='not_applicable'){suggestion.decision={kind:request.action,reason:request.decisionReason??'necessary',recordedAt:at,binding:{version:1,identityBasis:'stable_problems',suggestionId:suggestion.id,findingIds:suggestion.findings.flatMap(f=>f.identity.findingId?[f.identity.findingId]:[]),assessmentIds:suggestion.checks.flatMap(c=>c.assessmentId?[c.assessmentId]:[]),contentVersion:suggestion.item.contentHash,scope:structuredClone(scope),applicabilityId:'synthetic-content-method-scope-binding',gap:null}};revision++;}
  if(request.action==='redisplay'){suggestion.decision=null;revision++;}
  if(request.action==='recheck'){
   revision++;
   suggestion.recordId=`synthetic-recheck-record-${revision}`;
   suggestion.checkedAt='2026-10-04T02:02:00Z';
   suggestion.checks=suggestion.checks.map(check=>{
    const original=suggestion.reviewBaseline!.assessments.find(a=>a.rule===check.rule)!;
    const known=check.rule===(replacement?.checks[0].rule??'bodyTokens');
    const comparison=known?(scenario==='incomparable'?'incomparable':scenario==='unknown'?'unknown':'comparable'):'unknown';
    const reason=comparison==='incomparable'?'ruleParametersOrMethodChanged':comparison==='unknown'?'checkEvidenceIncomplete':null;
    return {...check,checkedAt:suggestion.checkedAt,assessmentId:scenario==='unknown'?null:`synthetic-recheck-${revision}-${check.rule}`,identityGap:scenario==='unknown'?'assessmentIdentityUnavailable':check.identityGap,
     ruleSemanticsVersion:scenario==='incomparable'?2:check.ruleSemanticsVersion,
     methodVersions:scenario==='incomparable'?[{method:check.methodVersions[0].method,version:2}]:check.methodVersions,
     outcome:known&&scenario==='resolved'?'miss':known&&scenario==='unknown'?'insufficient':check.outcome,
     reason:scenario==='unknown'?'assessmentIdentityUnavailable':check.reason,
     findings:known&&scenario==='resolved'?[]:check.findings,
     basis:{...check.basis,cutoff:suggestion.checkedAt,dependencyRevision:scenario==='unknown'?null:`synthetic-recheck-dependency-${revision}-${check.rule}`,gaps:scenario==='unknown'?['assessmentIdentityUnavailable']:check.basis.gaps,
      measurement:known&&check.basis.measurement.kind==='numeric'?{...check.basis.measurement,observed:scenario==='resolved'?2000:6200}:check.basis.measurement},
     comparison:{status:comparison,baselineAssessmentId:original.assessmentId,reason}};
   });
   suggestion.status=scenario==='resolved'?'verified':scenario==='unknown'||scenario==='incomparable'?'recheckUnavailable':'stillNeedsReview';
  }
  const all=empty||example==='rules-clean'?[]:[structuredClone(suggestion)];
  const matchesScope=(s:OptimizeSuggestion)=>(!request.project||s.item.authorizedProjects.includes(request.project))&&(!request.sourceInstanceId||s.item.sourceInstanceId===request.sourceInstanceId||s.item.sourceContexts.some(context=>context.sourceInstanceId===request.sourceInstanceId));
  const filtered=all.filter(s=>matchesScope(s)&&(!request.suggestionId||request.suggestionId===s.id)&&(!request.itemId||request.itemId===s.item.id)&&(!request.category||request.category===s.category)&&(!request.group||(request.group==='history'?(!!s.decision||s.status!=='pending'):(!s.decision&&s.status!=='verified'))));
  const result=paginate(filtered,request);
  const observationAt=suggestion.status==='verified'?'2026-10-04T03:00:00Z':at;
  return {outputVersion:4,action:request.action??'list',capabilities:{staticChecks:true,manualEditReview:true,decisions:true,inactivity:false,mcpFaults:false,spaceCleanup:false,loadingBudgetDiagnosis:false,exactInstructionBlocks:false,declaredCopyDrift:false,hookSupport:{effectiveRegistry:false,status:'no_verified_adapter'}},readView:'preview-config',configRevision:'preview',usageRevision:'preview:1',decisionRevision:`preview-${revision}`,checkedAt:observationAt,suggestions:result.items,pending:all.filter(s=>!s.decision&&s.status!=='verified').length,history:all.filter(s=>s.decision||s.status!=='pending').length,page:result.page,issues:[],resultStatus:scenario==='unknown'?'partial':'complete',ruleParameters:{version:'preview',agentsBytesDefault:16384,descriptionCharactersDefault:500,overrides:{},bodyTokens:5000,descriptionStandardMax:1024,applicability:'synthetic'},ruleCatalog:[],checks:empty||!matchesScope(suggestion)?[]:suggestion.checks.filter(c=>!request.itemId||c.itemId===request.itemId),followUps:suggestion.status==='verified'&&suggestion.recordId?[{recordId:suggestion.recordId,suggestionId:suggestion.id,status:'version_unknown',after:suggestion.checkedAt,observedAt:'2026-10-04T03:00:00Z',observedRecords:1,lastRecordAt:'2026-10-04T02:30:00Z',usageRevision:'preview:1',absenceObservable:false,useBasis:{...syntheticUseBasis('object_use'),capturedAt:'2026-10-04T03:00:00Z',scope:{...syntheticUseBasis('object_use').scope,project:suggestion.scopeProject,window:{kind:'follow_up',after:suggestion.checkedAt,through:'2026-10-04T03:00:00Z'}}}}]:[]};
 };
}
