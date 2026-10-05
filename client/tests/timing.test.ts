import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoreError, createUsageClient, type TimingRequest, type TimingLocalResult, type TimingShareResult } from '@wombat/client';
import { createHttpClient } from '@wombat/client/http';
import { withAutomaticPrices } from '../src/node/auto-prices.js';
import { validate as validateLocal } from '../src/generated/validate-timing-local-response.js';
import { validate as validateShare } from '../src/generated/validate-timing-share-response.js';
import { validate as validateRequest } from '../src/generated/validate-timing-request.js';
import { readFile } from 'node:fs/promises';

const metric = { value: null, status: 'unavailable', basis: 'not_recorded', evidenceRefs: [] } as const;
const unavailable = { support: 'unavailable', reason: 'not_recorded' } as const;
const capabilities = {
  wallClock: unavailable, nativeTtft: unavailable, firstContentRecordDelay: unavailable,
  lifecycleIntervals: unavailable, contextPressure: unavailable, strictResponseGap: unavailable,
  exploratoryGap: unavailable, commandLabels: unavailable, fileChanges: unavailable, messageRecords: unavailable, objectUses: unavailable,
};
const capabilityResult = { outputVersion: 1, action: 'capabilities', methodVersion: 'safe_event_turn_v1', profile: 'local', capabilities } as const;
const scope = { sourceInstanceId: 'source', threadId: 'thread', turnId: 'turn', agentKind: 'codex', wholeTurn: true };
const count = () => ({ ...metric, evidenceRefs: [] });
const category = () => ({ candidates: count(), closed: count(), unionMs: count(), sumMs: count() });
const distribution = () => ({ samples: count(), median: count(), p90: count() });
const useTotals = { methodVersion: 3, sourceCoverage: 'unknown' as const, objectCount: count(), recordCount: count(), unboundTargetRecords: count(),
  unassignedSkillRecords: count(), unassignedMcpRecords: count(), coverage: { dispatchGaps: count(), identityGaps: count(), targetGaps: count(), timeGaps: count(), associatedTurnGaps: count() } };
