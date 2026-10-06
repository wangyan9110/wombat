import { withTokenAnalysis } from '../../tests/fixtures/token-analysis.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreError, createUsageClient, type UsageRequest, type UsageResult } from '@wombat/client';

const response: UsageResult = {
  outputVersion: 5, action: 'usage',
  snapshotRef: { snapshotId: 'synthetic', createdAt: '2026-09-30T00:00:00Z' },
  scope: {}, availableRange: {},
  summary: withTokenAnalysis({
    tokens: { input: 10, output: 2, total: 12 }, measurementCount: 1,
    price: { currency: 'USD', policy: 'synthetic', priceRevision: 'synthetic', cost: '0.1', knownCost: '0.1', status: 'priced', components: [], basis: [], issues: [] },
  }),
  items: [], page: { offset: 0, limit: 50, total: 0 }, quality: { status: 'complete', issues: [], sources: [] },
};

test('portable client validates requests before invoking any host', async () => {
  let called = false;
  const client = createUsageClient({ query: async () => { called = true; return response; } });
  await assert.rejects(client.query({ action: 'shell' } as unknown as UsageRequest), (error: unknown) => error instanceof CoreError && error.code === 'INVALID_ARGUMENT');
  await assert.rejects(client.query({ action: 'usage', limit: -1 }), /查询参数/);
  assert.equal(called, false);
});

test('portable client keeps generated results and forwards cancellation and progress', async () => {
  const controller = new AbortController();
  const stages: string[] = [];
  const client = createUsageClient({
    query: async (request, options) => {
      assert.deepEqual(request, { action: 'usage' });
      assert.equal(options.signal, controller.signal);
      options.onProgress?.('读取快照');
      return response;
    },
  });
  assert.equal(await client.query({ action: 'usage' }, { signal: controller.signal, onProgress: stage => stages.push(stage) }), response);
  assert.deepEqual(stages, ['读取快照']);
  controller.abort();
  await assert.rejects(client.query({ action: 'usage' }, { signal: controller.signal }), (error: unknown) => error instanceof CoreError && error.code === 'CANCELLED');
});

test('portable client rejects wrong version, malformed result and mismatched operation', async () => {
  for (const invalid of [{ ...response, outputVersion: 3 }, { ...response, outputVersion: 3 }, { ...response, outputVersion: 4 }, { ...response, action: 'refresh' }, { ...response, summary: {} }, null]) {
    await assert.rejects(createUsageClient({ query: async () => invalid }).query({ action: 'usage' }), (error: unknown) => error instanceof CoreError && error.code === 'PROTOCOL_ERROR');
  }
});

test('configuration review and preference transports reject broad commands, bad languages and aborted operations',async()=>{
 let calls=0;const transport=async()=>{calls++;return {outputVersion:1,action:'get',language:'en'};};
 const client=createUsageClient({
  query: async()=>response,
  optimize: transport,
  preferences: transport
 });
 await assert.rejects(client.optimize!({action:'execute'} as never),{code:'INVALID_ARGUMENT'});
 await assert.rejects(client.preferences!({action:'set',language:'fr'} as never),{code:'INVALID_ARGUMENT'});
 assert.equal(calls,0);
 const c=new AbortController();c.abort();await assert.rejects(client.preferences!({action:'get'},{signal:c.signal}),{code:'CANCELLED'});
 assert.equal(calls,0);assert.equal((await client.preferences!({action:'get'})).language,'en');
 await assert.rejects(client.preferences!({action:'set',language:'zh'}),{code:'PROTOCOL_ERROR'});
});

test('usage v5 requires per-field token analysis and its exact method and scope', async()=>{
 const {tokenAnalysis,...oldSummary}=response.summary;
 const variations=[{...response,summary:oldSummary},
  ...[0,2].map(methodVersion=>({...response,summary:{...response.summary,tokenAnalysis:{...tokenAnalysis,methodVersion}}})),
  {...response,summary:{...response.summary,tokenAnalysis:{...tokenAnalysis,scope:'allLogs'}}},
  {...response,summary:{...response.summary,tokenAnalysis:{...tokenAnalysis,fields:{...tokenAnalysis.fields,total:{...tokenAnalysis.fields.total,coveredRecords:-1}}}}},
 ];
 for(const result of variations)await assert.rejects(createUsageClient({query:async()=>result}).query({action:'usage'}),{code:'PROTOCOL_ERROR'});
});


test('usage v5 accepts separate calculation analysis and rejects unsupported methods',async()=>{
 const totalAnalysis={methodVersion:1,subtotal:12,coveredRecords:1,recordedRecords:0,calculatedRecords:1,unavailableRecords:0,overflowRecords:0};
 const value={...response,summary:{...response.summary,tokenAnalysis:{...response.summary.tokenAnalysis,totalAnalysis}}};
 assert.deepEqual(await createUsageClient({query:async()=>value}).query({action:'usage'}),value);
 for(const invalid of [{...totalAnalysis,methodVersion:2},{...totalAnalysis,subtotal:9007199254740992},{...totalAnalysis,overflowRecords:-1},{...totalAnalysis,unexpected:true}]){
  await assert.rejects(createUsageClient({query:async()=>({...value,summary:{...value.summary,tokenAnalysis:{...value.summary.tokenAnalysis,totalAnalysis:invalid}}})}).query({action:'usage'}),{code:'PROTOCOL_ERROR'});
 }
});
