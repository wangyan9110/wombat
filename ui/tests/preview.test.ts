import{test}from'node:test';
import assert from'node:assert/strict';
import{configFixture,createRuleFixture}from'../src/preview/configuration.js';
import{createPreviewClient}from'../src/preview/fixtures.js';
test('preview inventory filters objects and exposes separate failed read evidence',()=>{
 const list=configFixture({kind:'skill'});assert.equal(list.items.length,1);assert.equal(list.items[0].usageCount,3);
 const evidence=configFixture({action:'evidence',itemId:list.items[0].id,limit:2});assert.equal(evidence.page.total,3);assert.equal(evidence.evidence.length,2);assert.equal(evidence.evidence[1].outcome,'failed');assert.equal(evidence.page.nextOffset,2);
 assert.equal(configFixture({},true).items.length,0);
});
test('preview user decisions persist across recheck independently of five assessment outcomes',()=>{
 const query=createRuleFixture();const initial=query({action:'checks'});assert.deepEqual(initial.checks.map(c=>c.outcome),['hit','miss','insufficient','unsupported','error']);
 const kept=query({action:'keep',suggestionId:'preview-suggestion',decisionReason:'necessary'});assert.equal(kept.history,1);assert.equal(kept.pending,0);
 const rechecked=query({action:'recheck',suggestionId:'preview-suggestion'});assert.equal(rechecked.suggestions[0].decision?.reason,'necessary');assert.equal(rechecked.checks[0].outcome,'hit');assert.equal(query({group:'pending'}).suggestions.length,0);
 assert.equal(query({action:'redisplay'}).pending,1);
});
test('preview failure and cancellable loading apply to configuration as well as usage',async()=>{
 const error=createPreviewClient('error');await assert.rejects(error.config!({}),{code:'SOURCE_UNREADABLE'});
 const loading=createPreviewClient('loading'),controller=new AbortController();const pending=loading.config!({},{signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'CANCELLED'});
 const running=await createPreviewClient('running').query({action:'turns'});assert.equal(running.items[0].kind,'turn');if(running.items[0].kind==='turn')assert.equal(running.items[0].endedAt,null);
});

test('preview fixtures pass the same public client validation as host responses',async()=>{
 const {createUsageClient}=await import('@wombat/client');
 const raw=createPreviewClient('complete');
 const client=createUsageClient(raw.query,raw.prices,undefined,raw.config,raw.optimize,undefined,undefined,{account:raw.account});
 await client.query({action:'usage'});
 await client.query({action:'threads'});
 await client.config!({action:'list'});
 await client.config!({action:'evidence',itemId:'preview-skill'});
 await client.optimize!({action:'list'});
 await client.optimize!({action:'checks',itemId:'preview-skill'});
 await client.account!({action:'read'});
});

test('initial read exposes task headers without inventing a completed ledger',async()=>{
 const raw=createPreviewClient('initial');
 const {createUsageClient}=await import('@wombat/client');
 const client=createUsageClient(raw.query,raw.prices,raw.live);
 const response=await client.live!({query:{action:'threads'}});
 assert.equal(response.result.freshness?.initialScan,true);
 assert.equal(response.result.summary.tokens.total,null);
 assert.equal(response.result.summary.price.cost,null);
 assert.equal(response.result.items[0].kind,'thread');
 if(response.result.items[0].kind==='thread')assert.equal(response.result.items[0].matchedUsage.measurementCount,0);
 const turns=await client.live!({query:{action:'turns',threadId:'preview-task'}});assert.equal(turns.result.items.length,0);
});
