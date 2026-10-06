import {CoreError,type TimingLocalResult,type TimingShareResult,type TimingRequest,type TimingResult,type QueryOptions} from '@wombat/client';
import {timingCategories} from '@wombat/client/locale';
import type {Scenario} from './fixtures.js';
import {usesFixture,shareUsesFixture,usesEvidence} from './uses.js';
const metric = { value: null, status: 'unavailable', basis: 'not_recorded', evidenceRefs: [] } as const;
const unavailable = { support: 'unavailable', reason: 'not_recorded' } as const;
const capabilities = {
  wallClock: unavailable, nativeTtft: unavailable, firstContentRecordDelay: unavailable,
  lifecycleIntervals: unavailable, operationIntervals: unavailable, contextPressure: unavailable, strictResponseGap: unavailable,
  exploratoryGap: unavailable, commandLabels: unavailable, fileChanges: unavailable, messageRecords: unavailable, objectUses: {support:'supported',reason:'canonical_use_records'} as const,
};
export const capabilityResult = { outputVersion: 4, action: 'capabilities', methodVersion: 'safe_event_turn_v5', profile: 'local', capabilities } as const;
const scope = { sourceInstanceId: 'source', threadId: 'thread', turnId: 'turn', agentKind: 'codex', wholeTurn: true };
const count = () => ({ ...metric, evidenceRefs: [] });
const repeatDuration=()=>({knownSumMs:count(),recordedCount:count(),calculatedCount:count(),missingCount:count()});
const repeatedBehavior=()=>({failureMethod:'same_operation_after_failure_v1' as const,readMethod:'same_target_read_v1' as const,endpointMethodVersion:1,support:unavailable,readLayer:'same_path_range_unconfirmed' as const,afterFailure:{count:count(),duration:repeatDuration()},repeatedRead:{count:count(),duration:repeatDuration()},sameRequestObservationCount:count(),repeatedReadRequestCount:count(),recoverySpanSumMs:count(),missingRecoverySpanCount:count(),combinedOperationCount:count(),combinedUnionMs:count(),combinedMissingIntervalCount:count(),coverage:{candidateOperations:count(),eligibleCommands:count(),missingIdentityRecords:count(),excludedReceivers:count(),missingMatching:count(),conflictingOperations:count(),missingStart:count(),indeterminateOutcomes:count(),orderGaps:count(),contextBoundaries:count(),crossedContext:count(),missingClockDomain:count(),sourceMetadataGaps:count(),durationConflicts:count(),partial:true,reasonCodes:[]}});
const category = () => ({ candidates: count(), closed: count(), unionMs: count(), sumMs: count() });
const distribution = () => ({ samples: count(), median: count(), p90: count() });
const useTotals = { methodVersion: 3, sourceCoverage: 'unknown' as const, objectCount: count(), recordCount: count(), unboundTargetRecords: count(),
  unassignedSkillRecords: count(), unassignedMcpRecords: count(), coverage: { dispatchGaps: count(), identityGaps: count(), targetGaps: count(), timeGaps: count(), associatedTurnGaps: count() } };
