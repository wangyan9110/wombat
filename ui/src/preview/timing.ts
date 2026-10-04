import {CoreError,type TimingLocalResult,type TimingShareResult,type TimingRequest,type TimingResult,type QueryOptions} from '@wombat/client';
import type {Scenario} from './fixtures.js';
const metric = { value: null, status: 'unavailable', basis: 'not_recorded', evidenceRefs: [] } as const;
const unavailable = { support: 'unavailable', reason: 'not_recorded' } as const;
const capabilities = {
  wallClock: unavailable, nativeTtft: unavailable, firstContentRecordDelay: unavailable,
  lifecycleIntervals: unavailable, contextPressure: unavailable, strictResponseGap: unavailable,
  exploratoryGap: unavailable, commandLabels: unavailable, fileChanges: unavailable, messageRecords: unavailable, objectUses: unavailable,
};
export const capabilityResult = { outputVersion: 1, action: 'capabilities', methodVersion: 'safe_event_turn_v1', profile: 'local', capabilities } as const;
const scope = { sourceInstanceId: 'source', threadId: 'thread', turnId: 'turn', agentKind: 'codex', wholeTurn: true };
const count = () => ({ ...metric, evidenceRefs: [] });
const category = () => ({ candidates: count(), closed: count(), unionMs: count(), sumMs: count() });
const distribution = () => ({ samples: count(), median: count(), p90: count() });
const useTotals = { methodVersion: 1, sourceCoverage: 'unknown' as const, objectCount: count(), recordCount: count(), unboundTargetRecords: count(),
  unassignedSkillRecords: count(), unassignedMcpRecords: count(), coverage: { dispatchGaps: count(), identityGaps: count(), targetGaps: count(), timeGaps: count(), associatedTurnGaps: count() } };
