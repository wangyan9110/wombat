//! Analysis-to-protocol mapping. Every numeric value is checked before transport.
use super::analysis::{Analysis, Issue, State};
use crate::timing_dto::*;
mod repeats;

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
        | Basis::SafeMessageRecord
        | Basis::CanonicalOperationIdentity
        | Basis::CanonicalUseIdentity
        | Basis::CanonicalUseRecords
        | Basis::UnassignedUseIndex => MetricStatus::Observed,
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
        operation_intervals: capability(Support::Partial, Basis::OperationUnion),
        context_pressure: capability(Support::Partial, Basis::HistoricalWindow),
        strict_response_gap: capability(Support::Unavailable, Basis::MissingBatchCycle),
        exploratory_gap: capability(Support::Unavailable, Basis::UnsupportedMethod),
        command_labels: capability(Support::Unavailable, Basis::UnsupportedMethod),
        file_changes: capability(Support::Partial, Basis::ReportedFilePaths),
        message_records: capability(Support::Partial, Basis::SafeMessageRecord),
        object_uses: capability(Support::Partial, Basis::CanonicalUseIdentity),
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
        repeated_behavior: repeats::map(a, refs, fallback, missing),
        operation_coverage: operation_coverage(a, refs, fallback, missing),
        timeline: timeline(a, refs, fallback, missing),
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
        mcp: category(3),
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
fn timeline(a: &Analysis, refs: &[String], fallback: Option<Basis>, missing: Basis) -> Timeline {
    let t = &a.intervals.timeline;
    let anchored = a.intervals.observed_window_ms.is_some() && a.state != State::Running;
    let resource = fallback.is_some()
        || t.limited
        || a.intervals
            .issues
            .contains(&super::intervals::Issue::ResourceLimit)
        || t.tracks
            .iter()
            .any(|track| track.evidence_ids.iter().any(|id| id.len() > 4096));
    let numeric = anchored
        && a.intervals
            .observed_window_ms
            .is_some_and(|n| n > MAX_SAFE_INTEGER);
    let unlocated = t.unlocated_count + a.coverage.conflicting_lifecycles;
    let identified = t.track_count + t.outside_count + unlocated;
    let majority_unlocated = unlocated > identified / 2;
    let reason = if resource {
        fallback.unwrap_or(Basis::ResourceLimit)
    } else if numeric {
        Basis::NumericRange
    } else if a.state == State::Running {
        Basis::RunningTurn
    } else if !anchored || majority_unlocated {
        missing
    } else if a.coverage.partial || unlocated > 0 {
        Basis::SourcePartial
    } else {
        Basis::LifecycleUnion
    };
    let available = anchored && !resource && !numeric;
    let known = fallback.is_none()
        && !a
            .intervals
            .issues
            .contains(&super::intervals::Issue::ResourceLimit);
    let count_missing = if !known {
        fallback.unwrap_or(Basis::ResourceLimit)
    } else if a.state == State::Running {
        Basis::RunningTurn
    } else {
        missing
    };
    let n = |value| {
        if known && anchored {
            count(Some(value as u128), Basis::LifecycleUnion, refs)
        } else {
            unavailable(count_missing)
        }
    };
    let identity_n = |value| {
        if known {
            count(Some(value as u128), Basis::LifecycleUnion, refs)
        } else {
            unavailable(count_missing)
        }
    };
    Timeline {
        presentation: if available && !majority_unlocated {
            TimelinePresentation::Timeline
        } else {
            TimelinePresentation::List
        },
        detail: capability(
            if available {
                if reason == Basis::LifecycleUnion {
                    Support::Supported
                } else {
                    Support::Partial
                }
            } else {
                Support::Unavailable
            },
            reason,
        ),
        entry_count: n(t.track_count + t.gap_count),
        track_count: n(t.track_count),
        identified_interval_count: identity_n(identified),
        unclassified_gap_count: n(t.gap_count),
        unlocated_interval_count: identity_n(unlocated),
        outside_window_interval_count: n(t.outside_count),
        detail_limit: super::intervals::DETAIL_LIMIT,
        tracks: if available {
            t.tracks
                .iter()
                .map(|track| TimelineTrack {
                    interval_alias: track.alias.clone(),
                    category: match track.category {
                        super::intervals::Category::Command => TrackCategory::Command,
                        super::intervals::Category::Compaction => TrackCategory::Compaction,
                        super::intervals::Category::Reasoning => TrackCategory::Reasoning,
                        super::intervals::Category::Mcp => TrackCategory::Mcp,
                    },
                    start_ms: track.start_ms,
                    end_ms: track.end_ms,
                    clipped: track.clipped,
                    evidence_scope: if track.evidence_ids.is_empty() {
                        FragmentEvidence::Unavailable
                    } else {
                        FragmentEvidence::EventRecords
                    },
                    evidence_refs: track
                        .evidence_ids
                        .iter()
                        .map(|id| format!("event:{id}"))
                        .collect(),
                })
                .collect()
        } else {
            vec![]
        },
        unclassified_gaps: if available {
            t.gaps
                .iter()
                .map(|(start, end)| TimelineGap {
                    start_ms: *start,
                    end_ms: *end,
                    evidence_scope: FragmentEvidence::TurnCollection,
                    evidence_refs: refs.to_vec(),
                })
                .collect()
        } else {
            vec![]
        },
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
pub(super) fn work_gap(gap: super::work::Gap) -> Basis {
    use super::work::Gap;
    match gap {
        Gap::MissingIdentity => Basis::MissingIdentity,
        Gap::CanonicalConflict => Basis::BoundaryConflict,
        Gap::UnknownOutcome | Gap::NonTerminalFile => Basis::NotRecorded,
        Gap::UnknownOperationKind | Gap::MissingWorkMetadata => Basis::AdapterNotMapped,
        Gap::InvalidFileMetadata => Basis::SourcePartial,
        Gap::MissingChanges => Basis::NotRecorded,
        Gap::ResourceLimit => Basis::ResourceLimit,
        Gap::MissingPathScope => Basis::MissingTarget,
    }
}
fn work_count(metric: &super::work::Count, refs: &[String]) -> Count {
    let basis = if metric.value.is_none() {
        metric
            .gaps
            .first()
            .copied()
            .map_or(Basis::NotRecorded, work_gap)
    } else {
        match metric.basis {
            super::work::Basis::ReportedPathUnion => Basis::ReportedFilePaths,
            _ => Basis::CanonicalOperationIdentity,
        }
    };
    count(metric.value.map(u128::from), basis, refs)
}
pub(super) fn work(
    a: &Analysis,
    refs: &[String],
    operation_refs: &[String],
    projection: Option<&super::work::Projection>,
    fallback: Option<Basis>,
    work_fallback: Option<Basis>,
) -> Work {
    let message_fallback = fallback.or_else(|| {
        a.issues
            .iter()
            .any(|i| matches!(i, Issue::ResourceLimit))
            .then_some(Basis::ResourceLimit)
    });
    let marker = |value| message_fallback.map_or_else(|| observed(value, refs), unavailable);
    let operation = |f: fn(&super::work::Projection) -> &super::work::Count| {
        projection.map_or_else(
            || {
                unavailable(
                    work_fallback
                        .or(fallback)
                        .unwrap_or(Basis::AdapterNotMapped),
                )
            },
            |p| work_count(f(p), operation_refs),
        )
    };
    Work {
        operation_candidates: operation(|p| &p.operation_candidates),
        closed_operations: operation(|p| &p.closed_operations),
        failed_operations: operation(|p| &p.failed_operations),
        labelled_command_ms: unavailable(Basis::UnsupportedMethod),
        file_change_records: operation(|p| &p.file_change_records),
        changed_files: operation(|p| &p.changed_files),
        added_lines: unavailable(Basis::MissingRepositoryBaseline),
        removed_lines: unavailable(Basis::MissingRepositoryBaseline),
        message_record_candidates: marker(a.coverage.content_candidates),
        nonempty_visible_content_records: marker(a.coverage.nonempty_content_records),
        unknown_content_records: marker(a.coverage.unknown_content_records),
        missing_content_time_records: marker(a.coverage.missing_content_time_records),
        user_boundary_records: if message_fallback.is_none()
            && a.coverage.unclassified_user_records > 0
        {
            count(None, Basis::UnknownMessageOrigin, refs)
        } else {
            marker(a.coverage.user_input_records)
        },
        injected_context_records: marker(a.coverage.injected_context_records),
        reasoning_message_records: marker(a.coverage.reasoning_message_records),
        compaction_records: marker(a.coverage.lifecycle_candidates[1]),
        repository_baseline: capability(Support::Unavailable, Basis::MissingRepositoryBaseline),
    }
}

fn operation_coverage(
    a: &Analysis,
    refs: &[String],
    fallback: Option<Basis>,
    missing: Basis,
) -> OperationCoverage {
    use OperationCoverageReason as Reason;
    let c = &a.operation_coverage;
    let available = c.computed && fallback.is_none();
    let limit = fallback == Some(Basis::ResourceLimit) || c.budget_exceeded;
    let missing = if limit { Basis::ResourceLimit } else { missing };
    let scalar = |value: usize, basis| {
        if available {
            count(Some(value as u128), basis, refs)
        } else {
            unavailable(missing)
        }
    };
    let duration = |value: Option<u64>, basis| {
        count(
            available.then_some(value).flatten().map(u128::from),
            if available && value.is_some() {
                basis
            } else {
                missing
            },
            refs,
        )
    };
    let covered_ms = duration(c.covered_ms, Basis::OperationUnion);
    let residual_ms = duration(c.residual_ms, Basis::OperationResidual);
    let numeric = available
        && (covered_ms.basis == Basis::NumericRange
            || residual_ms.basis == Basis::NumericRange
            || a.derived_wall_clock_ms
                .is_some_and(|value| value > MAX_SAFE_INTEGER));
    let detail_reason = if limit {
        Basis::ResourceLimit
    } else if numeric {
        Basis::NumericRange
    } else if !available || c.residual_ms.is_none() {
        missing
    } else if c.detail_limited {
        Basis::ResourceLimit
    } else {
        Basis::OperationResidual
    };
    let detail_available =
        available && c.residual_ms.is_some() && !limit && !numeric && !c.detail_limited;
    let mut reason_codes = vec![];
    if limit {
        reason_codes.push(Reason::ResourceLimit);
    }
    if available {
        if c.paired == 0 {
            reason_codes.push(Reason::NoPairedOperations);
        }
        if c.residual_ms.is_none() && !limit {
            reason_codes.push(Reason::MissingWindow);
        }
        if c.missing_identity > 0 {
            reason_codes.push(Reason::IdentityGaps);
        }
        if c.conflicting > 0 {
            reason_codes.push(Reason::ConflictingOperations);
        }
        if c.candidates.saturating_sub(c.paired) > c.conflicting {
            reason_codes.push(Reason::UnlocatedOperations);
        }
        if a.coverage.partial {
            reason_codes.push(Reason::SourcePartial);
        }
        if numeric {
            reason_codes.push(Reason::NumericRange);
        }
        if c.detail_limited {
            reason_codes.push(Reason::DetailLimit);
        }
    }
    OperationCoverage {
        method_version: c.method_version,
        endpoint_method_version: c.endpoint_method_version,
        candidate_operations: scalar(c.candidates, Basis::CanonicalOperationIdentity),
        paired_operations: scalar(c.paired, Basis::ExplicitBoundary),
        identity_gap_records: scalar(c.missing_identity, Basis::SafeEventCount),
        conflicting_operations: scalar(c.conflicting, Basis::CanonicalOperationIdentity),
        covered_ms,
        residual_ms,
        residual_range_count: if available && c.residual_ms.is_some() {
            scalar(c.residual_range_count, Basis::OperationResidual)
        } else {
            unavailable(missing)
        },
        partial: !available || c.partial || c.residual_ms.is_none() || numeric,
        reason_codes,
        detail: capability(
            if detail_available {
                Support::Supported
            } else {
                Support::Unavailable
            },
            detail_reason,
        ),
        detail_limit: super::intervals::DETAIL_LIMIT,
        residual_ranges: if detail_available {
            c.residual_ranges
                .iter()
                .map(|&(start_ms, end_ms)| OperationResidualRange { start_ms, end_ms })
                .collect()
        } else {
            vec![]
        },
    }
}
