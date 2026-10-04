//! Analysis-to-protocol mapping. Every numeric value is checked before transport.
use super::analysis::{Analysis, Issue, State};
use crate::timing_dto::*;

pub(super) fn count(value: Option<u128>, basis: Basis, refs: &[String]) -> Count {
    let valid = value.filter(|value| *value <= u128::from(MAX_SAFE_INTEGER));
    Metric {
        value: valid.map(|value| value as u64),
        status: if valid.is_some() {
            status(basis)
        } else {
            MetricStatus::Unavailable
        },
        basis: if value.is_some() && valid.is_none() {
            Basis::NumericRange
        } else {
            basis
        },
        evidence_refs: refs.to_vec(),
    }
}
pub(super) fn number(value: Option<f64>, basis: Basis, refs: &[String]) -> Number {
    float(value, basis, refs, true)
}
pub(super) fn ratio(value: Option<f64>, basis: Basis, refs: &[String]) -> Number {
    float(value, basis, refs, false)
}
fn float(value: Option<f64>, basis: Basis, refs: &[String], safe_quantity: bool) -> Number {
    let valid = value.filter(|value| {
        value.is_finite()
            && *value >= 0.0
            && (!safe_quantity || value.abs() <= MAX_SAFE_INTEGER as f64)
    });
    Metric {
        value: valid,
        status: if valid.is_some() {
            status(basis)
        } else {
            MetricStatus::Unavailable
        },
        basis: if value.is_some() && valid.is_none() {
            Basis::NumericRange
        } else {
            basis
        },
        evidence_refs: refs.to_vec(),
    }
}
pub(super) fn signed(value: Option<i128>, basis: Basis, refs: &[String]) -> Signed {
    let valid = value.filter(|value| value.unsigned_abs() <= u128::from(MAX_SAFE_INTEGER));
    Metric {
        value: valid.map(|value| value as i64),
        status: if valid.is_some() {
            status(basis)
        } else {
            MetricStatus::Unavailable
        },
        basis: if value.is_some() && valid.is_none() {
            Basis::NumericRange
        } else {
            basis
        },
        evidence_refs: refs.to_vec(),
    }
}
fn status(basis: Basis) -> MetricStatus {
    match basis {
        Basis::NativeRecord
        | Basis::SafeEventCount
        | Basis::RequestInput
        | Basis::SafeMessageRecord => MetricStatus::Observed,
        Basis::ResponseGapV1 => MetricStatus::Proxy,
        _ => MetricStatus::Derived,
    }
}
pub(super) fn unavailable(basis: Basis) -> Count {
    count(None, basis, &[])
}
pub(super) fn observed(value: usize, refs: &[String]) -> Count {
    count(Some(value as u128), Basis::SafeEventCount, refs)
}
pub(super) fn capability(support: Support, reason: Basis) -> Capability {
    Capability { support, reason }
}
pub(super) fn capabilities() -> Capabilities {
    Capabilities {
        wall_clock: capability(Support::Supported, Basis::ExplicitBoundary),
        native_ttft: capability(Support::Partial, Basis::NativeRecord),
        first_content_record_delay: capability(Support::Partial, Basis::SafeMessageRecord),
        lifecycle_intervals: capability(Support::Partial, Basis::LifecycleUnion),
        context_pressure: capability(Support::Partial, Basis::HistoricalWindow),
        strict_response_gap: capability(Support::Unavailable, Basis::MissingBatchCycle),
        exploratory_gap: capability(Support::Unavailable, Basis::UnsupportedMethod),
        command_labels: capability(Support::Unavailable, Basis::AdapterNotMapped),
        file_changes: capability(Support::Unavailable, Basis::AdapterNotMapped),
        message_records: capability(Support::Partial, Basis::SafeMessageRecord),
    }
}
pub(super) fn time(
    a: &Analysis,
    refs: &[String],
    fallback: Option<Basis>,
    boundary: Option<&super::analysis::BoundarySummary>,
) -> Time {
    let boundary_conflict = a
        .issues
        .iter()
        .any(|issue| matches!(issue, Issue::BoundaryConflict | Issue::ReversedBoundary));
    let identity_conflict = a.issues.iter().any(|issue| {
        matches!(
            issue,
            Issue::IdentityConflict(_) | Issue::MissingItemIdentity(_)
        )
    });
    let source_gap = a
        .issues
        .iter()
        .any(|issue| matches!(issue, Issue::SourceGap(_)));
    let missing = fallback.unwrap_or(if boundary_conflict {
        Basis::BoundaryConflict
    } else if identity_conflict {
        Basis::MissingIdentity
    } else if source_gap {
        Basis::SourcePartial
    } else {
        Basis::MissingTime
    });
    let native_missing = if boundary_conflict {
        Basis::BoundaryConflict
    } else {
        fallback.unwrap_or(Basis::NotRecorded)
    };
    let native_duration_missing = boundary.map_or(native_missing, |b| {
        if b.identity_conflict {
            Basis::MissingIdentity
        } else if b.native_duration_conflict {
            Basis::BoundaryConflict
        } else if source_gap {
            Basis::SourcePartial
        } else {
            Basis::NotRecorded
        }
    });
    let native_ttft_missing = boundary.map_or(native_missing, |b| {
        if b.identity_conflict {
            Basis::MissingIdentity
        } else if b.native_ttft_conflict {
            Basis::BoundaryConflict
        } else if source_gap {
            Basis::SourcePartial
        } else {
            Basis::NotRecorded
        }
    });
    let content_missing = fallback.unwrap_or(
        if a.issues
            .iter()
            .any(|issue| matches!(issue, Issue::ContentConflict(_)))
        {
            Basis::BoundaryConflict
        } else if a.issues.iter().any(|issue| {
            matches!(
                issue,
                Issue::MissingContentTime(_) | Issue::MissingBoundaryTime(_)
            )
        }) {
            Basis::MissingTime
        } else if a.issues.iter().any(|issue| {
            matches!(
                issue,
                Issue::UnknownContent(_) | Issue::UnmatchedContentDomain(_) | Issue::SourceGap(_)
            )
        }) {
            Basis::SourcePartial
        } else if boundary_conflict {
            Basis::BoundaryConflict
        } else {
            Basis::NotRecorded
        },
    );
    let category = |index: usize| Category {
        candidates: if fallback.is_some() {
            unavailable(missing)
        } else {
            observed(a.coverage.lifecycle_candidates[index], refs)
        },
        closed: if fallback.is_some() {
            unavailable(missing)
        } else {
            observed(a.coverage.linked_lifecycles[index], refs)
        },
        union_ms: count(
            a.category_union_ms[index].map(u128::from),
            if a.category_union_ms[index].is_some() {
                Basis::LifecycleUnion
            } else if a.coverage.lifecycle_candidates[index] == 0 && fallback.is_none() {
                Basis::NoCandidates
            } else {
                missing
            },
            refs,
        ),
        sum_ms: count(
            (fallback.is_none() && a.category_union_ms[index].is_some())
                .then_some(a.intervals.category_sum_ms[index]),
            if a.category_union_ms[index].is_some() {
                Basis::LifecycleSum
            } else if a.coverage.lifecycle_candidates[index] == 0 && fallback.is_none() {
                Basis::NoCandidates
            } else {
                missing
            },
            refs,
        ),
    };
    let complete =
        fallback.is_none() && a.intervals.observed_window_ms.is_some() && !a.intervals.partial;
    Time {
        state: match a.state {
            State::Running => TurnState::Running,
            State::Completed => TurnState::Completed,
            State::Failed => TurnState::Failed,
            State::Cancelled => TurnState::Cancelled,
            State::Unknown => TurnState::Unknown,
        },
        native_wall_clock_ms: count(
            a.native_wall_clock_ms.map(u128::from),
            if a.native_wall_clock_ms.is_some() {
                Basis::NativeRecord
            } else {
                native_duration_missing
            },
            refs,
        ),
        derived_wall_clock_ms: count(
            a.derived_wall_clock_ms.map(u128::from),
            if a.derived_wall_clock_ms.is_some() {
                Basis::ExplicitBoundary
            } else {
                missing
            },
            refs,
        ),
        native_ttft_ms: count(
            a.native_ttft_ms.map(u128::from),
            if a.native_ttft_ms.is_some() {
                Basis::NativeRecord
            } else {
                native_ttft_missing
            },
            refs,
        ),
        first_content_record_delay_ms: count(
            a.first_content_record_delay_ms.map(u128::from),
            if a.first_content_record_delay_ms.is_some() {
                Basis::SafeMessageDelay
            } else {
                content_missing
            },
            refs,
        ),
        boundary_discrepancy_ms: signed(
            a.boundary_delta_ms,
            if a.boundary_delta_ms.is_some() {
                Basis::ExplicitBoundary
            } else {
                missing
            },
            refs,
        ),
        observed_window_ms: count(
            a.intervals.observed_window_ms.map(u128::from),
            if a.intervals.observed_window_ms.is_some() {
                Basis::ExplicitBoundary
            } else {
                missing
            },
            refs,
        ),
        command: category(0),
        compaction: category(1),
        reasoning: category(2),
        intersection_masks_ms: a
            .intervals
            .mask_ms
            .iter()
            .map(|value| {
                count(
                    complete.then_some(u128::from(*value)),
                    if complete {
                        Basis::IntervalMask
                    } else {
                        missing
                    },
                    refs,
                )
            })
            .collect(),
        covered_ms: count(
            a.intervals.covered_ms.map(u128::from),
            if a.intervals.covered_ms.is_some() {
                Basis::LifecycleUnion
            } else {
                missing
            },
            refs,
        ),
        unclassified_ms: count(
            a.intervals.unclassified_ms.map(u128::from),
            if a.intervals.unclassified_ms.is_some() {
                Basis::IntervalMask
            } else {
                missing
            },
            refs,
        ),
        coverage_ratio: ratio(
            a.intervals.coverage_ratio,
            if a.intervals.coverage_ratio.is_some() {
                Basis::IntervalMask
            } else {
                missing
            },
            refs,
        ),
        waiting_proxy_ms: unavailable(Basis::MissingBatchCycle),
        strict_response_gap_ms: unavailable(Basis::MissingBatchCycle),
        exploratory_gap_ms: unavailable(Basis::UnsupportedMethod),
    }
}
fn distribution(
    d: Option<&super::context::Distribution>,
    ratio: bool,
    refs: &[String],
    missing: Basis,
) -> Distribution {
    let value = if ratio { self::ratio } else { number };
    Distribution {
        samples: d.map_or_else(|| unavailable(missing), |d| observed(d.samples, refs)),
        median: value(
            d.and_then(|d| d.median),
            if d.is_some_and(|d| d.samples > 0) {
                Basis::Type7
            } else {
                missing
            },
            refs,
        ),
        p90: value(
            d.and_then(|d| d.p90),
            if d.is_some_and(|d| d.samples > 0) {
                Basis::Type7
            } else if ratio {
                Basis::HistoricalWindow
            } else {
                missing
            },
            refs,
        ),
    }
}
pub(super) fn context(a: &Analysis, refs: &[String], fallback: Option<Basis>) -> Context {
    let missing = fallback.unwrap_or(Basis::NoCandidates);
    let c = a.context.as_ref();
    let details_fit = c.is_some_and(|c| {
        c.segments.len() <= 32
            && c.compactions.len() <= 32
            && c.segments.iter().all(|s| s.id.len() <= 4096)
            && c.compactions.iter().all(|n| {
                n.segment_id.len() <= 4096
                    && n.event_id.len() <= 4096
                    && n.before
                        .as_ref()
                        .is_none_or(|n| n.measurement_id.len() <= 4096)
                    && n.after
                        .as_ref()
                        .is_none_or(|n| n.measurement_id.len() <= 4096)
            })
    });
    let segment = |s: &super::context::Segment| Segment {
        id: s.id.clone(),
        candidates: observed(s.candidates, refs),
        non_request_scoped: observed(s.non_request_scoped, refs),
        missing_raw_input: observed(s.missing_raw_input, refs),
        missing_window: observed(s.missing_window, refs),
        invalid_window: observed(s.invalid_window, refs),
        same_record_windows: observed(s.same_record_windows, refs),
        continued_windows: observed(s.continued_windows, refs),
        above_window: observed(s.above_window, refs),
        input: distribution(Some(&s.input), false, refs, missing),
        ratio: distribution(Some(&s.ratio), true, refs, missing),
    };
    let neighbor = |n: &super::context::Neighbor| Neighbor {
        measurement_ref: format!("measurement:{}", n.measurement_id),
        raw_input: count(Some(u128::from(n.raw_input)), Basis::RequestInput, refs),
        ratio: ratio(n.ratio, Basis::HistoricalWindow, refs),
        distance_ms: count(
            Some(u128::from(n.distance_ms)),
            Basis::ExplicitBoundary,
            refs,
        ),
    };
    Context {
        active_context_occupancy: number(None, Basis::NotRecorded, &[]),
        compaction_records: if fallback.is_some() {
            unavailable(missing)
        } else {
            observed(a.coverage.lifecycle_candidates[1], refs)
        },
        compaction_time_ms: count(
            a.category_union_ms[1].map(u128::from),
            if a.category_union_ms[1].is_some() {
                Basis::LifecycleUnion
            } else {
                missing
            },
            refs,
        ),
        method: super::context::METHOD.into(),
        quantile_method: super::context::QUANTILE_METHOD.into(),
        candidates: c.map_or_else(|| unavailable(missing), |c| observed(c.candidates, refs)),
        conflicting_measurements: c.map_or_else(
            || unavailable(missing),
            |c| observed(c.conflicting_measurements, refs),
        ),
        conflicting_window_records: c.map_or_else(
            || unavailable(missing),
            |c| observed(c.conflicting_window_records, refs),
        ),
        input: distribution(c.map(|c| &c.input), false, refs, missing),
        ratio: distribution(c.map(|c| &c.ratio), true, refs, missing),
        segment_count: c.map_or_else(
            || unavailable(missing),
            |c| observed(c.segments.len(), refs),
        ),
        segments: c
            .filter(|_| details_fit)
            .map_or_else(Vec::new, |c| c.segments.iter().map(segment).collect()),
        compaction_neighbors: c.filter(|_| details_fit).map_or_else(Vec::new, |c| {
            c.compactions
                .iter()
                .map(|n| CompactionNeighbors {
                    evidence_ref: format!("event:{}", n.event_id),
                    segment_id: n.segment_id.clone(),
                    before: n.before.as_ref().map(&neighbor),
                    after: n.after.as_ref().map(&neighbor),
                })
                .collect()
        }),
        detail: capability(
            if details_fit {
                Support::Supported
            } else {
                Support::Unavailable
            },
            if details_fit {
                Basis::HistoricalWindow
            } else if c.is_some() {
                Basis::ResourceLimit
            } else {
                missing
            },
        ),
    }
}
pub(super) fn work(a: &Analysis, refs: &[String], fallback: Option<Basis>) -> Work {
    let marker = |value| fallback.map_or_else(|| observed(value, refs), unavailable);
    Work {
        operation_candidates: unavailable(Basis::AdapterNotMapped),
        closed_operations: unavailable(Basis::AdapterNotMapped),
        failed_operations: unavailable(Basis::AdapterNotMapped),
        labelled_command_ms: unavailable(Basis::AdapterNotMapped),
        file_change_records: unavailable(Basis::AdapterNotMapped),
        changed_files: unavailable(Basis::AdapterNotMapped),
        added_lines: unavailable(Basis::AdapterNotMapped),
        removed_lines: unavailable(Basis::AdapterNotMapped),
        message_record_candidates: marker(a.coverage.content_candidates),
        nonempty_visible_content_records: marker(a.coverage.nonempty_content_records),
        unknown_content_records: marker(a.coverage.unknown_content_records),
        missing_content_time_records: marker(a.coverage.missing_content_time_records),
        user_boundary_records: unavailable(Basis::AdapterNotMapped),
        injected_context_records: unavailable(Basis::AdapterNotMapped),
        reasoning_message_records: unavailable(Basis::AdapterNotMapped),
        compaction_records: marker(a.coverage.lifecycle_candidates[1]),
        repository_baseline: capability(Support::Unavailable, Basis::MissingRepositoryBaseline),
    }
}
