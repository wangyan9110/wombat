import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ConfigItem,ConfigResult,OptimizeSuggestion} from '@wombat/client';
import {locale,reviewPresentation} from '@wombat/client/locale';
import {RelatedUsageContent,textChanges} from '../src/ReviewUsage.js';
import {parseRoute} from '../src/state.js';
import {FollowUp} from '../src/optimize/FollowUp.js';
import {Findings,FindingMethods} from '../src/optimize/Findings.js';
const estimate={tokens:5000,method:'synthetic-fixed',encoding:'synthetic',payload:'skillBody',applicability:'referenceEncodingOnly',contentHash:'body-a',tokenizerVersion:'v1'};
const at='2026-10-01T00:00:00Z';
const item:ConfigItem={id:'item',name:'sample',kind:'skill',sourceInstanceId:'synthetic',path:'/synthetic/SKILL.md',authorizedProjects:[],sourceContexts:[],configuredState:'discovered',current:true,stale:false,measurementStatus:'complete',estimateStatus:'unknown',observedAt:at,contentHash:'file-a',characters:10000,bytes:11000,bodyTokenEstimate:estimate,bodyEstimateStatus:'estimated',observation:'unknown',counts:{fileReads:0,toolCalls:0,resourceReads:0,succeeded:0,failed:0,outcomeUnknown:0},relatedTasks:0,relatedTurns:0};
const scope:OptimizeSuggestion['checks'][number]['basis']['scope']={sourceInstanceId:null,itemProject:null,global:true,project:null,sourceInstances:['synthetic'],authorizedProjects:[],roots:['/synthetic'],projectRoots:[],sourceRoots:['/synthetic'],complete:true};
const parameters={version:'v1',agentsBytesDefault:16384,descriptionCharactersDefault:500,overrides:{},bodyTokens:5000,descriptionStandardMax:1024,applicability:'synthetic'};
const findings:OptimizeSuggestion['findings']=[{identity:{version:1,findingId:'body-problem',gap:null},rule:'bodyTokens',status:'failed',observed:5000,threshold:5000,evidenceCodes:[]},{identity:{version:1,findingId:'description-problem',gap:null},rule:'descriptionStandard',status:'failed',observed:1025,threshold:1024,evidenceCodes:[]}];
const checks:OptimizeSuggestion['checks']=findings.map(f=>({assessmentId:`synthetic-assessment-${f.rule}`,identityGap:null,ruleSemanticsVersion:1,methodVersions:[{method:f.rule==='bodyTokens'?'synthetic-fixed':'synthetic-metadata-v1',version:1}],rule:f.rule,ruleVersion:'v1',itemId:item.id,contentVersion:item.contentHash,checkedAt:at,outcome:'hit',findings:[f],reason:null,basis:{version:1,dependencyRevision:`synthetic-dependency-${f.rule}`,scope,cutoff:at,applicability:'synthetic',measurement:{kind:'numeric',basis:f.rule==='bodyTokens'?'agentSkillsRecommendation':'agentSkillsSpecification',observed:f.observed,threshold:f.threshold!,inclusive:f.rule==='bodyTokens',standardMax:null,suppressedByStandard:false},gaps:[]},comparison:{status:'not_requested',baselineAssessmentId:null,reason:null}}));
const suggestion:OptimizeSuggestion={reviewFormatVersion:1,id:'synthetic-suggestion',item,category:'repair',status:'stillNeedsReview',findings,checks,checkedAt:at,ruleVersion:'v1',ruleParameters:parameters,reviewBaseline:{version:1,item:structuredClone(item),scope:structuredClone(scope),assessments:structuredClone(checks)},recheckRuleParameters:{...parameters,version:'v2'}};
test('list presents one specific suggestion, value and decisive metric in both languages',()=>{
 const saved=locale.getSnapshot().locale;try{for(const language of ['zh','en'] as const){locale.setLocale(language);const view=reviewPresentation(suggestion);assert.match(view.title,/sample/);assert.equal(view.metric,1025);assert.ok(view.value);assert.doesNotMatch(view.value,/1,025|5,000|\$/);}}finally{locale.setLocale(saved);}
});
test('format findings expose location, reason, current content and valid format while methods stay separate',()=>{
 const saved=locale.getSnapshot().locale;
 const format={...suggestion,item:{...item,path:'/synthetic/SKILL.md',skillMetadata:{status:'invalid',descriptionCharacters:null,issues:['frontMatterInvalid'],diagnostics:[{code:'frontMatterInvalid',field:'description',line:3,column:12,current:'description： <value>',expected:'description: <value>'}]}},findings:[{identity:{version:1,findingId:'format-problem',gap:null},rule:'skillFormat',status:'failed',observed:null,threshold:null,evidenceCodes:['frontMatterInvalid'],basis:'fieldFormat',evidence:null}],ruleVersion:'static-config-v7'} satisfies OptimizeSuggestion;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const evidence=renderToStaticMarkup(createElement(Findings,{suggestion:format}));
  assert.match(evidence,/SKILL\.md/);assert.match(evidence,/3/);assert.match(evidence,/description： &lt;value&gt;/);assert.match(evidence,/description: &lt;value&gt;/);
  assert.match(evidence,/YAML 元数据无法解析|YAML front matter cannot be parsed/);
  assert.doesNotMatch(evidence,/static-config-v7|fieldFormat/);
  const method=renderToStaticMarkup(createElement(FindingMethods,{suggestion:format}));
  assert.match(method,/static-config-v7/);assert.match(method,/fieldFormat/);
 }}finally{locale.setLocale(saved);}
});
test('text comparison consumes core comparison identities and measured basis rather than item fields',()=>{
 const changed={...suggestion,item:{...item,bytes:6000,characters:5000,bodyTokenEstimate:{...estimate,tokens:2000,contentHash:'body-b'}},checks:checks.map(c=>({...c,basis:{...c.basis,measurement:c.basis.measurement.kind==='numeric'?{...c.basis.measurement,observed:2000}:c.basis.measurement},comparison:{status:'comparable' as const,baselineAssessmentId:c.assessmentId}}))};
 assert.deepEqual(textChanges(changed).map(r=>[r.before,r.after]),[[5000,2000],[1025,2000]]);
 assert.deepEqual(textChanges({...changed,checks:changed.checks.map(c=>({...c,comparison:{status:'incomparable'}}))}),[]);
 assert.deepEqual(textChanges({...changed,reviewBaseline:null}),[]);
 assert.deepEqual(textChanges({...changed,checks:changed.checks.map(c=>({...c,comparison:{status:'unknown'}}))}),[]);
 assert.deepEqual(textChanges({...changed,checks:changed.checks.map(c=>({...c,comparison:{status:'comparable',baselineAssessmentId:'foreign'}}))}),[]);
 assert.deepEqual(textChanges(suggestion),[]);
});
test('related usage shows records and core turn usage with every operation record; missing history stays unknown',()=>{
 const result={items:[{...item,usageCount:2,counts:{fileReads:2,toolCalls:0,succeeded:2,failed:0,outcomeUnknown:0},relatedTurns:1,usage:{tokens:{total:110},price:{status:'priced',cost:'0.000265',knownCost:'0.000265'}}}],coverage:{status:'partial',historyStatus:'current'},evidence:[{id:'e1',threadId:'thread',turnId:'turn',title:'synthetic',outcome:'completed'},{id:'e2',threadId:'thread',turnId:'turn',title:'synthetic',outcome:'failed'}],usageRevision:'live:one',page:{total:2,offset:0,limit:20,nextOffset:null}} as unknown as ConfigResult;
 const props={result,route:parseRoute('?page=optimize&suggestion=s'),navigate:()=>{},onPage:()=>{}};
 const html=renderToStaticMarkup(createElement(RelatedUsageContent,props));assert.match(html,/110/);assert.match(html,/\$0.0003/);assert.equal((html.match(/<strong>synthetic<\/strong>/g)??[]).length,2);assert.match(html,/2 条|2 records/);
 const unknown=renderToStaticMarkup(createElement(RelatedUsageContent,{...props,result:{...result,items:[{...result.items[0],usage:null}],coverage:{...result.coverage,historyStatus:'unavailable'},evidence:[]}}));assert.doesNotMatch(unknown,/\$0\.0000/);assert.match(unknown,/不可用|unavailable/);
 const resource=renderToStaticMarkup(createElement(RelatedUsageContent,{...props,result:{...result,items:[{...result.items[0],kind:'mcp',usageCount:1,counts:{fileReads:0,toolCalls:0,resourceReads:1,succeeded:1,failed:0,outcomeUnknown:0}}]}}));assert.match(resource,/1 次使用|1 use/);assert.doesNotMatch(resource,/未找到关联|No associated/);
});
test('follow-up states preserve unknown adoption, natural-work boundaries and English count agreement',()=>{
 const saved=locale.getSnapshot().locale;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const base={recordId:'r',suggestionId:'s',after:'2026-10-01T00:00:00Z',observedAt:'2026-10-02T00:00:00Z',observedRecords:null,lastRecordAt:null,usageRevision:'live:synthetic',absenceObservable:false};
  for(const status of ['no_observed_records','unavailable'] as const){const html=renderToStaticMarkup(createElement(FollowUp,{observation:{...base,status},timezone:'UTC'}));assert.match(html,/待后续任务确认|Awaiting follow-up/);assert.doesNotMatch(html,/\$0|0 条|0 records/);}
  for(const count of [1,2]){const html=renderToStaticMarkup(createElement(FollowUp,{observation:{...base,status:'version_unknown',observedRecords:count},timezone:'UTC'}));assert.match(html,/无法确认是否采用|adoption cannot be confirmed/);assert.match(html,/不代表未使用|does not mean unused/);assert.match(html,/不据此计算节省|no savings/);if(language==='en')assert.ok(html.includes(count===1?'1 associated follow-up record.':'2 associated follow-up records.'));}
 }}finally{locale.setLocale(saved);}
});

