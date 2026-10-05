/** Synthetic fixed facts using the public contract; no projection is performed in views. */
import type { ConfigRequest } from '@wombat/client';
import type { PublicUseBasis } from '@wombat/client/locale';
export function syntheticUseBasis(unit: PublicUseBasis['unit'], status: PublicUseBasis['status'] = 'observed', scope: ConfigRequest['scope'] = {}): PublicUseBasis {
  return { methodVersion: 2, status, unit, capturedAt: '2026-10-04T02:00:00Z', snapshotId: 'preview:1', scope: { sourceInstanceIds: [scope?.sourceInstanceId ?? 'preview'], project: scope?.project ?? null, threadId: scope?.threadId ?? null, agentKind: scope?.agentKind ?? null, window: scope?.allTime ? { kind: 'all_history' } : { kind: 'date_window', since: scope?.since ?? '2026-09-05', until: scope?.until ?? '2026-10-05', timezone: scope?.timezone ?? 'UTC' } }, timeBasis: 'source_operation_time', coverage: status === 'unavailable' ? { dispatchGaps: null, identityGaps: null, targetGaps: null, timeGaps: null, turnGaps: null } : { dispatchGaps: 0, identityGaps: 0, targetGaps: status === 'unknown' ? 1 : 0, timeGaps: 0, turnGaps: 0 }, sourceCompleteness: status === 'observed' ? 'complete' : status === 'unknown' ? 'partial' : 'unknown' };
}
export function syntheticFollowUp(unknown = false): import('@wombat/client').OptimizeResult['followUps'][number] {
  const after = '2026-10-04T01:00:00Z', through = '2026-10-04T02:00:00Z';
  const basis = syntheticUseBasis('object_use', unknown ? 'unknown' : 'observed');
  basis.scope.window = { kind: 'follow_up', after, through };
  return { recordId: 'synthetic-reviewed-record', suggestionId: 'synthetic-reviewed-suggestion', status: unknown ? 'unavailable' : 'version_unknown', after, observedAt: through, observedRecords: unknown ? null : 1, lastRecordAt: unknown ? null : '2026-10-04T01:30:00Z', usageRevision: 'preview:1', absenceObservable: false, useBasis: basis };
}
