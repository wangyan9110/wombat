import {CoreError,type TimingLocalResult,type TimingShareResult,type TimingRequest,type TimingResult,type QueryOptions} from '@wombat/client';
import {timingCategories} from '@wombat/client/locale';
import type {Scenario} from './fixtures.js';
import {usesFixture,shareUsesFixture,usesEvidence} from './uses.js';
const metric = { value: null, status: 'unavailable', basis: 'not_recorded', evidenceRefs: [] } as const;
const unavailable = { support: 'unavailable', reason: 'not_recorded' } as const;
const capabilities = {
  wallClock: unavailable, nativeTtft: unavailable, firstContentRecordDelay: unavailable,
  lifecycleIntervals: unavailable, contextPressure: unavailable, strictResponseGap: unavailable,
  exploratoryGap: unavailable, commandLabels: unavailable, fileChanges: unavailable, messageRecords: unavailable, objectUses: {support:'supported',reason:'canonical_use_records'} as const,
};
export const capabilityResult = { outputVersion: 1, action: 'capabilities', methodVersion: 'safe_event_turn_v3', profile: 'local', capabilities } as const;
const scope = { sourceInstanceId: 'source', threadId: 'thread', turnId: 'turn', agentKind: 'codex', wholeTurn: true };
const count = () => ({ ...metric, evidenceRefs: [] });
const category = () => ({ candidates: count(), closed: count(), unionMs: count(), sumMs: count() });
const distribution = () => ({ samples: count(), median: count(), p90: count() });
const useTotals = { methodVersion: 3, sourceCoverage: 'unknown' as const, objectCount: count(), recordCount: count(), unboundTargetRecords: count(),
  unassignedSkillRecords: count(), unassignedMcpRecords: count(), coverage: { dispatchGaps: count(), identityGaps: count(), targetGaps: count(), timeGaps: count(), associatedTurnGaps: count() } };
const baseLocal: TimingLocalResult = {
  outputVersion: 1, action: 'summary', methodVersion: 'safe_event_turn_v3', profile: 'local',
  uses: { totals: useTotals, detail: unavailable, limit: 50, objects: [], nextCursor: null },
  privacy: { profile: 'local', omittedFields: [], aliases: 'none' },
  readView: { snapshotId: 'live:scope:fixed', snapshotSchema: 4, createdAt: '2026-10-05T00:00:00Z', adapterVersions: [], projectionVersion: 1 },
  scope, capabilities, anchors: { startMs: count(), endMs: count() },
  time: {
    timeline: { presentation: 'list', detail: unavailable, entryCount: count(), trackCount: count(), identifiedIntervalCount: count(), unclassifiedGapCount: count(), unlocatedIntervalCount: count(), outsideWindowIntervalCount: count(), detailLimit: 200, tracks: [], unclassifiedGaps: [] },
    state: 'unknown', nativeWallClockMs: count(), derivedWallClockMs: count(), nativeTtftMs: count(), firstContentRecordDelayMs: count(),
    boundaryDiscrepancyMs: count(), observedWindowMs: count(), command: category(), compaction: category(), reasoning: category(), mcp: category(),
    intersectionMasksMs: [count(), count(), count(), count(), count(), count(), count(), count(), count(), count(), count(), count(), count(), count(), count(), count()], coveredMs: count(), unclassifiedMs: count(), coverageRatio: count(), waitingProxyMs: count(),
    strictResponseGapMs: count(), exploratoryGapMs: count(),
  },
  context: {
    activeContextOccupancy: count(), compactionRecords: count(), compactionTimeMs: count(), method: 'synthetic', quantileMethod: 'type7',
    candidates: count(), conflictingMeasurements: count(), conflictingWindowRecords: count(), input: distribution(), ratio: distribution(),
    segmentCount: count(), segments: [], compactionNeighbors: [], detail: unavailable,
  },
  work: {
    operationCandidates: count(), closedOperations: count(), failedOperations: count(), labelledCommandMs: count(), fileChangeRecords: count(),
    changedFiles: count(), addedLines: count(), removedLines: count(), messageRecordCandidates: count(), nonemptyVisibleContentRecords: count(),
    unknownContentRecords: count(), missingContentTimeRecords: count(), userBoundaryRecords: count(), injectedContextRecords: count(),
    reasoningMessageRecords: count(), compactionRecords: count(), repositoryBaseline: unavailable,
  },
  findings: [], coverage: {
    facts: count(), bytes: count(), metadata: count(), eventBlocks: count(), scopedEvents: count(), scopedMeasurements: count(),
    boundaryCandidates: count(), lifecycleCandidates: [count(), count(), count(), count()], linkedLifecycles: [count(), count(), count(), count()], conflictingLifecycles: count(), missingIdentityLifecycles: count(),
    contentCandidates: count(), domainCount: count(), missingWatermarks: count(), generationMismatches: count(), incompleteDomains: count(),
    snapshotUnassignedTotal: count(), threadUnassignedTotal: count(), sourceStatus: 'unknown',
  },
  quality: { partial: true, running: false, censored: true, reasonCodes: [], factLimit: 100000, summaryLimitBytes: 262144 },
  freshness: { status: 'fixed' }, evidence: { intervalPages: { detail: unavailable, candidateIntervalCount: count(), locatedIntervalCount: count(), missingEventRefCount: count(), pageCount: count(), limitBytes: 65536, entries: [] }, collections: [], available: false, limit: 50, snapshotId: 'live:scope:fixed', refs: [], method: 'synthetic' },
};
const baseShare: TimingShareResult = {
  outputVersion: 1, action: 'summary', methodVersion: baseLocal.methodVersion, profile: 'share-v1',
  uses: useTotals,
  privacy: { profile: 'share-v1', omittedFields: ['local_ids'], aliases: 'package' },
  scope: { taskAlias: 'task-1', turnAlias: 'turn-1', wholeTurn: true }, capabilities, relativeAnchors: baseLocal.anchors,
  time: baseLocal.time, context: baseLocal.context, work: baseLocal.work, findings: [], coverage: baseLocal.coverage, quality: baseLocal.quality,
  freshness: { status: 'fixed' }, basisCollections: [],
};