const baseLocal: TimingLocalResult = {
  outputVersion: 4, action: 'summary', methodVersion: 'safe_event_turn_v5', profile: 'local',
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
    repeatedBehavior:repeatedBehavior(),
    operationCoverage: {methodVersion:1,endpointMethodVersion:1,candidateOperations:count(),pairedOperations:count(),identityGapRecords:count(),conflictingOperations:count(),coveredMs:count(),residualMs:count(),residualRangeCount:count(),partial:true,reasonCodes:['missing_window'],detail:unavailable,detailLimit:200,residualRanges:[]},
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
  freshness: { status: 'fixed' }, evidence: { repeatPages: {detail:unavailable,candidateOperationCount:count(),locatedOperationCount:count(),pageCount:count(),limitBytes:65536,entries:[]}, intervalPages: { detail: unavailable, candidateIntervalCount: count(), locatedIntervalCount: count(), missingEventRefCount: count(), pageCount: count(), limitBytes: 65536, entries: [] }, collections: [], available: false, limit: 50, snapshotId: 'live:scope:fixed', refs: [], method: 'synthetic' },
};
const baseShare: TimingShareResult = {
  outputVersion: 4, action: 'summary', methodVersion: baseLocal.methodVersion, profile: 'share-v1',
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
 result.coverage.sourceStatus='complete';
 result.quality={...result.quality,partial:missing||running,running,censored:running||scenario==='interrupted',...(scenario==='interrupted'?{reasonCodes:['missing_time']}:{})};
 result.time.nativeWallClockMs=missing||running?count():measured(10000);
 result.time.observedWindowMs=missing||running?count():measured(10000,'explicit_boundary');
 result.time.command.unionMs=missing||running?count():measured(5000,'lifecycle_union');result.time.command.sumMs=missing||running?count():measured(6000,'lifecycle_sum');
 let tracks:TimingLocalResult['time']['timeline']['tracks']=scenario==='empty'?[]:Array.from({length:scenario==='dense'?200:3},(_,index)=>({intervalAlias:`interval-${index}`,category:'command' as const,startMs:scenario==='dense'?0:1000+index*10,endMs:scenario==='dense'?10000:4000+index*10,clipped:false,evidenceScope:'event_records' as const,evidenceRefs:[`event:start-${index}`,`event:end-${index}`] as [string,string]}));
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

 const dense=scenario==='dense';
 if(!mcpOnly&&!mixed&&!missing&&!running){
  // Fixed independent truth for the supplied three overlapping intervals, or 200 full-window intervals.
  result.time.command={candidates:measured(dense?200:3,'safe_event_count'),closed:measured(dense?200:3,'safe_event_count'),unionMs:measured(dense?10000:3020,'lifecycle_union'),sumMs:measured(dense?2000000:9000,'lifecycle_sum')};
  result.time.coveredMs=measured(dense?10000:3020,'lifecycle_union');result.time.unclassifiedMs=measured(dense?0:6980,'interval_mask');result.time.coverageRatio=measured(dense?1:0.302,'interval_mask');
  result.time.intersectionMasksMs.forEach((_,index)=>{result.time.intersectionMasksMs[index]=measured(index===0?(dense?0:6980):index===1?(dense?10000:3020):0,'interval_mask');});
 }
 const noWindow=missing||running;
 const gapRanges=noWindow||dense?[]:mcpOnly?[[0,2000],[7000,10000]]:mixed?[[8000,10000]]:[[0,1000],[4020,10000]];
 result.time.timeline={...result.time.timeline,presentation:noWindow?'list':'timeline',detail:{support:noWindow?'unavailable':'supported',reason:noWindow?'missing_time':'explicit_boundary'},tracks:noWindow?[]:tracks,unclassifiedGaps:gapRanges.map(([startMs,endMs])=>({startMs,endMs,evidenceScope:'turn_collection',evidenceRefs:['collection:turn']})),trackCount:measured(noWindow?0:tracks.length,'safe_event_count'),entryCount:measured(noWindow?0:tracks.length+gapRanges.length,'safe_event_count'),identifiedIntervalCount:measured(tracks.length,'safe_event_count'),unclassifiedGapCount:measured(gapRanges.length,'safe_event_count'),unlocatedIntervalCount:measured(noWindow?tracks.length:0,'safe_event_count')};
 const analyzed=(value:number,basis:TimingLocalResult['time']['nativeWallClockMs']['basis'])=>({...measured(value,basis),status:'derived' as const});
 // Fixed synthetic repeat facts, independent of the view's interval presentation.
 const repeats=result.time.repeatedBehavior;
 repeats.support={support:noWindow?'partial':'supported',reason:'repeat_after_failure'};
 const repeatCount=scenario==='empty'||mcpOnly||mixed?0:1;
 for(const [group,basis] of [[repeats.afterFailure,'repeat_after_failure'],[repeats.repeatedRead,'successful_read_repeat']] as const){
  group.count=analyzed(noWindow?0:repeatCount,basis);
  group.duration={knownSumMs:analyzed(noWindow?0:repeatCount*40,'known_operation_duration'),recordedCount:measured(noWindow?0:repeatCount,'canonical_operation_identity'),calculatedCount:measured(0,'canonical_operation_identity'),missingCount:measured(0,'canonical_operation_identity')};
 }
 repeats.sameRequestObservationCount=analyzed(scenario==='empty'||mcpOnly||mixed?0:1,'same_request_observation');
 repeats.repeatedReadRequestCount=analyzed(scenario==='empty'||mcpOnly||mixed?0:2,'same_request_observation');
 repeats.recoverySpanSumMs=analyzed(noWindow?0:repeatCount*80,'failure_recovery_span');
 repeats.missingRecoverySpanCount=measured(0,'canonical_operation_identity');
 repeats.combinedOperationCount=measured(noWindow?0:repeatCount,'canonical_operation_identity');
 repeats.combinedUnionMs=noWindow?{...count(),basis:'missing_time'}:analyzed(repeatCount*40,'operation_union');
 repeats.combinedMissingIntervalCount=measured(0,'canonical_operation_identity');
 for(const field of ['candidateOperations','eligibleCommands','missingIdentityRecords','excludedReceivers','missingMatching','conflictingOperations','missingStart','indeterminateOutcomes','orderGaps','contextBoundaries','crossedContext','missingClockDomain','sourceMetadataGaps','durationConflicts'] as const)repeats.coverage[field]=measured(field==='candidateOperations'?(scenario==='empty'?0:mcpOnly?1:mixed?2:dense?200:3):field==='eligibleCommands'?(scenario==='empty'||mcpOnly?0:mixed?1:dense?200:3):field==='missingMatching'&&(mcpOnly||mixed)?1:field==='missingStart'&&noWindow&&scenario!=='empty'?3:0,'canonical_operation_identity');
 repeats.coverage.partial=noWindow||mcpOnly||mixed;repeats.coverage.reasonCodes=noWindow?scenario==='empty'?['missing_window']:['missing_start','missing_window']:mcpOnly||mixed?['missing_matching']:[];repeats.support.support=repeats.coverage.partial?'partial':'supported';
 const residualRanges=noWindow||dense?[]:mcpOnly?[[0,2000],[7000,10000]]:mixed?[[7000,10000]]:[[0,1000],[4020,10000]];
 const coverage=result.time.operationCoverage;
 coverage.candidateOperations=measured(scenario==='empty'?0:mcpOnly?1:mixed?2:dense?200:3,'canonical_operation_identity');
 coverage.pairedOperations=analyzed(missing?0:mcpOnly?1:mixed?2:dense?200:3,'explicit_boundary');
 coverage.identityGapRecords=measured(0,'safe_event_count');coverage.conflictingOperations=measured(0,'canonical_operation_identity');
 coverage.coveredMs=noWindow?{...count(),basis:'missing_time'}:analyzed(dense?10000:mcpOnly?5000:mixed?7000:3020,'operation_union');
 coverage.residualMs=noWindow?{...count(),basis:'missing_time'}:analyzed(dense?0:mcpOnly?5000:mixed?3000:6980,'operation_residual');
 coverage.residualRangeCount=noWindow?{...count(),basis:'missing_time'}:analyzed(residualRanges.length,'operation_residual');
 coverage.partial=noWindow;coverage.reasonCodes=noWindow?['missing_window',...(missing?scenario==='empty'?['no_paired_operations'] as const:['no_paired_operations','unlocated_operations'] as const:[])]:[];
 coverage.detail={support:noWindow?'unavailable':'supported',reason:noWindow?'missing_time':'operation_residual'};
 coverage.residualRanges=residualRanges.map(([startMs,endMs])=>({startMs,endMs}));
 result.capabilities.operationIntervals={support:'partial',reason:'operation_union'};

 result.evidence.available=true;result.evidence.collections=[{reference:'collection:turn',kind:'turn_events',snapshotId,scope:result.scope,count:measured(!noWindow&&repeatCount?10:4,'safe_event_count'),method:result.methodVersion}];
 result.evidence.intervalPages={detail:{support:'supported',reason:'safe_event_count'},candidateIntervalCount:measured(tracks.length,'safe_event_count'),locatedIntervalCount:measured(tracks.length,'safe_event_count'),missingEventRefCount:measured(0,'safe_event_count'),pageCount:measured(1,'safe_event_count'),limitBytes:65536,entries:tracks.map(track=>({intervalAlias:track.intervalAlias,pages:[{limit:200,evidenceRefs:track.evidenceRefs}]}))};
 const navigation=result.evidence.repeatPages;
 navigation.candidateOperationCount=structuredClone(repeats.combinedOperationCount);
 navigation.locatedOperationCount=measured(noWindow?0:repeatCount,'exact_event_page');
 navigation.pageCount=measured(noWindow?0:repeatCount*3,'exact_event_page');
 navigation.detail={support:noWindow||repeatCount===0?'unavailable':'supported',reason:noWindow?'missing_time':repeatCount===0?'no_candidates':'exact_event_page'};
 const proof=(role:'later'|'failure'|'read'):TimingLocalResult['evidence']['repeatPages']['entries'][number]['later']=>({operationAlias:`repeat:0:${role==='read'?'read:0':role}`,pages:[{cursor:{token:`synthetic-repeat-${role}`},limit:200,evidenceRefs:[`event:repeat-${role}-start`,`event:repeat-${role}-end`]}]});
 navigation.entries=noWindow||repeatCount===0?[]:[{later:proof('later'),afterFailure:proof('failure'),successfulReads:[proof('read')],repeatedReadTargetCount:1,laterDurationMs:measured(40,'native_record'),recoverySpanMs:analyzed(80,'failure_recovery_span')}];
 result.uses=usesFixture(result,scenario);result.capabilities={...result.capabilities,objectUses:result.uses.detail};
 return result;
}
export function timingShareFixture(local:TimingLocalResult):TimingShareResult {
 const result=structuredClone(baseShare);result.time=structuredClone(local.time);result.quality=structuredClone(local.quality);result.uses=shareUsesFixture(local);result.capabilities={...result.capabilities,objectUses:local.uses.detail};
 // Synthetic Rust-share-shaped facts use package aliases only; no local view is added.
 result.time.nativeWallClockMs.evidenceRefs=[];result.time.observedWindowMs.evidenceRefs=[];for(const category of timingCategories)for(const field of ['candidates','closed','unionMs','sumMs'] as const)result.time[category][field].evidenceRefs=[];
 for(const field of ['candidateOperations','pairedOperations','identityGapRecords','conflictingOperations','coveredMs','residualMs','residualRangeCount'] as const)result.time.operationCoverage[field].evidenceRefs=[];
 const repeat=result.time.repeatedBehavior;
 for(const field of ['sameRequestObservationCount','repeatedReadRequestCount','recoverySpanSumMs','missingRecoverySpanCount','combinedOperationCount','combinedUnionMs','combinedMissingIntervalCount'] as const)repeat[field].evidenceRefs=[];
 for(const group of [repeat.afterFailure,repeat.repeatedRead]){group.count.evidenceRefs=[];for(const field of ['knownSumMs','recordedCount','calculatedCount','missingCount'] as const)group.duration[field].evidenceRefs=[];}
 for(const field of ['candidateOperations','eligibleCommands','missingIdentityRecords','excludedReceivers','missingMatching','conflictingOperations','missingStart','indeterminateOutcomes','orderGaps','contextBoundaries','crossedContext','missingClockDomain','sourceMetadataGaps','durationConflicts'] as const)repeat.coverage[field].evidenceRefs=[];
 for(const measure of [...result.time.intersectionMasksMs,result.time.coveredMs,result.time.unclassifiedMs,result.time.coverageRatio])measure.evidenceRefs=[];
 result.time.timeline.tracks=result.time.timeline.tracks.map((track,index)=>({...track,intervalAlias:`interval-${index}`,evidenceRefs:[]}));result.time.timeline.unclassifiedGaps=result.time.timeline.unclassifiedGaps.map(gap=>({...gap,evidenceRefs:[]}));
 for(const field of ['entryCount','trackCount','identifiedIntervalCount','unclassifiedGapCount','unlocatedIntervalCount','outsideWindowIntervalCount'] as const)result.time.timeline[field].evidenceRefs=[];
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
  const repeatRole=request.cursor?.token.match(/^synthetic-repeat-(later|failure|read)$/)?.[1];
  if(repeatRole){
   const start=Date.parse('2026-10-05T00:00:00Z')+(repeatRole==='later'?140:repeatRole==='failure'?60:0);
   return {outputVersion:4,action:'evidence',collection:'turn_events',methodVersion:local.methodVersion,profile:'local',snapshotId:request.snapshotId,scope:local.scope,total:{value:10,status:'observed',basis:'safe_event_count',evidenceRefs:[]},rows:[{reference:`event:repeat-${repeatRole}-start`,recordKind:'operation',phase:'started',timestampMs:start,gapCodes:[]},{reference:`event:repeat-${repeatRole}-end`,recordKind:'operation',phase:repeatRole==='failure'?'failed':'completed',timestampMs:start+40,durationMs:40,gapCodes:[]}],nextCursor:null};
  }
  return {outputVersion: 4,action:'evidence',collection:'turn_events',methodVersion:local.methodVersion,profile:'local',snapshotId:request.snapshotId,scope:local.scope,total:local.evidence.collections[0].count,rows:request.cursor?[{reference:'event:end-0',recordKind:'lifecycle',phase:'completed',timestampMs:4000,gapCodes:[]}]:[{reference:'event:start-0',recordKind:'lifecycle',phase:'started',timestampMs:1000,gapCodes:[]}],nextCursor:request.cursor?null:{token:'synthetic-next'}};
 };
}
