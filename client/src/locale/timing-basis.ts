/** Localized wording for Rust-owned timing provenance and missing-value bases. */
import type { Basis } from '../generated/timing-local-response.js';
import { t, type MessageKey } from './index.js';

type TimingBasisKey = Extract<MessageKey, `timing.basis.${string}`>;

const methodBasis: Partial<Record<Basis, TimingBasisKey>> = {
  native_record: 'timing.basis.nativeRecord',
  explicit_boundary: 'timing.basis.explicitBoundary',
  lifecycle_union: 'timing.basis.lifecycleUnion',
  lifecycle_sum: 'timing.basis.lifecycleSum',
  interval_mask: 'timing.basis.intervalMask',
  request_input: 'timing.basis.requestInput',
  historical_window: 'timing.basis.historicalWindow',
  type7: 'timing.basis.type7',
  safe_message_record: 'timing.basis.safeMessageRecord',
  safe_message_delay: 'timing.basis.safeMessageDelay',
  safe_event_count: 'timing.basis.safeEventCount',
  response_gap_v1: 'timing.basis.responseGapV1',
  exact_event_page: 'timing.basis.exactEventPage',
  canonical_operation_identity: 'timing.basis.canonicalOperationIdentity',
  reported_file_paths: 'timing.basis.reportedFilePaths',
  canonical_use_identity: 'timing.basis.canonicalUseIdentity',
  canonical_use_records: 'timing.basis.canonicalUseRecords',
  unassigned_use_index: 'timing.basis.unassignedUseIndex',
};

const missingBasis: Partial<Record<Basis, TimingBasisKey>> = {
  not_recorded: 'timing.basis.notRecorded',
  running_turn: 'timing.basis.runningTurn',
  unsupported_method: 'timing.basis.unsupportedMethod',
  missing_repository_baseline: 'timing.basis.missingRepositoryBaseline',
  unknown_message_origin: 'timing.basis.unknownMessageOrigin',
  adapter_not_mapped: 'timing.basis.adapterNotMapped',
  missing_identity: 'timing.basis.missingIdentity',
  missing_time: 'timing.basis.missingTime',
  missing_batch_cycle: 'timing.basis.missingBatchCycle',
  boundary_conflict: 'timing.basis.boundaryConflict',
  source_partial: 'timing.basis.sourcePartial',
  resource_limit: 'timing.basis.resourceLimit',
  numeric_range: 'timing.basis.numericRange',
  no_candidates: 'timing.basis.noCandidates',
  dispatch_not_proven: 'timing.basis.dispatchNotProven',
  missing_target: 'timing.basis.missingTarget',
  missing_turn: 'timing.basis.missingTurn',
};

/** Describes the calculation/provenance basis, and must not stand in for a missing-value cause. */
export function timingBasisText(basis: Basis): string {
  const key = methodBasis[basis] ?? missingBasis[basis];
  return key ? t(key) : t('timing.basis.evidenceInsufficient');
}

/** Describes why this particular measure has no value; positive method bases use a neutral fallback. */
export function timingMissingValueText(basis: Basis): string {
  return missingBasis[basis] ? t(missingBasis[basis]!) : t('timing.basis.evidenceInsufficient');
}

export function timingSourceStatusText(status: string): string {
  switch (status) {
    case 'complete': return t('timing.sourceStatus.complete');
    case 'partial': return t('timing.sourceStatus.partial');
    case 'failed': return t('timing.sourceStatus.failed');
    case 'not_found': return t('timing.sourceStatus.notFound');
    case 'cancelled': return t('timing.sourceStatus.cancelled');
    case 'unknown': return t('timing.sourceStatus.unconfirmed');
    default: return t('timing.sourceStatus.unconfirmed');
  }
}