export function timingFixture(scenario:Scenario='complete',snapshotId='preview:1',threadId='preview-task',turnId='preview-turn'):TimingLocalResult {
 const result=structuredClone(baseLocal),missing=scenario==='missing'||scenario==='empty'||scenario==='interrupted',running=scenario==='running';
 const measured=(value:number,basis:TimingLocalResult['time']['nativeWallClockMs']['basis']='native_record')=>({value,status:'observed' as const,basis,evidenceRefs:['collection:turn']});
 result.readView.snapshotId=snapshotId;result.scope={...result.scope,threadId,turnId,sourceInstanceId:'preview'};result.evidence.snapshotId=snapshotId;
 result.freshness={status:'fixed',checkedAt:'2026-10-05T00:00:00Z'};
 result.time.state=running?'running':missing?'unknown':scenario==='cancelled'?'cancelled':scenario==='failed'?'failed':'completed';
 result.quality={...result.quality,partial:missing||running,running,censored:running||scenario==='interrupted',...(scenario==='interrupted'?{reasonCodes:['missing_time']}:{})};
 result.time.nativeWallClockMs=missing||running?count():measured(10000);
 result.time.observedWindowMs=missing?count():measured(10000,'explicit_boundary');
 result.time.command.unionMs=missing?count():measured(5000,'lifecycle_union');result.time.command.sumMs=missing?count():measured(6000,'lifecycle_sum');
 let tracks:TimingLocalResult['time']['timeline']['tracks']=scenario==='empty'?[]:Array.from({length:scenario==='dense'?200:3},(_,index)=>({intervalAlias:`interval-${index}`,category:'command' as const,startMs:1000+index*10,endMs:4000+index*10,clipped:false,evidenceScope:'event_records' as const,evidenceRefs:[`event:start-${index}`,`event:end-${index}`] as [string,string]}));
 const mcpOnly=scenario==='mcp-only',mixed=scenario==='mcp-mixed';
 if(mcpOnly||mixed){
  const ranges=mcpOnly?[['mcp',2000,7000] as const]:[['command',0,6000],['compaction',2000,5000],['reasoning',3000,8000],['mcp',4000,7000]] as const;
  tracks=ranges.map(([category,startMs,endMs],index)=>({intervalAlias:`interval-${index}`,category,startMs,endMs,clipped:false,evidenceScope:'event_records',evidenceRefs:[`event:start-${index}`,`event:end-${index}`]}));
  // Handwritten synthetic oracle, not interval arithmetic in a view.
  const durations=mcpOnly?[0,0,0,5000]:[6000,3000,5000,3000];
  timingCategories.forEach((category,index)=>{result.time[category]={candidates:measured(durations[index]===0?0:1,'safe_event_count'),closed:measured(durations[index]===0?0:1,'safe_event_count'),unionMs:measured(durations[index],'lifecycle_union'),sumMs:measured(durations[index],'lifecycle_sum')};});
  const masks=mcpOnly?[5000,0,0,0,0,0,0,0,5000,0,0,0,0,0,0,0]:[2000,2000,0,1000,1000,0,0,1000,0,0,0,0,1000,1000,0,1000];
  result.time.intersectionMasksMs=[measured(masks[0],'interval_mask'), measured(masks[1],'interval_mask'), measured(masks[2],'interval_mask'), measured(masks[3],'interval_mask'), measured(masks[4],'interval_mask'), measured(masks[5],'interval_mask'), measured(masks[6],'interval_mask'), measured(masks[7],'interval_mask'), measured(masks[8],'interval_mask'), measured(masks[9],'interval_mask'), measured(masks[10],'interval_mask'), measured(masks[11],'interval_mask'), measured(masks[12],'interval_mask'), measured(masks[13],'interval_mask'), measured(masks[14],'interval_mask'), measured(masks[15],'interval_mask')];
  result.time.coveredMs=measured(mcpOnly?5000:8000,'lifecycle_union');result.time.unclassifiedMs=measured(mcpOnly?5000:2000,'interval_mask');
  result.time.coverageRatio=measured(mcpOnly?0.5:0.8,'interval_mask');
 }
 result.time.timeline={...result.time.timeline,presentation:missing?'list':'timeline',detail:{support:missing?'unavailable':'supported',reason:missing?'missing_time':'explicit_boundary'},tracks:missing?[]:tracks,unclassifiedGaps:missing?[]:(mcpOnly?[[0,2000],[7000,10000]]:mixed?[[8000,10000]]:[[9000,10000]]).map(([startMs,endMs])=>({startMs,endMs,evidenceScope:'turn_collection',evidenceRefs:['collection:turn']})),trackCount:measured(tracks.length,'safe_event_count'),entryCount:measured(missing?0:tracks.length,'safe_event_count'),identifiedIntervalCount:measured(tracks.length,'safe_event_count'),unlocatedIntervalCount:measured(missing?tracks.length:0,'safe_event_count')};
 result.evidence.available=true;result.evidence.collections=[{reference:'collection:turn',kind:'turn_events',snapshotId,scope:result.scope,count:measured(4,'safe_event_count'),method:result.methodVersion}];
 result.evidence.intervalPages={detail:{support:'supported',reason:'safe_event_count'},candidateIntervalCount:measured(tracks.length,'safe_event_count'),locatedIntervalCount:measured(tracks.length,'safe_event_count'),missingEventRefCount:measured(0,'safe_event_count'),pageCount:measured(1,'safe_event_count'),limitBytes:65536,entries:tracks.map(track=>({intervalAlias:track.intervalAlias,pages:[{limit:200,evidenceRefs:track.evidenceRefs}]}))};
 result.uses=usesFixture(result,scenario);result.capabilities={...result.capabilities,objectUses:result.uses.detail};
 return result;
}
export function timingShareFixture(local:TimingLocalResult):TimingShareResult {
 const result=structuredClone(baseShare);result.time=structuredClone(local.time);result.quality=structuredClone(local.quality);result.uses=shareUsesFixture(local);result.capabilities={...result.capabilities,objectUses:local.uses.detail};
 // Synthetic Rust-share-shaped facts use package aliases only; no local view is added.
 result.time.nativeWallClockMs.evidenceRefs=[];result.time.observedWindowMs.evidenceRefs=[];for(const category of timingCategories)for(const field of ['candidates','closed','unionMs','sumMs'] as const)result.time[category][field].evidenceRefs=[];
 for(const measure of [...result.time.intersectionMasksMs,result.time.coveredMs,result.time.unclassifiedMs,result.time.coverageRatio])measure.evidenceRefs=[];
 result.time.timeline.tracks=result.time.timeline.tracks.map((track,index)=>({...track,intervalAlias:`interval-${index}`,evidenceRefs:[]}));result.time.timeline.unclassifiedGaps=result.time.timeline.unclassifiedGaps.map(gap=>({...gap,evidenceRefs:[]}));
 for(const field of ['entryCount','trackCount','identifiedIntervalCount','unlocatedIntervalCount'] as const)result.time.timeline[field].evidenceRefs=[];
 return result;
}
export function previewTiming(scenario:Scenario){
 return async(request:TimingRequest,options?:QueryOptions):Promise<TimingResult>=>{
  if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
  if(request.action!=='capabilities'&&(['source-missing','source-unreadable','source-unsupported'].includes(scenario)||scenario==='usage-unassigned'&&request.turnId==='unassigned'))throw new CoreError('NOT_FOUND','Synthetic turn boundary unavailable');
  if(scenario==='error')throw new CoreError('SOURCE_UNREADABLE','Synthetic source error');
  if(scenario==='loading')return new Promise<TimingResult>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new CoreError('CANCELLED','Cancelled')),{once:true}));
  if(request.action==='capabilities')return {...capabilityResult,profile:request.privacyProfile??'local'};
  const local=timingFixture(scenario,request.snapshotId??'preview:1',request.threadId,request.turnId);
  if(request.action==='summary')return request.privacyProfile==='share-v1'?timingShareFixture(local):local;
  if(request.collection&&request.collection!=='turn_events')return usesEvidence(local,scenario,request);
  return {outputVersion:1,action:'evidence',collection:'turn_events',methodVersion:local.methodVersion,profile:'local',snapshotId:request.snapshotId,scope:local.scope,total:{value:4,status:'observed',basis:'safe_event_count',evidenceRefs:[]},rows:request.cursor?[{reference:'event:end-0',recordKind:'lifecycle',phase:'completed',timestampMs:4000,gapCodes:[]}]:[{reference:'event:start-0',recordKind:'lifecycle',phase:'started',timestampMs:1000,gapCodes:[]}],nextCursor:request.cursor?null:{token:'synthetic-next'}};
 };
}