test('related records use task names with identities behind closed disclosure and retain usage boundaries',()=>{
 const saved=locale.getSnapshot().locale;
 const result={items:[{...item,counts:{fileReads:1,succeeded:0,failed:0,outcomeUnknown:1},relatedTurns:1,usage:{tokens:{total:112},price:{status:'unknown',cost:null,knownCost:null}}}],coverage:{status:'partial',historyStatus:'partial'},evidence:[{id:'event',threadId:'synthetic-task-hash',turnId:'synthetic-turn-hash',title:null,outcome:'unknown',timestamp:'2026-10-04T02:00:00Z'}],usageRevision:'live:pinned',page:{total:1,offset:0,limit:20,nextOffset:null}} as unknown as ConfigResult;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const html=renderToStaticMarkup(createElement(RelatedUsageContent,{result,route:parseRoute('?timezone=UTC'),navigate:()=>{},onPage:()=>{}}));
  assert.match(html,/<strong>(?:Untitled task|未命名任务)<\/strong>/);
  assert.doesNotMatch(html,/<strong>synthetic-task-hash/);
  assert.match(html,/<details class="provenance"><summary>[^<]+<\/summary><p>[^<]+<code>synthetic-task-hash<\/code>/);
  assert.doesNotMatch(html,/<details[^>]*open/);
  assert.match(html,/synthetic-turn-hash/);assert.match(html,/2026-10-04/);assert.match(html,/112/);
  assert.match(html,/neither exclusive configuration consumption nor savings|不是此配置独占的消耗.*不代表节省/);
  assert.match(html,/History is incomplete|历史记录不完整/);
  assert.match(html,/API cost unknown|API 费用未知/);assert.doesNotMatch(html,/\$0\.0000/);
  assert.match(html,/Model and effort filters do not apply|不应用模型与推理强度筛选/);
  assert.match(html,/version|版本/);
 }}finally{locale.setLocale(saved);}
});
