import {
  CoreError,
  type TimingLocalResult,
  type TimingShareResult,
  type TimingRequest,
  type TimingResult,
} from '@wombat/client';
export const useRefs = {
  skill: `use:${'1'.repeat(64)}`,
  mcp: `use:${'2'.repeat(64)}`,
  candidate: `use:${'3'.repeat(64)}`,
  unclassified: `use:${'4'.repeat(64)}`,
} as const;
type Objects = TimingLocalResult['uses']['objects'];
type Records = Extract<TimingResult, { action: 'evidence'; collection: 'use_records' }>['rows'];
type Count = Objects[number]['useCount'];
const known = (value: number): Count => ({
  value,
  status: 'observed',
  basis: 'canonical_use_records',
  evidenceRefs: [],
});
const unknown = (basis: Count['basis'] = 'missing_turn'): Count => ({
  value: null,
  status: 'unavailable',
  basis,
  evidenceRefs: [],
});
const associated = (value: number): Count => ({
  value,
  status: 'observed',
  basis: 'canonical_use_identity',
  evidenceRefs: [],
});
const gaps = () => ({
  dispatchGaps: known(0),
  identityGaps: known(0),
  targetGaps: known(0),
  timeGaps: known(0),
  associatedTurnGaps: known(0),
});
const binding = (local: TimingLocalResult, collection: string, objectRef?: string) => [
  local.readView.snapshotId,
  local.scope.sourceInstanceId,
  local.scope.threadId,
  local.scope.turnId,
  collection,
  objectRef ?? null,
];
function cursor(local: TimingLocalResult, collection: string, offset: number, objectRef?: string) {
  return { token: btoa(JSON.stringify([...binding(local, collection, objectRef), offset])) };
}
/** Synthetic fixed-page tokens bind the same public identities; no source or operation parser. */
function offset(local: TimingLocalResult, request: Extract<TimingRequest, { action: 'evidence' }>) {
  if (!request.cursor) return 0;
  try {
    const parsed = JSON.parse(atob(request.cursor.token));
    if (
      !Array.isArray(parsed) ||
      JSON.stringify(parsed.slice(0, 6)) !==
        JSON.stringify(
          binding(local, request.collection ?? 'turn_events', request.objectRef ?? undefined),
        ) ||
      parsed.length !== 7 ||
      !Number.isSafeInteger(parsed[6]) ||
      parsed[6] < 0
    )
      throw new Error('Invalid cursor');
    return parsed[6] as number;
  } catch {
    throw new CoreError(
      'INVALID_CURSOR',
      'Synthetic use cursor does not match this view and target',
    );
  }
}
function facts(scenario: string): { objects: Objects; records: Records } {
  const objects: Objects =
    scenario === 'empty'
      ? []
      : [
          {
            objectRef: useRefs.skill,
            kind: 'skill',
            state: 'used',
            path: '/synthetic/wombat/skills/review/SKILL.md',
            server: null,
            project: null,
            useCount: associated(3),
            associatedUseCount: associated(3),
            recordCount: known(4),
            unassignedTurnRecords: known(0),
            coverage: gaps(),
          },
          {
            objectRef: useRefs.mcp,
            kind: 'mcp',
            state: 'used',
            path: null,
            server: 'synthetic-tools',
            project: '/synthetic/wombat',
            useCount: unknown('missing_turn'),
            associatedUseCount: associated(2),
            recordCount: known(3),
            unassignedTurnRecords: known(1),
            coverage: { ...gaps(), targetGaps: known(1) },
          },
          {
            objectRef: useRefs.candidate,
            kind: 'skill',
            state: 'candidate',
            path: '/synthetic/wombat/skills/candidate/SKILL.md',
            server: null,
            project: null,
            useCount: unknown('dispatch_not_proven'),
            associatedUseCount: associated(0),
            recordCount: known(1),
            unassignedTurnRecords: known(0),
            coverage: { ...gaps(), dispatchGaps: known(1) },
          },
          {
            objectRef: useRefs.unclassified,
            kind: 'mcp',
            state: 'unclassified',
            path: null,
            server: 'synthetic-unknown',
            project: null,
            useCount: unknown('dispatch_not_proven'),
            associatedUseCount: associated(0),
            recordCount: known(1),
            unassignedTurnRecords: known(0),
            coverage: { ...gaps(), dispatchGaps: known(1), targetGaps: known(1) },
          },
        ];
  if (scenario === 'dense')
    for (let index = 4; index < 53; index++)
      objects.push({
        ...structuredClone(objects[0]),
        objectRef: `use:${index.toString(16).padStart(64, '0')}`,
        path: `/synthetic/wombat/skills/item-${index}/SKILL.md`,
        useCount: associated(1),
        associatedUseCount: associated(1),
        recordCount: known(1),
      });
  const record = (reference: string, objectRef: string): Records[number] => ({
    reference,
    objectRef,
    kind: objectRef === useRefs.mcp ? 'mcp_tool' : 'skill_read',
    state: 'used',
    outcome: 'completed',
    timestampMs: 1791079200000,
    timeBasis: 'source_operation_time',
    nativeDurationMs: 0,
    tool: objectRef === useRefs.mcp ? 'synthetic_lookup' : null,
    exitCode: 0,
    identityKnown: true,
    replayOf: null,
    targetConflict: false,
    gapCodes: [],
  });
  const records: Records =
    scenario === 'empty'
      ? []
      : [
          record('use:skill-1', useRefs.skill),
          { ...record('use:skill-2', useRefs.skill), outcome: 'failed', exitCode: 2 },
          {
            ...record('use:skill-3', useRefs.skill),
            outcome: scenario === 'running' ? 'running' : 'completed',
            nativeDurationMs: scenario === 'running' ? null : 5,
          },
          { ...record('use:skill-replay', useRefs.skill), replayOf: 'use:skill-1' },
          record('use:mcp-1', useRefs.mcp),
          { ...record('use:mcp-2', useRefs.mcp), kind: 'mcp_resource' },
          { ...record('use:mcp-replay', useRefs.mcp), replayOf: 'use:mcp-1' },
          {
            ...record('use:candidate', useRefs.candidate),
            state: 'candidate',
            outcome: 'unknown',
            nativeDurationMs: null,
            exitCode: null,
            gapCodes: ['dispatch_not_proven'],
          },
          {
            ...record('use:unclassified', useRefs.unclassified),
            kind: null,
            state: 'unclassified',
            outcome: 'unknown',
            nativeDurationMs: null,
            exitCode: null,
            targetConflict: false,
            gapCodes: ['missing_target', 'dispatch_not_proven'],
          },
        ];
  if (scenario === 'dense') {
    objects
      .slice(4)
      .forEach((object) => records.push(record(`use:${object.objectRef}`, object.objectRef)));
    for (let index = 0; index < 210; index++)
      records.push(record(`use:dense-repeat-${index}`, useRefs.skill));
    objects[0].useCount = associated(213);
    objects[0].associatedUseCount = associated(213);
    objects[0].recordCount = known(214);
  }
  return { objects, records };
}
export function usesFixture(local: TimingLocalResult, scenario: string): TimingLocalResult['uses'] {
  if (scenario === 'missing')
    return {
      totals: {
        methodVersion: 3,
        sourceCoverage: 'unknown',
        objectCount: unknown(),
        recordCount: unknown(),
        unboundTargetRecords: unknown(),
        unassignedSkillRecords: unknown(),
        unassignedMcpRecords: unknown(),
        coverage: {
          dispatchGaps: unknown(),
          identityGaps: unknown(),
          targetGaps: unknown(),
          timeGaps: unknown(),
          associatedTurnGaps: unknown(),
        },
      },
      detail: { support: 'unavailable', reason: 'not_recorded' },
      limit: 50,
      objects: [],
      nextCursor: null,
    };
  const { objects, records } = facts(scenario);
  return {
    totals: {
      methodVersion: 3,
      sourceCoverage: 'complete',
      objectCount: known(objects.length),
      recordCount: known(records.length),
      unboundTargetRecords: known(0),
      unassignedSkillRecords: known(0),
      unassignedMcpRecords: known(scenario === 'empty' ? 0 : 1),
      coverage: {
        ...gaps(),
        dispatchGaps: known(scenario === 'empty' ? 0 : 2),
        timeGaps: known(0),
        targetGaps: known(scenario === 'empty' ? 0 : 1),
      },
    },
    detail: { support: 'supported', reason: 'canonical_use_records' },
    limit: 50,
    objects: objects.slice(0, 50),
    nextCursor: objects.length > 50 ? cursor(local, 'use_objects', 50) : null,
  };
}
export function shareUsesFixture(local: TimingLocalResult): TimingShareResult['uses'] {
  return structuredClone(local.uses.totals);
}
export function usesEvidence(
  local: TimingLocalResult,
  scenario: string,
  request: Extract<TimingRequest, { action: 'evidence' }>,
): Extract<TimingResult, { action: 'evidence'; collection: 'use_objects' | 'use_records' }> {
  if (scenario === 'uses-failure')
    throw new CoreError('SOURCE_UNREADABLE', 'Synthetic use page failed');
  if (scenario === 'uses-expired')
    throw new CoreError('VIEW_EXPIRED', 'Synthetic fixed view expired');
  if (local.uses.detail.support === 'unavailable')
    throw new CoreError('TIMING_DETAIL_UNAVAILABLE', 'Synthetic use evidence unavailable');
  const { objects, records } = facts(scenario),
    start = offset(local, request),
    limit = request.limit ?? 50;
  const common = {
    outputVersion: 6 as const,
    action: 'evidence' as const,
    profile: 'local' as const,
    methodVersion: local.methodVersion,
    snapshotId: local.readView.snapshotId,
    scope: local.scope,
    totals: structuredClone(local.uses.totals),
  };
  if (request.collection === 'use_objects')
    return {
      ...common,
      collection: 'use_objects',
      total: known(objects.length),
      rows: objects.slice(start, start + limit),
      nextCursor:
        start + limit < objects.length ? cursor(local, 'use_objects', start + limit) : null,
    };
  const filtered = request.objectRef
    ? records.filter((record) => record.objectRef === request.objectRef)
    : records;
  if (request.objectRef && !objects.some((object) => object.objectRef === request.objectRef))
    throw new CoreError('NOT_FOUND', 'Synthetic use object not found');
  return {
    ...common,
    collection: 'use_records',
    objectRef: request.objectRef ?? null,
    total: known(filtered.length),
    rows: filtered.slice(start, start + limit),
    nextCursor:
      start + limit < filtered.length
        ? cursor(local, 'use_records', start + limit, request.objectRef ?? undefined)
        : null,
  };
}