const local: TimingLocalResult = {
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
const share: TimingShareResult = {
  outputVersion: 1, action: 'summary', methodVersion: local.methodVersion, profile: 'share-v1',
  uses: useTotals,
  privacy: { profile: 'share-v1', omittedFields: ['local_ids'], aliases: 'package' },
  scope: { taskAlias: 'task-1', turnAlias: 'turn-1', wholeTurn: true }, capabilities, relativeAnchors: local.anchors,
  time: local.time, context: local.context, work: local.work, findings: [], coverage: local.coverage, quality: local.quality,
  freshness: { status: 'fixed' }, basisCollections: [],
};
const summary: TimingRequest = { action: 'summary', threadId: 'thread', turnId: 'turn', snapshotId: 'live:scope:fixed', scope: { sourceInstanceId: 'source' } };
function client(result: unknown) { return createUsageClient({ query: async () => null, timing: async () => result }); }

test('standalone ESM validators retain Unicode lengths and the tighter Rust page bound', async () => {
  const request = { action: 'evidence', threadId: 'thread', turnId: 'turn', snapshotId: 'fixed', limit: 200, cursor: { token: '😀'.repeat(8192) } };
  assert.equal(validateRequest(request), true);
  assert.equal(validateRequest({ ...request, cursor: { token: '😀'.repeat(8193) } }), false);
  assert.equal(validateRequest({ ...request, cursor: { token: '\ud800'.repeat(8192) } }), true);
  assert.equal(validateRequest({ ...request, limit: 201 }), false);
  assert.equal(validateRequest({ ...request, limit: 0 }), false);
  for (const name of ['request', 'response', 'local-response', 'share-response']) {
    const source = await readFile(new URL(`../src/generated/validate-timing-${name}.js`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\brequire\s*\(/);
  }
});

test('numeric timing schemas retain null zero and fractions while rejecting unsafe integer measures', async () => {
  for (const value of [null, 0, Number.MAX_SAFE_INTEGER]) {
    const response = { ...local, time: { ...local.time, nativeWallClockMs: { ...count(), value } } };
    assert.equal(validateLocal(response), true);
    assert.equal(await client(response).timing!(summary), response);
  }
  assert.equal(validateLocal({ ...local, anchors: { ...local.anchors, startMs: { ...count(), value: -Number.MAX_SAFE_INTEGER } } }), true);
  assert.equal(validateLocal({ ...local, time: { ...local.time, coverageRatio: { ...count(), value: 0.5 } } }), true);
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) {
    const response = { ...local, time: { ...local.time, nativeWallClockMs: { ...count(), value } } };
    assert.equal(validateLocal(response), false);
    await assert.rejects(client(response).timing!(summary), { code: 'PROTOCOL_ERROR' });
  }
  assert.equal(validateLocal({ ...local, anchors: { ...local.anchors, startMs: { ...count(), value: -Number.MAX_SAFE_INTEGER - 1 } } }), false);
  assert.equal(validateShare({ ...share, work: { ...share.work, changedFiles: { ...count(), value: Number.MAX_SAFE_INTEGER + 1 } } }), false);
});

test('timing validates its narrow request before calling the independent host', async () => {
  let calls = 0;
  const reader = createUsageClient({ query: async () => null, timing: async () => { calls++; return capabilityResult; } });
  assert.equal(createUsageClient({ query: async () => null }).timing, undefined);
  for (const request of [
    { action: 'execute' }, { action: 'capabilities', nativeHooks: {} },
    { action: 'summary', threadId: 'thread', turnId: 'turn', verify: true },
    { action: 'evidence', threadId: 'thread', turnId: 'turn', snapshotId: 'fixed', limit: 201 },
  ]) await assert.rejects(reader.timing!(request as TimingRequest), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls, 0);
  assert.equal(await reader.timing!({ action: 'capabilities' }), capabilityResult);
});

test('timing responses bind action profile method target and selected snapshot', async () => {
  assert.equal(await client(local).timing!(summary), local);
  const evidence = { outputVersion: 1, action: 'evidence', collection: 'turn_events', methodVersion: local.methodVersion, profile: 'local', snapshotId: local.readView.snapshotId, scope, total: count(), rows: [] };
  assert.equal(await client(evidence).timing!({ ...summary, action: 'evidence', snapshotId: local.readView.snapshotId }), evidence);
  for (const invalid of [
    { ...local, outputVersion: 2 }, { ...local, action: 'evidence' }, { ...local, methodVersion: 'future' },
    { ...local, profile: 'share-v1' },
    ...[1, 2, 4].map(methodVersion => ({ ...local, uses: { ...local.uses, totals: { ...local.uses.totals, methodVersion } } })), { ...local, readView: { ...local.readView, snapshotId: 'live:scope:newer' } },
    ...['threadId', 'turnId', 'sourceInstanceId', 'agentKind'].map(field => ({ ...local, scope: { ...scope, [field]: 'other' } })),
    { ...local, scope: { ...scope, wholeTurn: false } },
  ]) await assert.rejects(client(invalid).timing!(summary), { code: 'PROTOCOL_ERROR' });
  await assert.rejects(client({ ...evidence, snapshotId: 'other' }).timing!({ action: 'evidence', threadId: 'thread', turnId: 'turn', snapshotId: 'fixed' }), { code: 'PROTOCOL_ERROR' });
});

test('local and share validators have their correct roots and reject leaked locating fields', async () => {
  assert.equal(validateLocal(local), true); assert.equal(validateShare(share), true);
  assert.equal(validateLocal(share), false); assert.equal(validateShare(local), false);
  assert.equal(await client(share).timing!({ ...summary, privacyProfile: 'share-v1' }), share);
  for (const invalid of [{ ...share, readView: local.readView }, { ...share, scope }, { ...share, privacy: local.privacy }])
    await assert.rejects(client(invalid).timing!({ ...summary, privacyProfile: 'share-v1' }), { code: 'PROTOCOL_ERROR' });
});

test('timing cancellation discards late results and never invokes prices or other products', async () => {
  const controller = new AbortController(); let calls = 0;
  const forbidden = async () => { throw new Error('unrelated transport'); };
  const reader = withAutomaticPrices(createUsageClient({ query: forbidden, prices: forbidden, config: forbidden, account: forbidden,
    live: forbidden, timing: async () => { calls++; controller.abort(); return local; } }));
  await assert.rejects(reader.timing!(summary, { signal: controller.signal }), (error: unknown) => error instanceof CoreError && error.code === 'CANCELLED');
  await assert.rejects(reader.timing!(summary, { signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(calls, 1);
});

test('HTTP timing uses its dedicated route and preserves cancellation and core failures', async () => {
  const reader = createHttpClient({ origin: 'http://127.0.0.1:1', token: 'synthetic', fetch: async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:1/api/timing');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer synthetic');
    assert.deepEqual(JSON.parse(String(options?.body)), { action: 'capabilities' });
    return new Response(JSON.stringify({ type: 'result', value: capabilityResult }) + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  } });
  assert.deepEqual(await reader.timing!({ action: 'capabilities' }), capabilityResult);
  const failed = createHttpClient({ origin: 'http://127.0.0.1:1', token: 'synthetic', fetch: async () => new Response('{"type":"error","code":"VIEW_EXPIRED","message":"expired"}\n', { headers: { 'content-type': 'application/x-ndjson' } }) });
  await assert.rejects(failed.timing!(summary), { code: 'VIEW_EXPIRED' });
});

test('nonempty local fragment navigation enforces bounds and stays outside sharing contracts', async () => {
  const refs = ['event:synthetic-endpoint'];
  const page = { cursor: null, limit: 200, evidenceRefs: refs };
  const entry = { intervalAlias: 'interval:1', pages: [page] };
  const value = (n: number) => ({ ...count(), value: n, status: 'derived', basis: 'exact_event_page' });
  const navigation = {
    detail: { support: 'supported', reason: 'exact_event_page' }, candidateIntervalCount: value(1),
    locatedIntervalCount: value(1), missingEventRefCount: value(0), pageCount: value(1), limitBytes: 65536, entries: [entry],
  };
  const response = (nav: unknown) => ({
    ...local,
    time: { ...local.time, timeline: {
      ...local.time.timeline, presentation: 'timeline', detail: { support: 'supported', reason: 'lifecycle_union' },
      entryCount: value(1), trackCount: value(1), identifiedIntervalCount: value(1), unclassifiedGapCount: value(0),
      unlocatedIntervalCount: value(0), outsideWindowIntervalCount: value(0),
      tracks: [{ intervalAlias: entry.intervalAlias, category: 'command', startMs: 0, endMs: 20, clipped: false, evidenceScope: 'event_records', evidenceRefs: refs }],
    } },
    evidence: { ...local.evidence, intervalPages: nav },
  });
  for (const cursor of [null, { token: 'opaque-token-for-mock' }]) {
    const valid = response({ ...navigation, entries: [{ ...entry, pages: [{ ...page, cursor }] }] });
    assert.equal(validateLocal(valid), true);
    assert.equal(await client(valid).timing!(summary), valid);
  }
  for (const invalid of [
    { ...navigation, entries: [{ ...entry, pages: Array.from({ length: 4 }, () => page) }] },
    { ...navigation, entries: [{ ...entry, pages: [{ ...page, evidenceRefs: Array.from({ length: 4 }, (_, i) => `event:${i}`) }] }] },
    { ...navigation, entries: Array.from({ length: 201 }, () => entry) },
    ...[0, 199, 201].map(limit => ({ ...navigation, entries: [{ ...entry, pages: [{ ...page, limit }] }] })),
  ]) {
    const rejected = response(invalid);
    assert.equal(validateLocal(rejected), false);
    await assert.rejects(client(rejected).timing!(summary), { code: 'PROTOCOL_ERROR' });
  }
  for (const rejected of [
    { ...share, intervalPages: navigation },
    { ...share, evidence: { intervalPages: navigation } },
    { ...share, time: { ...share.time, timeline: { ...share.time.timeline, intervalPages: navigation } } },
  ]) {
    assert.equal(validateShare(rejected), false);
    await assert.rejects(client(rejected).timing!({ ...summary, privacyProfile: 'share-v1' }), { code: 'PROTOCOL_ERROR' });
  }
});
const observed = (value: number, basis: TimingLocalResult['uses']['totals']['objectCount']['basis'] = 'canonical_use_records') => ({ value, status: 'observed' as const, basis, evidenceRefs: [] });
const objectRef = `use:${'a'.repeat(64)}`;
const knownUseTotals = { methodVersion: 3, sourceCoverage: 'complete' as const, objectCount: observed(1), recordCount: observed(3), unboundTargetRecords: observed(0),
  unassignedSkillRecords: observed(0, 'unassigned_use_index'), unassignedMcpRecords: observed(0, 'unassigned_use_index'),
  coverage: { dispatchGaps: observed(0), identityGaps: observed(0), targetGaps: observed(0), timeGaps: observed(0), associatedTurnGaps: observed(0) } };
const useObject = { objectRef, kind: 'skill' as const, state: 'used' as const, path: '/synthetic/skill/SKILL.md', server: null, project: null,
  associatedUseCount: observed(2, 'canonical_use_identity'), useCount: observed(2, 'canonical_use_identity'), recordCount: observed(3),
  unassignedTurnRecords: observed(0, 'unassigned_use_index'), coverage: knownUseTotals.coverage };
const useRecord = { reference: `use:${'b'.repeat(64)}`, objectRef, kind: 'skill_read' as const, state: 'used' as const, outcome: 'failed' as const,
  timestampMs: 0, timeBasis: 'source_operation_time' as const, nativeDurationMs: 0, tool: null, exitCode: 1, identityKnown: true, replayOf: null, targetConflict: false, gapCodes: [] };
const usePage = { outputVersion: 1, action: 'evidence' as const, methodVersion: local.methodVersion, profile: 'local' as const,
  snapshotId: local.readView.snapshotId, scope, totals: knownUseTotals, total: observed(1), nextCursor: null };
test('nonempty canonical object and record pages validate and bind collection object and use method', async () => {
  const objects = { ...usePage, collection: 'use_objects' as const, rows: [useObject] };
  const records = { ...usePage, collection: 'use_records' as const, objectRef, total: observed(3), rows: [useRecord] };
  const objectRequest: TimingRequest = { action: 'evidence', collection: 'use_objects', threadId: 'thread', turnId: 'turn', snapshotId: local.readView.snapshotId };
  const recordRequest: TimingRequest = { ...objectRequest, collection: 'use_records', objectRef };
  assert.equal(await client(objects).timing!(objectRequest), objects);
  assert.equal(await client(records).timing!(recordRequest), records);
  for(const methodVersion of [1,2,4]) await assert.rejects(client({...objects,totals:{...knownUseTotals,methodVersion}}).timing!(objectRequest),{code:'PROTOCOL_ERROR'});
  const declined = { ...records, rows: [{ ...useRecord, outcome: 'declined', exitCode: null }] };
  assert.equal(await client(declined).timing!(recordRequest), declined);
  const conflicting = { ...records, rows: [{ ...useRecord, exitCode: null, gapCodes: ['operation_result_conflict'] }] };
  assert.equal(await client(conflicting).timing!(recordRequest), conflicting);
  const allRecordsRequest: TimingRequest = { ...objectRequest, collection: 'use_records' };
  const { objectRef: _filteredObject, ...unfilteredRecords } = records;
  assert.equal(await client(unfilteredRecords).timing!(allRecordsRequest), unfilteredRecords);
  const nullObjectRecords = { ...unfilteredRecords, objectRef: null };
  assert.equal(await client(nullObjectRecords).timing!(allRecordsRequest), nullObjectRecords);
  await assert.rejects(client(records).timing!(objectRequest), { code: 'PROTOCOL_ERROR' });
  await assert.rejects(client(objects).timing!(recordRequest), { code: 'PROTOCOL_ERROR' });
  for (const invalid of [
    { ...records, objectRef: `use:${'c'.repeat(64)}` },
    { ...records, rows: [{ ...useRecord, objectRef: `use:${'c'.repeat(64)}` }] },
    ...[1, 2, 4, 99].map(methodVersion => ({ ...records, totals: { ...knownUseTotals, methodVersion } })),
    { ...records, rows: Array.from({ length: 201 }, () => useRecord) },
    { ...records, rows: [{ ...useRecord, nativeDurationMs: Number.MAX_SAFE_INTEGER + 1 }] },
    { ...records, rows: [{ ...useRecord, outcome: 'invented_success' }] },
  ]) await assert.rejects(client(invalid).timing!(recordRequest), { code: 'PROTOCOL_ERROR' });
  await assert.rejects(client({ ...objects, rows: Array.from({ length: 201 }, () => useObject) }).timing!(objectRequest), { code: 'PROTOCOL_ERROR' });
  let calls = 0;
  const reader = createUsageClient({ query: async () => null, timing: async () => { calls++; return objects; } });
  for (const invalid of [{ ...objectRequest, objectRef }, { ...recordRequest, objectRef: '/synthetic/skill/SKILL.md' }, { ...recordRequest, privacyProfile: 'share-v1' }])
    await assert.rejects(reader.timing!(invalid as TimingRequest), { code: 'INVALID_ARGUMENT' });
  assert.equal(calls, 0);
});
test('sharing allows numeric use coverage and rejects local object record and cursor fields', async () => {
  const numeric = { ...share, uses: knownUseTotals };
  assert.equal(validateShare(numeric), true);
  assert.equal(await client(numeric).timing!({ ...summary, privacyProfile: 'share-v1' }), numeric);
  for(const methodVersion of [1,2,4]) await assert.rejects(client({...numeric,uses:{...knownUseTotals,methodVersion}}).timing!({...summary,privacyProfile:'share-v1'}),{code:'PROTOCOL_ERROR'});
  for (const fields of [{ objects: [useObject] }, { path: '/synthetic/skill/SKILL.md' }, { server: 'private-service' },
    { nextCursor: { token: 'local-cursor' } }, { rows: [useRecord] }]) {
    const invalid = { ...numeric, uses: { ...knownUseTotals, ...fields } };
    assert.equal(validateShare(invalid), false);
    await assert.rejects(client(invalid).timing!({ ...summary, privacyProfile: 'share-v1' }), { code: 'PROTOCOL_ERROR' });
  }
});

test('work metrics preserve canonical identities, reported paths and unknown user origin in both whitelists', () => {
  const work = {
    ...local.work,
    operationCandidates: { value: 3, status: 'observed', basis: 'canonical_operation_identity', evidenceRefs: [] },
    changedFiles: { value: 2, status: 'derived', basis: 'reported_file_paths', evidenceRefs: [] },
    userBoundaryRecords: { value: null, status: 'unavailable', basis: 'unknown_message_origin', evidenceRefs: [] },
  };
  const quality = { ...local.quality, reasonCodes: ['unknown_message_origin', 'source_partial'] };
  assert.equal(validateLocal({ ...local, work, quality }), true);
  assert.equal(validateShare({ ...share, work, quality }), true);
  for (const value of [-1, 9007199254740992]) {
    assert.equal(validateLocal({ ...local, work: { ...work, changedFiles: { ...work.changedFiles, value } } }), false);
  }
  assert.equal(validateShare({ ...share, work: { ...work, changedFiles: { ...work.changedFiles, paths: ['/private/path'] } } }), false);
  assert.equal(validateLocal({ ...local, work: { ...work, userBoundaryRecords: { ...work.userBoundaryRecords, basis: 'guessed_user' } } }), false);
});
