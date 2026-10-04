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
const item={id:'item',name:'sample',kind:'skill',current:true,measurementStatus:'complete',contentHash:'file-a',characters:10000,bytes:11000,bodyTokenEstimate:estimate,bodyEstimateStatus:'estimated'} as ConfigItem;
const suggestion={item,findings:[{rule:'bodyTokens',observed:5000,evidenceCodes:[]},{rule:'descriptionStandard',observed:1025,evidenceCodes:[]}],reviewBaseline:item,recheckRuleParameters:{version:'v2'}} as OptimizeSuggestion;
test('list presents one specific suggestion, value and decisive metric in both languages',()=>{
 const saved=locale.getSnapshot().locale;try{for(const language of ['zh','en'] as const){locale.setLocale(language);const view=reviewPresentation(suggestion);assert.match(view.title,/sample/);assert.equal(view.metric,1025);assert.ok(view.value);assert.doesNotMatch(view.value,/1,025|5,000|\$/);}}finally{locale.setLocale(saved);}
});
test('format findings expose location, reason, current content and valid format while methods stay separate',()=>{
 const saved=locale.getSnapshot().locale;
 const format={...suggestion,item:{...item,path:'/synthetic/SKILL.md',skillMetadata:{status:'invalid',descriptionCharacters:null,issues:['frontMatterInvalid'],diagnostics:[{code:'frontMatterInvalid',field:'description',line:3,column:12,current:'description： <value>',expected:'description: <value>'}]}},findings:[{rule:'skillFormat',status:'failed',observed:null,threshold:null,evidenceCodes:['frontMatterInvalid'],basis:'fieldFormat',evidence:null}],ruleVersion:'static-config-v7'} as unknown as OptimizeSuggestion;
 try{for(const language of ['zh','en'] as const){locale.setLocale(language);
  const evidence=renderToStaticMarkup(createElement(Findings,{suggestion:format}));
  assert.match(evidence,/SKILL\.md/);assert.match(evidence,/3/);assert.match(evidence,/description： &lt;value&gt;/);assert.match(evidence,/description: &lt;value&gt;/);
  assert.match(evidence,/YAML 元数据无法解析|YAML front matter cannot be parsed/);
  assert.doesNotMatch(evidence,/static-config-v7|fieldFormat/);
  const method=renderToStaticMarkup(createElement(FindingMethods,{suggestion:format}));
  assert.match(method,/static-config-v7/);assert.match(method,/fieldFormat/);
 }}finally{locale.setLocale(saved);}
});
test('text comparison retains original metadata and rejects mixed or missing token methods',()=>{
 const changed={...suggestion,item:{...item,bytes:6000,characters:5000,bodyTokenEstimate:{...estimate,tokens:2000,contentHash:'body-b'}}};
 assert.deepEqual(textChanges(changed).map(r=>[r.before,r.after]),[[11000,6000],[10000,5000],[5000,2000]]);
 assert.equal(textChanges({...changed,item:{...changed.item,bodyTokenEstimate:{...estimate,method:'different'}}}).length,2);
 assert.deepEqual(textChanges({...changed,reviewBaseline:null}),[]);
 assert.deepEqual(textChanges({...changed,item:{...changed.item,measurementStatus:'unreadable'}}),[]);
 assert.deepEqual(textChanges({...changed,item:{...changed.item,current:false}}),[]);
 assert.deepEqual(textChanges({...changed,status:'recheckUnavailable'}),[]);
});
test('related usage shows records and deduplicated turn usage together; missing history stays unknown',()=>{
 const result={items:[{...item,counts:{fileReads:2,toolCalls:0,succeeded:2,failed:0,outcomeUnknown:0},relatedTurns:1,usage:{tokens:{total:110},price:{status:'priced',cost:'0.000265',knownCost:'0.000265'}}}],coverage:{status:'partial',historyStatus:'current'},evidence:[{id:'e1',threadId:'thread',turnId:'turn',title:'synthetic',outcome:'completed'},{id:'e2',threadId:'thread',turnId:'turn',title:'synthetic',outcome:'failed'}],usageRevision:'live:one',page:{total:2,offset:0,limit:20,nextOffset:null}} as unknown as ConfigResult;
 const props={result,route:parseRoute('?page=optimize&suggestion=s'),navigate:()=>{},onPage:()=>{}};
 const html=renderToStaticMarkup(createElement(RelatedUsageContent,props));assert.match(html,/110/);assert.match(html,/\$0.0003/);assert.equal((html.match(/synthetic/g)??[]).length,1);assert.match(html,/2 条|2 records/);
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
