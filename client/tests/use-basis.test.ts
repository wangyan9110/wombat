import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locale, useBasisPresentation, type PublicUseBasis } from '../src/locale/index.js';
export const basis: PublicUseBasis = { methodVersion: 2, status: 'unknown', unit: 'object_use', capturedAt: '2026-10-02T00:00:00Z', snapshotId: 'live:fixed', scope: { sourceInstanceIds: ['synthetic-source'], project: '/synthetic/project', threadId: 'task', agentKind: 'codex', window: { kind: 'date_window', since: '2026-09-01', until: '2026-10-01', timezone: 'UTC' } }, timeBasis: 'source_operation_time', coverage: { dispatchGaps: 1, identityGaps: 2, targetGaps: 3, timeGaps: 4, turnGaps: 5 }, sourceCompleteness: 'partial' };
test('public basis explains the fixed scope and five gaps in both languages without claiming dispatch or absence', () => {
  const saved = locale.getSnapshot().locale;
  try { for (const language of ['zh', 'en'] as const) {
    locale.setLocale(language);
    const value = useBasisPresentation(basis), text = [value.summary, ...value.notes, ...value.details].join('\n');
    assert.match(text, /次数未知|count unknown/); assert.match(text, /不等同于派发|not necessarily the dispatch/);
    assert.ok(text.includes('synthetic-source')); assert.ok(text.includes('/synthetic/project'));
    assert.ok(text.includes('2026-09-01')); assert.ok(text.includes('2026-10-01')); assert.ok(text.includes('live:fixed'));
    for (const n of [1, 2, 3, 4, 5]) assert.ok(value.details.some(line => line.endsWith(`: ${n}`) || line.endsWith(`：${n}`)));
    assert.doesNotMatch(text, /\{"|dispatchGaps|source_instance/);
    const unavailable = useBasisPresentation({ ...basis, status: 'unavailable', coverage: {} });
    assert.ok(unavailable.details.slice(-5).every(line => /未知|Unknown/.test(line)));
    assert.doesNotMatch(unavailable.details.slice(-5).join(' '), /: 0|：0/);
    const follow = useBasisPresentation({ ...basis, status: 'observed', scope: { ...basis.scope, window: { kind: 'follow_up', after: 'after-marker', through: 'captured-marker' } } });
    assert.ok(follow.notes[0].includes('after-marker')); assert.ok(follow.notes[0].includes('captured-marker'));
    assert.match(useBasisPresentation(null).summary, /没有|No fixed/);
  } } finally { locale.setLocale(saved); }
});

test('generated config and follow-up validators accept observed, unknown and null bases and reject untyped time claims', async () => {
  const { validate: config } = await import('../src/generated/validate-config-response.js');
  const { validate: optimize } = await import('../src/generated/validate-optimize-response.js');
  const item = { id:'item',name:'synthetic',kind:'skill',sourceInstanceId:'synthetic-source',path:'/synthetic/SKILL.md',authorizedProjects:[],sourceContexts:[],configuredState:'enabled',contentHash:'synthetic',observedAt:basis.capturedAt,current:true,stale:false,estimateStatus:'unknown',measurementStatus:'unknown',bodyEstimateStatus:'unknown',observation:'unknown',counts:{fileReads:0,toolCalls:0,resourceReads:0,succeeded:0,failed:0,outcomeUnknown:0},relatedTurns:0,relatedTasks:0 };
  const configBase = { outputVersion:1,action:'list',capabilities:{kinds:['skill'],evidenceTypes:[],tokenEstimates:false,historicalContent:false,writes:false,projectRegistry:false},configRevision:'synthetic',checkedAt:basis.capturedAt,scope:{},authorizedProjects:[],summary:{currentItems:1,historicalItems:0,observedItems:0},items:[],evidence:[],relatedScopes:[],page:{offset:0,limit:1,total:1},coverage:{status:'partial',historyStatus:'fixed',issues:[],supportedEvidence:[],absenceObservable:false},hookRegistry:{status:'unavailable',contexts:[]} };
  const optimizeBase = { outputVersion:1,action:'list',capabilities:{staticChecks:true,manualEditReview:true,decisions:true,inactivity:false,mcpFaults:false,spaceCleanup:false,loadingBudgetDiagnosis:false,exactInstructionBlocks:false,declaredCopyDrift:false,hookSupport:{effectiveRegistry:false,status:'no_verified_adapter'}},configRevision:'synthetic',decisionRevision:'synthetic',checkedAt:basis.capturedAt,suggestions:[],pending:0,history:1,page:{offset:0,limit:1,total:0},issues:[],resultStatus:'complete',ruleParameters:{version:'synthetic',agentsBytesDefault:1,descriptionCharactersDefault:1,overrides:{},bodyTokens:1,descriptionStandardMax:1,applicability:'synthetic'},ruleCatalog:[],checks:[],followUps:[] };
  const follow = {recordId:'record',suggestionId:'suggestion',status:'unavailable',after:'2026-10-01T00:00:00Z',observedAt:basis.capturedAt,observedRecords:null,absenceObservable:false};
  for(const useBasis of [basis,{...basis,status:'observed'},null]){
    assert.ok(config({...configBase,items:[{...item,useBasis}]}));
    assert.ok(optimize({...optimizeBase,followUps:[{...follow,useBasis}]}));
  }
  for(const useBasis of [{...basis,timeBasis:'dispatch_time'}, {...basis,coverage:{timeGaps:-1}}, {...basis,scope:{...basis.scope,window:{kind:'nearest_time'}}}]) {
    assert.equal(config({...configBase,items:[{...item,useBasis}]}),false);
    assert.equal(optimize({...optimizeBase,followUps:[{...follow,useBasis}]}),false);
  }
});
