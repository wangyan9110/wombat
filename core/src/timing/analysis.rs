//! Safe-event mapping for a single explicit turn; no source bodies or time-based identity guesses.
use super::{context, intervals};
use crate::adapters::contract::Measurement;
use crate::session_events::{Event, Gap, ItemKind, LifecycleKind, Payload, Phase, Precision};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// Canonical measurements are the reconciled accounting projection, never raw event copies.
pub struct AnalyzeInput<'a> {
    pub source: &'a str,
    pub thread: &'a str,
    pub turn: &'a str,
    pub measurements: &'a [Arc<Measurement>],
    pub events: &'a [Arc<Event>],
    pub budget: Budget,
}

#[derive(Clone, Copy, Debug)]
pub struct Budget {
    pub events: usize,
    pub measurements: usize,
    pub lifecycle_records: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum State {
    Running,
    Completed,
    Failed,
    Cancelled,
    Unknown,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Anchor {
    pub timestamp_ms: i64,
    pub precision: Precision,
}

#[derive(Debug, Eq, PartialEq)]
pub enum Issue {
    InvalidScope,
    ResourceLimit,
    SourceGap(String),
    IdentityConflict(String),
    BoundaryConflict,
    MissingBoundaryTime(String),
    MissingItemIdentity(String),
    MissingItemTime(String),
    ReversedBoundary,
    UnmatchedClockDomain(String),
}

#[derive(Debug, Default, Eq, PartialEq)]
pub struct Coverage {
    pub supplied_events: usize,
    pub supplied_measurements: usize,
    pub scoped_events: usize,
    pub scoped_measurements: usize,
    pub unassigned_events: usize,
    pub outside_events: usize,
    pub outside_measurements: usize,
    pub boundary_candidates: usize,
    pub lifecycle_candidates: [usize; 3],
    pub linked_lifecycles: [usize; 3],
    pub conflicting_lifecycles: usize,
    pub missing_identity_lifecycles: usize,
    pub partial: bool,
}

/// Current safe events omit nonempty-content, tool-batch and response-cycle evidence.
/// No record-delay or response-gap sample can be established from activity markers.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ResponseGapSupport {
    UnsupportedMissingContentAndBatchEvidence,
}

#[derive(Debug)]
pub struct Analysis {
    pub method: &'static str,
    pub state: State,
    pub start: Option<Anchor>,
    pub end: Option<Anchor>,
    pub native_wall_clock_ms: Option<u64>,
    pub derived_wall_clock_ms: Option<u64>,
    pub native_ttft_ms: Option<u64>,
    /// Native duration minus observed boundary duration; neither is rescaled.
    pub boundary_delta_ms: Option<i128>,
    pub intervals: intervals::IntervalMetrics,
    /// Unknown without observed candidates and at least one valid closed interval.
    /// Counts describe observations only; absence never establishes source completeness.
    pub category_union_ms: [Option<u64>; 3],
    pub context: Option<context::Statistics>,
    pub response_gap_support: ResponseGapSupport,
    pub response_gap_union_ms: Option<u64>,
    pub first_content_record_delay_ms: Option<u64>,
    pub coverage: Coverage,
    pub issues: Vec<Issue>,
}

#[derive(Default)]
struct Boundaries {
    starts: BTreeMap<i64, Precision>,
    ends: BTreeMap<i64, Precision>,
    durations: BTreeSet<u64>,
    ttfts: BTreeSet<u64>,
    native_ids: BTreeSet<String>,
    states: BTreeSet<u8>,
    clock_domains: BTreeMap<(String, String), (bool, bool)>,
    missing_start: bool,
    missing_end: bool,
    conflict: bool,
}

#[derive(Default)]
struct Item {
    domains: BTreeMap<(String, String), ItemDomain>,
    categories: BTreeSet<usize>,
    terminal_states: BTreeSet<u8>,
    conflict: bool,
}
#[derive(Default)]
struct ItemDomain {
    starts: BTreeSet<i64>,
    ends: BTreeSet<i64>,
    native_starts: BTreeSet<i64>,
    native_ends: BTreeSet<i64>,
    closed: bool,
}

fn category(kind: &ItemKind) -> Option<(usize, intervals::Category)> {
    match kind {
        ItemKind::Command => Some((0, intervals::Category::Command)),
        ItemKind::Compaction => Some((1, intervals::Category::Compaction)),
        ItemKind::Reasoning => Some((2, intervals::Category::Reasoning)),
        _ => None,
    }
}
fn terminal(phase: &Phase) -> bool {
    matches!(phase, Phase::Completed | Phase::Failed | Phase::Cancelled)
}
fn precision_rank(precision: &Precision) -> u8 {
    match precision {
        Precision::Second => 0,
        Precision::Millisecond => 1,
        Precision::Microsecond => 2,
        Precision::Nanosecond => 3,
        Precision::Unknown => 0,
    }
}
fn timestamp(event: &Event) -> Option<i64> {
    event.time().timestamp.as_deref().and_then(|time| {
        chrono::DateTime::parse_from_rfc3339(time)
            .ok()
            .map(|time| time.timestamp_millis())
    })
}
fn conflicting(event: &Event) -> bool {
    event
        .gaps()
        .iter()
        .any(|gap| matches!(gap, Gap::ConflictingIdentity | Gap::MissingIdentity))
}
fn singleton<T: Copy + Ord>(values: &BTreeSet<T>) -> Option<T> {
    (values.len() == 1).then(|| *values.first().unwrap())
}
fn anchor(values: &BTreeMap<i64, Precision>) -> Option<Anchor> {
    if values.len() != 1 {
        return None;
    }
    values
        .first_key_value()
        .map(|(timestamp_ms, precision)| Anchor {
            timestamp_ms: *timestamp_ms,
            precision: precision.clone(),
        })
}

/// O(E log E + M log M) time and O(E + M) space, bounded before retained collections.
/// An input limit returns partial unknown results, never a selected prefix. Native
/// durations are independent observations and cannot supply absolute endpoints.
pub fn analyze(input: AnalyzeInput<'_>) -> Analysis {
    let mut result = Analysis {
        method: "safe_event_turn_v1",
        state: State::Unknown,
        start: None,
        end: None,
        native_wall_clock_ms: None,
        derived_wall_clock_ms: None,
        native_ttft_ms: None,
        boundary_delta_ms: None,
        intervals: intervals::analyze(None, &[], &[], input.budget.lifecycle_records),
        category_union_ms: [None; 3],
        context: None,
        response_gap_support: ResponseGapSupport::UnsupportedMissingContentAndBatchEvidence,
        response_gap_union_ms: None,
        first_content_record_delay_ms: None,
        coverage: Coverage {
            supplied_events: input.events.len(),
            supplied_measurements: input.measurements.len(),
            ..Coverage::default()
        },
        issues: Vec::new(),
    };
    if [input.source, input.thread, input.turn]
        .iter()
        .any(|id| id.is_empty())
    {
        result.issues.push(Issue::InvalidScope);
        return result;
    }
    if input.events.len() > input.budget.events
        || input.measurements.len() > input.budget.measurements
    {
        result.coverage.partial = true;
        result.issues.push(Issue::ResourceLimit);
        return result;
    }
    let events: Vec<_> = input
        .events
        .iter()
        .filter(|event| {
            let source = event.position().source_instance_id == input.source;
            let exact = source
                && event.thread_id() == Some(input.thread)
                && event.turn_id() == Some(input.turn);
            if exact {
                result.coverage.scoped_events += 1;
            } else if source
                && (event.thread_id().is_none()
                    || (event.thread_id() == Some(input.thread) && event.turn_id().is_none()))
            {
                result.coverage.unassigned_events += 1;
            } else {
                result.coverage.outside_events += 1;
            }
            exact
        })
        .cloned()
        .collect();
    let measurements: Vec<_> = input
        .measurements
        .iter()
        .filter(|value| {
            let exact = value.source_instance_id.as_ref() == input.source
                && value.thread_id.as_deref() == Some(input.thread)
                && value.turn_id.as_deref() == Some(input.turn);
            if exact {
                result.coverage.scoped_measurements += 1;
            } else {
                result.coverage.outside_measurements += 1;
            }
            exact
        })
        .cloned()
        .collect();
    let mut domains = BTreeMap::new();
    for event in &events {
        let position = event.position();
        let span = domains
            .entry((position.file_id.as_str(), position.generation.as_str()))
            .or_insert((position.byte_offset, position.byte_offset));
        span.0 = span.0.min(position.byte_offset);
        span.1 = span.1.max(position.byte_offset);
    }
    // Unassigned source gaps are control facts, never target-turn observations.
    // Retain only breaks inside this turn's observed physical source spans.
    let discontinuities: Vec<_> = input
        .events
        .iter()
        .filter(|event| {
            let position = event.position();
            position.source_instance_id == input.source
                && event.turn_id().is_none()
                && event
                    .thread_id()
                    .is_none_or(|thread| thread == input.thread)
                && !event.gaps().is_empty()
                && domains
                    .get(&(position.file_id.as_str(), position.generation.as_str()))
                    .is_some_and(|(start, end)| {
                        *start <= position.byte_offset && position.byte_offset <= *end
                    })
        })
        .cloned()
        .collect();
    for event in &discontinuities {
        result.issues.push(Issue::SourceGap(event.id().to_owned()));
        if event.gaps().contains(&Gap::SourcePartial) {
            result.coverage.partial = true;
        }
    }
    result.context = Some(context::summarize_events_with_discontinuities(
        &measurements,
        &events,
        &discontinuities,
    ));
    let mut boundaries = Boundaries::default();
    let mut items: BTreeMap<intervals::Identity, Item> = BTreeMap::new();
    let lifecycle_records = events.iter().filter(|event| matches!(event.payload(), Payload::Item { item_kind, .. } if category(item_kind).is_some()) || matches!(event.payload(), Payload::Lifecycle { lifecycle: LifecycleKind::Compaction, .. })).count();
    for event in &events {
        if !event.gaps().is_empty() {
            result.issues.push(Issue::SourceGap(event.id().to_owned()));
            if event.gaps().contains(&Gap::SourcePartial) {
                result.coverage.partial = true;
            }
        }
        if let Payload::Lifecycle {
            lifecycle: LifecycleKind::Turn,
            phase,
            native_id,
            duration_ms,
            first_token_ms,
        } = event.payload()
        {
            result.coverage.boundary_candidates += 1;
            boundaries.conflict |= conflicting(event);

            if let Some(id) = native_id {
                boundaries.native_ids.insert(id.clone());
            }
            if terminal(phase)
                && let Some(value) = duration_ms
            {
                boundaries.durations.insert(*value);
            }
            if let Some(value) = first_token_ms {
                boundaries.ttfts.insert(*value);
            }
            let destination = if *phase == Phase::Started {
                boundaries.states.insert(0);
                Some(&mut boundaries.starts)
            } else if terminal(phase) {
                boundaries.states.insert(match phase {
                    Phase::Completed => 1,
                    Phase::Failed => 2,
                    Phase::Cancelled => 3,
                    _ => unreachable!(),
                });
                Some(&mut boundaries.ends)
            } else {
                None
            };
            if let Some(destination) = destination {
                if let Some(time) = timestamp(event) {
                    let domain = boundaries
                        .clock_domains
                        .entry((
                            event.position().file_id.clone(),
                            event.position().generation.clone(),
                        ))
                        .or_default();
                    if *phase == Phase::Started {
                        domain.0 = true;
                    } else {
                        domain.1 = true;
                    }
                    let precision = event.time().precision.clone();
                    destination
                        .entry(time)
                        .and_modify(|old| {
                            if precision_rank(&precision) < precision_rank(old) {
                                *old = precision.clone();
                            }
                        })
                        .or_insert(precision);
                } else {
                    if *phase == Phase::Started {
                        boundaries.missing_start = true;
                    } else {
                        boundaries.missing_end = true;
                    }
                    result
                        .issues
                        .push(Issue::MissingBoundaryTime(event.id().to_owned()));
                }
            }
        }
        let candidate = match event.payload() {
            Payload::Item {
                item_kind,
                native_id,
                phase,
                started_at_ms,
                completed_at_ms,
                ..
            } => category(item_kind).map(|(index, category)| {
                (
                    index,
                    category,
                    native_id,
                    phase,
                    *started_at_ms,
                    *completed_at_ms,
                )
            }),
            Payload::Lifecycle {
                lifecycle: LifecycleKind::Compaction,
                native_id,
                phase,
                ..
            } => Some((
                1,
                intervals::Category::Compaction,
                native_id,
                phase,
                None,
                None,
            )),
            _ => None,
        };
        let Some((index, _, native_id, phase, native_start, native_end)) = candidate else {
            continue;
        };
        result.coverage.lifecycle_candidates[index] += 1;
        if lifecycle_records > input.budget.lifecycle_records {
            continue;
        }
        let Some(native_id) = native_id else {
            result.coverage.missing_identity_lifecycles += 1;
            result
                .issues
                .push(Issue::MissingItemIdentity(event.id().to_owned()));
            continue;
        };
        // Match operation identity scope: files identify observations, not a
        // second operation. Clock domains only constrain endpoint pairing.
        let identity = intervals::Identity {
            source: input.source.to_owned(),
            task: input.thread.to_owned(),
            turn: input.turn.to_owned(),
            item: native_id.clone(),
        };
        let item = items.entry(identity).or_default();
        item.categories.insert(index);
        item.conflict |= conflicting(event);
        if terminal(phase) {
            item.terminal_states.insert(match phase {
                Phase::Completed => 1,
                Phase::Failed => 2,
                Phase::Cancelled => 3,
                _ => unreachable!(),
            });
        }
        let domain = item
            .domains
            .entry((
                event.position().file_id.clone(),
                event.position().generation.clone(),
            ))
            .or_default();
        domain.closed |= terminal(phase);
        if let Some(time) = native_start {
            domain.native_starts.insert(time);
        }
        if let Some(time) = native_end {
            domain.native_ends.insert(time);
        }
        let start = (*phase == Phase::Started)
            .then(|| timestamp(event))
            .flatten();
        let end = terminal(phase).then(|| timestamp(event)).flatten();
        if let Some(time) = start {
            domain.starts.insert(time);
        }
        if let Some(time) = end {
            domain.ends.insert(time);
        }
        if start.is_none() && end.is_none() && native_start.is_none() && native_end.is_none() {
            result
                .issues
                .push(Issue::MissingItemTime(event.id().to_owned()));
        }
    }
    let identity_conflict = boundaries.conflict || boundaries.native_ids.len() > 1;
    let state_conflict = boundaries
        .states
        .iter()
        .filter(|value| **value != 0)
        .count()
        > 1;
    let boundary_conflict = identity_conflict
        || state_conflict
        || boundaries.starts.len() > 1
        || boundaries.ends.len() > 1
        || (!boundaries.starts.is_empty()
            && !boundaries.ends.is_empty()
            && !boundaries
                .clock_domains
                .values()
                .any(|(start, end)| *start && *end));
    if boundary_conflict {
        result.issues.push(Issue::BoundaryConflict);
    } else {
        result.start = (!boundaries.missing_start)
            .then(|| anchor(&boundaries.starts))
            .flatten();
        result.end = (!boundaries.missing_end)
            .then(|| anchor(&boundaries.ends))
            .flatten();
    }
    if !identity_conflict && !state_conflict {
        result.state = match boundaries
            .states
            .iter()
            .find(|value| **value != 0)
            .copied()
            .or_else(|| boundaries.states.first().copied())
        {
            Some(0) => State::Running,
            Some(1) => State::Completed,
            Some(2) => State::Failed,
            Some(3) => State::Cancelled,
            _ => State::Unknown,
        };
    }
    // Invalid or conflicting absolute anchors cannot invalidate an independent
    // native duration, but conflicting turn identities invalidate both methods.
    if !identity_conflict {
        result.native_wall_clock_ms = singleton(&boundaries.durations);
        result.native_ttft_ms = singleton(&boundaries.ttfts);
    }
    if boundaries.durations.len() > 1 || boundaries.ttfts.len() > 1 {
        result.issues.push(Issue::BoundaryConflict);
    }
    let window = result
        .start
        .as_ref()
        .zip(result.end.as_ref())
        .and_then(|(start, end)| {
            if end.timestamp_ms < start.timestamp_ms {
                result.issues.push(Issue::ReversedBoundary);
                None
            } else {
                Some(intervals::Window {
                    start_ms: start.timestamp_ms,
                    end_ms: end.timestamp_ms,
                })
            }
        });
    result.derived_wall_clock_ms =
        window.map(|window| (i128::from(window.end_ms) - i128::from(window.start_ms)) as u64);
    result.boundary_delta_ms = result
        .native_wall_clock_ms
        .zip(result.derived_wall_clock_ms)
        .map(|(native, derived)| i128::from(native) - i128::from(derived));
    if lifecycle_records > input.budget.lifecycle_records {
        result.coverage.partial = true;
        result.issues.push(Issue::ResourceLimit);
        result.intervals = intervals::analyze(window, &[], &[], input.budget.lifecycle_records);
        result.intervals.partial = true;
        result.intervals.covered_ms = None;
        result.intervals.unclassified_ms = None;
        result.intervals.coverage_ratio = None;
        result.intervals.mask_ms = [0; 8];
        result
            .intervals
            .issues
            .push(intervals::Issue::ResourceLimit);
        return result;
    }
    let mut mapped = Vec::new();
    for (identity, item) in items {
        let prefer_native_start = item
            .domains
            .values()
            .any(|domain| !domain.native_starts.is_empty());
        let prefer_native_end = item
            .domains
            .values()
            .any(|domain| !domain.native_ends.is_empty());
        let mut starts = BTreeSet::new();
        let mut ends = BTreeSet::new();
        let mut pairs = BTreeSet::new();
        for domain in item.domains.values() {
            let start = if prefer_native_start {
                &domain.native_starts
            } else {
                &domain.starts
            };
            let end = if prefer_native_end {
                &domain.native_ends
            } else {
                &domain.ends
            };
            starts.extend(start.iter().copied());
            ends.extend(end.iter().copied());
            if domain.closed
                && let Some(pair) = singleton(start).zip(singleton(end))
            {
                pairs.insert(pair);
            }
        }
        if item.conflict
            || item.terminal_states.len() > 1
            || item.categories.len() != 1
            || starts.len() > 1
            || ends.len() > 1
        {
            result.coverage.conflicting_lifecycles += 1;
            result.issues.push(Issue::IdentityConflict(identity.item));
            continue;
        }
        let index = *item.categories.first().unwrap();
        let category = [
            intervals::Category::Command,
            intervals::Category::Compaction,
            intervals::Category::Reasoning,
        ][index];
        let start_ms = singleton(&starts);
        // A closed same-domain pair is required even with explicit identity.
        let end_ms = singleton(&pairs).map(|(_, end)| end);
        if item.domains.len() > 1 && !starts.is_empty() && !ends.is_empty() && pairs.is_empty() {
            result
                .issues
                .push(Issue::UnmatchedClockDomain(identity.item.clone()));
        }
        if start_ms
            .zip(end_ms)
            .is_some_and(|(start, end)| end >= start)
        {
            result.coverage.linked_lifecycles[index] += 1;
        }
        mapped.push(intervals::LifecycleInterval {
            identity,
            category,
            start_ms,
            end_ms,
        });
    }
    result.intervals = intervals::analyze(window, &mapped, &[], input.budget.lifecycle_records);
    result.category_union_ms = std::array::from_fn(|index| {
        (result.intervals.observed_window_ms.is_some()
            && !result.intervals.partial
            && result.intervals.complete_intervals[index] > 0)
            .then_some(result.intervals.category_union_ms[index])
    });
    result
}

#[cfg(test)]
#[path = "analysis/tests.rs"]
mod tests;
