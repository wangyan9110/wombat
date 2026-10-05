// Synthetic public DTOs; no core process, source records or configuration reads.
import type { TimingLocalResult, TimingShareResult } from '@wombat/client';
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
const useTotals = { methodVersion: 3, sourceCoverage: 'unknown' as const, objectCount: count(), recordCount: count(), unboundTargetRecords: count(),
  unassignedSkillRecords: count(), unassignedMcpRecords: count(), coverage: { dispatchGaps: count(), identityGaps: count(), targetGaps: count(), timeGaps: count(), associatedTurnGaps: count() } };
export const local: TimingLocalResult = {
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
export const share: TimingShareResult = {
  outputVersion: 1, action: 'summary', methodVersion: local.methodVersion, profile: 'share-v1',
  uses: useTotals,
  privacy: { profile: 'share-v1', omittedFields: ['local_ids'], aliases: 'package' },
  scope: { taskAlias: 'task-1', turnAlias: 'turn-1', wholeTurn: true }, capabilities, relativeAnchors: local.anchors,
  time: local.time, context: local.context, work: local.work, findings: [], coverage: local.coverage, quality: local.quality,
  freshness: { status: 'fixed' }, basisCollections: [],
};
