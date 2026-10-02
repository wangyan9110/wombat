import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ConfigItem,ConfigResult,OptimizeSuggestion} from '@wombat/client';
import {locale,reviewPresentation} from '@wombat/client/locale';
import {RelatedUsageContent,textChanges} from '../src/ReviewUsage.js';
import {parseRoute} from '../src/state.js';
const estimate={tokens:5000,method:'synthetic-fixed',encoding:'synthetic',payload:'skillBody',applicability:'referenceEncodingOnly',contentHash:'body-a',tokenizerVersion:'v1'};
const item={id:'item',name:'sample',kind:'skill',current:true,measurementStatus:'complete',contentHash:'file-a',characters:10000,bytes:11000,bodyTokenEstimate:estimate,bodyEstimateStatus:'estimated'} as ConfigItem;
const suggestion={item,findings:[{rule:'bodyTokens',observed:5000,evidenceCodes:[]},{rule:'descriptionStandard',observed:1025,evidenceCodes:[]}],reviewBaseline:item,recheckRuleParameters:{version:'v2'}} as OptimizeSuggestion;
test('list presents one specific suggestion, value and decisive metric in both languages',()=>{
 const saved=locale.getSnapshot().locale;try{for(const language of ['zh','en'] as const){locale.setLocale(language);const view=reviewPresentation(suggestion);assert.match(view.title,/sample/);assert.equal(view.metric,1025);assert.ok(view.value);assert.doesNotMatch(view.value,/1,025|5,000|\$/);}}finally{locale.setLocale(saved);}
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
});
