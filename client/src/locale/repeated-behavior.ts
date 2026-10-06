/** Copy for core-owned coverage codes; no matching logic. */
import type {RepeatCoverageReason} from '../generated/timing-local-response.js';
import {t,type MessageKey} from './index.js';
const keys={
  missing_matching: 'execution.repeats.reason.missing_matching',
  excluded_receivers: 'execution.repeats.reason.excluded_receivers',
  identity_gaps: 'execution.repeats.reason.identity_gaps',
  conflicting_operations: 'execution.repeats.reason.conflicting_operations',
  missing_start: 'execution.repeats.reason.missing_start',
  indeterminate_outcomes: 'execution.repeats.reason.indeterminate_outcomes',
  order_gaps: 'execution.repeats.reason.order_gaps',
  context_boundaries: 'execution.repeats.reason.context_boundaries',
  crossed_context: 'execution.repeats.reason.crossed_context',
  missing_clock_domain: 'execution.repeats.reason.missing_clock_domain',
  source_metadata_gaps: 'execution.repeats.reason.source_metadata_gaps',
  duration_conflicts: 'execution.repeats.reason.duration_conflicts',
  missing_durations: 'execution.repeats.reason.missing_durations',
  missing_recovery_spans: 'execution.repeats.reason.missing_recovery_spans',
  missing_intervals: 'execution.repeats.reason.missing_intervals',
  missing_window: 'execution.repeats.reason.missing_window',
  source_partial: 'execution.repeats.reason.source_partial',
  resource_limit: 'execution.repeats.reason.resource_limit',
  numeric_range: 'execution.repeats.reason.numeric_range',
} as const satisfies Record<RepeatCoverageReason,MessageKey>;
export function repeatedBehaviorReasonText(reason:RepeatCoverageReason):string{return t(keys[reason]);}