const baseLocal: TimingLocalResult = {
  outputVersion: 1, action: 'summary', methodVersion: 'safe_event_turn_v1', profile: 'local',
  uses: { totals: useTotals, detail: unavailable, limit: 50, objects: [], nextCursor: null },
  privacy: { profile: 'local', omittedFields: [], aliases: 'none' },
  readView: { snapshotId: 'live:scope:fixed', snapshotSchema: 4, createdAt: '2026-10-05T00:00:00Z', adapterVersions: [], projectionVersion: 1 },
  scope, capabilities, anchors: { startMs: count(), endMs: count() },
  time: {
    timeline: { presentation: 'list', detail: unavailable, entryCount: count(), trackCount: count(), identifiedIntervalCount: count(), unclassifiedGapCount: count(), unlocatedIntervalCount: count(), outsideWindowIntervalCount: count(), detailLimit: 200, tracks: [], unclassifiedGaps: [] },
    state: 'unknown', nativeWallClockMs: count(), derivedWallClockMs: count(), nativeTtftMs: count(), firstContentRecordDelayMs: count(),
    boundaryDiscrepancyMs: count(), observedWindowMs: count(), command: category(), compaction: category(), reasoning: category(),
    intersectionMasksMs: [], coveredMs: count(), unclassifiedMs: count(), coverageRatio: count(), waitingProxyMs: count(),
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
    boundaryCandidates: count(), lifecycleCandidates: [], linkedLifecycles: [], conflictingLifecycles: count(), missingIdentityLifecycles: count(),
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
 const result=structuredClone(baseLocal),missing=scenario==='missing'||scenario==='empty',running=scenario==='running';
 const measured=(value:number,basis:TimingLocalResult['time']['nativeWallClockMs']['basis']='native_record')=>({value,status:'observed' as const,basis,evidenceRefs:['collection:turn']});
 result.readView.snapshotId=snapshotId;result.scope={...result.scope,threadId,turnId,sourceInstanceId:'preview'};result.evidence.snapshotId=snapshotId;
 result.freshness={status:'fixed',checkedAt:'2026-10-05T00:00:00Z'};
 result.time.state=running?'running':missing?'unknown':'completed';
 result.quality={...result.quality,partial:missing||running,running,censored:running};
 result.time.nativeWallClockMs=missing||running?count():measured(10000);
 result.time.observedWindowMs=missing?count():measured(10000,'explicit_boundary');
 result.time.command.unionMs=missing?count():measured(5000,'lifecycle_union');result.time.command.sumMs=missing?count():measured(6000,'lifecycle_sum');
 const tracks=scenario==='empty'?[]:Array.from({length:scenario==='dense'?200:3},(_,index)=>({intervalAlias:`interval-${index}`,category:'command' as const,startMs:1000+index*10,endMs:4000+index*10,clipped:false,evidenceScope:'event_records' as const,evidenceRefs:[`event:start-${index}`,`event:end-${index}`] as [string,string]}));
 result.time.timeline={...result.time.timeline,presentation:missing?'list':'timeline',detail:{support:missing?'unavailable':'supported',reason:missing?'missing_time':'explicit_boundary'},tracks:missing?[]:tracks,unclassifiedGaps:missing?[]:[{startMs:9000,endMs:10000,evidenceScope:'turn_collection',evidenceRefs:['collection:turn']}],entryCount:measured(missing?0:tracks.length,'safe_event_count'),identifiedIntervalCount:measured(tracks.length,'safe_event_count'),unlocatedIntervalCount:measured(missing?tracks.length:0,'safe_event_count')};
 result.evidence.available=true;result.evidence.collections=[{reference:'collection:turn',kind:'turn_events',snapshotId,scope:result.scope,count:measured(4,'safe_event_count'),method:result.methodVersion}];
 result.evidence.intervalPages={detail:{support:'supported',reason:'safe_event_count'},candidateIntervalCount:measured(tracks.length,'safe_event_count'),locatedIntervalCount:measured(tracks.length,'safe_event_count'),missingEventRefCount:measured(0,'safe_event_count'),pageCount:measured(1,'safe_event_count'),limitBytes:65536,entries:tracks.map(track=>({intervalAlias:track.intervalAlias,pages:[{limit:200,evidenceRefs:track.evidenceRefs}]}))};
 return result;
}
export function timingShareFixture(local:TimingLocalResult):TimingShareResult {
 const result=structuredClone(baseShare);result.time=structuredClone(local.time);result.quality=structuredClone(local.quality);
 // Synthetic Rust-share-shaped facts use package aliases only; no local view is added.
 result.time.nativeWallClockMs.evidenceRefs=[];result.time.observedWindowMs.evidenceRefs=[];result.time.command.unionMs.evidenceRefs=[];result.time.command.sumMs.evidenceRefs=[];
 result.time.timeline.tracks=result.time.timeline.tracks.map((track,index)=>({...track,intervalAlias:`interval-${index}`,evidenceRefs:[]}));result.time.timeline.unclassifiedGaps=result.time.timeline.unclassifiedGaps.map(gap=>({...gap,evidenceRefs:[]}));
 for(const field of ['entryCount','identifiedIntervalCount','unlocatedIntervalCount'] as const)result.time.timeline[field].evidenceRefs=[];
 return result;
}
export function previewTiming(scenario:Scenario){
 return async(request:TimingRequest,options?:QueryOptions):Promise<TimingResult>=>{
  if(options?.signal?.aborted)throw new CoreError('CANCELLED','Cancelled');
  if(scenario==='error')throw new CoreError('SOURCE_UNREADABLE','Synthetic source error');
  if(scenario==='loading')return new Promise<TimingResult>((_,reject)=>options?.signal?.addEventListener('abort',()=>reject(new CoreError('CANCELLED','Cancelled')),{once:true}));
  if(request.action==='capabilities')return {...capabilityResult,profile:request.privacyProfile??'local'};
  const local=timingFixture(scenario,request.snapshotId??'preview:1',request.threadId,request.turnId);
  if(request.action==='summary')return request.privacyProfile==='share-v1'?timingShareFixture(local):local;
  if(request.collection&&request.collection!=='turn_events')throw new CoreError('TIMING_DETAIL_UNAVAILABLE','Synthetic use evidence is unavailable');
  return {outputVersion:1,action:'evidence',collection:'turn_events',methodVersion:local.methodVersion,profile:'local',snapshotId:request.snapshotId,scope:local.scope,total:{value:4,status:'observed',basis:'safe_event_count',evidenceRefs:[]},rows:request.cursor?[{reference:'event:end-0',recordKind:'lifecycle',phase:'completed',timestampMs:4000,gapCodes:[]}]:[{reference:'event:start-0',recordKind:'lifecycle',phase:'started',timestampMs:1000,gapCodes:[]}],nextCursor:request.cursor?null:{token:'synthetic-next'}};
 };
}
