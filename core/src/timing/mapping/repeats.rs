use super::*;
use crate::timing::repeats as domain;

pub(super) fn map(
    a: &Analysis,
    refs: &[String],
    fallback: Option<Basis>,
    missing: Basis,
) -> RepeatedBehavior {
    use RepeatCoverageReason as Reason;
    let p = &a.repeated_behavior;
    let c = &p.coverage;
    let limit = c.budget_exceeded || fallback == Some(Basis::ResourceLimit);
    let available = p.computed && fallback.is_none() && !limit;
    let missing = if limit { Basis::ResourceLimit } else { missing };
    let measure = |v: Option<u128>, basis| {
        count(
            if available { v } else { None },
            if available && v.is_some() {
                basis
            } else {
                missing
            },
            refs,
        )
    };
    let scalar = |v: usize| measure(Some(v as u128), Basis::CanonicalOperationIdentity);
    let duration = |d: &domain::DurationTotal| RepeatedDuration {
        known_sum_ms: measure(d.sum_ms, Basis::KnownOperationDuration),
        recorded_count: scalar(d.recorded_count),
        calculated_count: scalar(d.calculated_count),
        missing_count: scalar(d.missing_count),
    };
    let metric = |m: &domain::Metric, basis| RepeatedMetric {
        count: measure(m.count.map(|v| v as u128), basis),
        duration: duration(&m.duration),
    };
    let after_failure = metric(&p.after_failure, Basis::RepeatAfterFailure);
    let repeated_read = metric(&p.repeated_read, Basis::SuccessfulReadRepeat);
    let recovery_span_sum_ms = measure(p.recovery_span_sum_ms, Basis::FailureRecoverySpan);
    let combined_union_ms = measure(p.combined_union_ms.map(u128::from), Basis::OperationUnion);
    let numeric = [
        &after_failure.duration.known_sum_ms,
        &repeated_read.duration.known_sum_ms,
        &recovery_span_sum_ms,
        &combined_union_ms,
    ]
    .iter()
    .any(|m| m.basis == Basis::NumericRange);
    let mut reasons = vec![];
    if limit {
        reasons.push(Reason::ResourceLimit);
    }
    if available {
        for (n, reason) in [
            (c.missing_matching, Reason::MissingMatching),
            (c.excluded_receivers, Reason::ExcludedReceivers),
            (c.missing_identity_records, Reason::IdentityGaps),
            (c.conflicting, Reason::ConflictingOperations),
            (c.missing_start, Reason::MissingStart),
            (c.indeterminate_outcomes, Reason::IndeterminateOutcomes),
            (c.order_gaps, Reason::OrderGaps),
            (c.context_resets, Reason::ContextBoundaries),
            (c.crossed_context, Reason::CrossedContext),
            (c.missing_clock_domain, Reason::MissingClockDomain),
            (c.source_metadata_gaps, Reason::SourceMetadataGaps),
            (c.duration_conflicts, Reason::DurationConflicts),
            (
                p.after_failure.duration.missing_count + p.repeated_read.duration.missing_count,
                Reason::MissingDurations,
            ),
            (p.missing_recovery_span_count, Reason::MissingRecoverySpans),
            (p.combined_missing_interval_count, Reason::MissingIntervals),
        ] {
            if n > 0 {
                reasons.push(reason);
            }
        }
        if p.combined_union_ms.is_none() {
            reasons.push(Reason::MissingWindow);
        }
        if a.coverage.partial {
            reasons.push(Reason::SourcePartial);
        }
        if numeric {
            reasons.push(Reason::NumericRange);
        }
    }
    let partial = !available
        || c.partial
        || a.coverage.partial
        || numeric
        || p.combined_union_ms.is_none()
        || p.after_failure.duration.missing_count > 0
        || p.repeated_read.duration.missing_count > 0
        || p.missing_recovery_span_count > 0
        || p.combined_missing_interval_count > 0;
    RepeatedBehavior {
        failure_method: FailureRepeatMethod::SameOperationAfterFailureV1,
        read_method: ReadRepeatMethod::SameTargetReadV1,
        endpoint_method_version: 1,
        support: capability(
            if !available {
                Support::Unavailable
            } else if partial {
                Support::Partial
            } else {
                Support::Supported
            },
            if available {
                Basis::RepeatAfterFailure
            } else {
                missing
            },
        ),
        read_layer: RepeatedReadLayer::SamePathRangeUnconfirmed,
        after_failure,
        repeated_read,
        same_request_observation_count: measure(
            p.same_request_observation_count.map(|v| v as u128),
            Basis::SameRequestObservation,
        ),
        repeated_read_request_count: measure(
            p.repeated_read_request_count.map(|v| v as u128),
            Basis::SameRequestObservation,
        ),
        recovery_span_sum_ms,
        missing_recovery_span_count: scalar(p.missing_recovery_span_count),
        combined_operation_count: measure(
            p.combined_operation_count.map(|v| v as u128),
            Basis::CanonicalOperationIdentity,
        ),
        combined_union_ms,
        combined_missing_interval_count: scalar(p.combined_missing_interval_count),
        coverage: RepeatCoverage {
            candidate_operations: scalar(c.candidates),
            eligible_commands: scalar(c.eligible_commands),
            missing_identity_records: scalar(c.missing_identity_records),
            excluded_receivers: scalar(c.excluded_receivers),
            missing_matching: scalar(c.missing_matching),
            conflicting_operations: scalar(c.conflicting),
            missing_start: scalar(c.missing_start),
            indeterminate_outcomes: scalar(c.indeterminate_outcomes),
            order_gaps: scalar(c.order_gaps),
            context_boundaries: scalar(c.context_resets),
            crossed_context: scalar(c.crossed_context),
            missing_clock_domain: scalar(c.missing_clock_domain),
            source_metadata_gaps: scalar(c.source_metadata_gaps),
            duration_conflicts: scalar(c.duration_conflicts),
            partial,
            reason_codes: reasons,
        },
    }
}
