import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsageClient} from '@wombat/client';
import {scenarioFromQuery,createPreviewClient,summary} from '../src/preview/fixtures.js';
import {calculatedTokenFixture} from '../src/preview/token-analysis.js';

test('preview query selects only registered scenarios',()=>{
 assert.equal(scenarioFromQuery('token-calculated'),'token-calculated');
 assert.equal(scenarioFromQuery('token-partial-calculated'),'token-partial-calculated');
 for(const value of [null,'','invalid','TOKEN-CALCULATED'])assert.equal(scenarioFromQuery(value),'complete');
});

test('synthetic calculated totals preserve native gaps, independent categories and base facts',()=>{
 const original=structuredClone(summary);
 const full=calculatedTokenFixture(summary,false);
 assert.equal(full.summary.tokens.total,null);
 assert.equal(full.summary.tokenAnalysis.fields.total.observedSubtotal,null);
 assert.equal(full.summary.tokenAnalysis.fields.total.missingRecords,1);
 assert.equal(full.summary.tokenAnalysis.totalAnalysis?.subtotal,1100);
 assert.equal(full.summary.tokenAnalysis.totalAnalysis?.calculatedRecords,1);
 assert.equal(full.summary.tokens.rawInput,1000);
 assert.equal(full.summary.tokens.cacheRead,200);
 assert.equal(full.summary.tokens.reasoning,30);
 const partial=calculatedTokenFixture(summary,true);
 assert.equal(partial.summary.tokens.rawInput,null);
 assert.equal(partial.summary.tokenAnalysis.fields.rawInput.observedSubtotal,1000);
 assert.equal(partial.summary.tokenAnalysis.fields.total.missingRecords,2);
 assert.equal(partial.summary.tokenAnalysis.totalAnalysis?.unavailableRecords,1);
 assert.equal(partial.summary.price.cost,null);
 assert.equal(partial.summary.price.knownCost,full.summary.price.knownCost);
 assert.equal(partial.measurements[1].price.status,'unknown');
 assert.ok(Object.values(partial.measurements[1].tokens).every(value=>value===null));
 for(const field of Object.values(partial.summary.tokenAnalysis.fields)){
  assert.equal(field.coveredRecords+field.missingRecords+field.invalidRecords+field.conflictingRecords+field.indeterminateRecords,2);
 }
 assert.deepEqual(summary,original);
 assert.equal(summary.tokenAnalysis.totalAnalysis,undefined);
});

for(const scenario of ['token-calculated','token-partial-calculated'] as const){
 test(`${scenario} validates the same supplied totals at overview, task, turn and measurement levels`,async()=>{
  const raw=createPreviewClient(scenario),client=createUsageClient({query:raw.query});
  const responses=await Promise.all(['usage','threads','turns','steps'].map(action=>client.query({action:action as 'usage'|'threads'|'turns'|'steps',threadId:'preview-task',turnId:'preview-turn',scope:{allTime:true}})));
  for(const response of responses){
   assert.equal(response.outputVersion,5);
   assert.equal(response.snapshotRef.snapshotId,'preview:1');
   assert.equal(response.summary.tokenAnalysis.totalAnalysis?.subtotal,1100);
   assert.equal(response.summary.tokens.total,null);
   for(const item of response.items){
    const usage=item.kind==='thread'?item.matchedUsage:item.usage;
    if(item.kind!=='measurement')assert.equal(usage.tokenAnalysis.totalAnalysis?.subtotal,1100);
   }
  }
  const overview=responses[0];assert.equal(overview.distribution?.maxTokens,1100);assert.equal(overview.distribution?.tokenBasis,'analyzed_totals');
  const steps=responses[3];assert.equal(steps.items.length,scenario==='token-calculated'?1:2);
  assert.equal(steps.items.reduce((sum,item)=>sum+(item.kind==='measurement'?item.usage.tokenAnalysis.totalAnalysis?.subtotal??0:0),0),1100);
  const row=overview.items[0];assert.equal(row.kind,'usage');
  if(row.kind==='usage')assert.equal(row.share,scenario==='token-calculated'?1:null);
 });
}
