//! Request-input pressure statistics for the shared timing query.
//!
//! Samples come from the existing reconciled accounting projection; safe events
//! establish historical segments, windows and temporal associations only.
//! A segment must end at a model/effort change, conflict, turn boundary or source gap.
//! This module never infers a window from a model name or cumulative accounting.
use crate::adapters::contract::Measurement;
use crate::session_events::{Event, ItemKind, LifecycleKind, Payload};
use std::collections::BTreeMap;
use std::sync::Arc;
type Associated<'a> = (
    &'a Measurement,
    String,
    Option<MatchedWindow>,
    u64,
    Option<i64>,
);

/// Associate windows only within a single physical source generation and turn.
/// `measurements` must be the authoritative reconciled projection for this scope.
/// Raw event copies cannot add samples or override reconciled facts. Conflicting
/// context evidence prevents window/time association, while candidate coverage and
/// reliable raw inputs remain governed by the authoritative measurements.
/// O(E log E + M log M) time and O(E + M) space; callers must bound both inputs.
pub fn summarize_events(measurements: &[Arc<Measurement>], events: &[Arc<Event>]) -> Statistics {
    summarize_events_with_discontinuities(measurements, events, &[])
}

/// Source discontinuities may have no turn owner. They only terminate physical
/// source segments; their payloads cannot contribute samples or compactions.
pub(super) fn summarize_events_with_discontinuities(
    measurements: &[Arc<Measurement>],
    events: &[Arc<Event>],
    discontinuities: &[Arc<Event>],
) -> Statistics {
    let canonical: BTreeMap<_, _> = measurements
        .iter()
        .map(|value| (value.id.as_str(), value.as_ref()))
        .collect();
    let mut scopes = BTreeMap::new();
    let mut breaks = BTreeMap::new();
    let mut identities: BTreeMap<&str, Vec<&Measurement>> = BTreeMap::new();
    for event in events {
        if let Payload::Measurement { value, .. } = event.payload()
            && canonical.contains_key(value.id.as_str())
        {
            identities.entry(&value.id).or_default().push(value);
        }
        let position = event.position();
        if !event.gaps().is_empty() {
            breaks
                .entry((
                    &position.source_instance_id,
                    &position.file_id,
                    &position.generation,
                ))
                .or_insert_with(Vec::new)
                .push(position.byte_offset);
        }
        let key = (
            &position.source_instance_id,
            &position.file_id,
            &position.generation,
            event.thread_id(),
            event.turn_id(),
        );
        scopes
            .entry(key)
            .or_insert_with(Vec::new)
            .push(event.as_ref());
    }
    for event in discontinuities {
        if !event.gaps().is_empty() {
            let position = event.position();
            breaks
                .entry((
                    &position.source_instance_id,
                    &position.file_id,
                    &position.generation,
                ))
                .or_insert_with(Vec::new)
                .push(position.byte_offset);
        }
    }
    let conflicts: std::collections::BTreeSet<_> = identities
        .iter()
        .filter(|(_, copies)| conflicting_context(copies))
        .map(|(id, _)| *id)
        .collect();
    let mut seen = BTreeMap::new();
    for offsets in breaks.values_mut() {
        offsets.sort_unstable();
        offsets.dedup();
    }
    let mut associated: Vec<Associated<'_>> = Vec::new();
    let mut compactions = Vec::new();
    let mut conflicting_window_records = 0;
    for (scope, mut records) in scopes {
        records.sort_by_key(|event| (event.position().byte_offset, event.position().ordinal));
        let mut previous_model = None;
        let mut previous_window = None;
        let mut previous_time = None;
        let mut previous_offset = None;
        let mut segment = 0_u64;
        let mut offset = 0;
        while offset < records.len() {
            let end = offset
                + records[offset..].partition_point(|event| {
                    event.position().byte_offset == records[offset].position().byte_offset
                });
            let row = &records[offset..end];
            let row_time = row[0]
                .time()
                .timestamp
                .as_deref()
                .and_then(|time| chrono::DateTime::parse_from_rfc3339(time).ok());
            let broken = row.iter().any(|event| !event.gaps().is_empty()
                || matches!(event.payload(), Payload::Measurement {value, ..} if conflicts.contains(value.id.as_str()))
                || matches!(event.payload(), Payload::Lifecycle { lifecycle: LifecycleKind::Turn, .. }))
                || row_time.is_none()
                || previous_time
                    .zip(row_time)
                    .is_some_and(|(old, new)| new < old)
                || breaks
                    .get(&(scope.0, scope.1, scope.2))
                    .is_some_and(|offsets| {
                        let index = previous_offset
                            .map_or(0, |old| offsets.partition_point(|offset| *offset <= old));
                        offsets
                            .get(index)
                            .is_some_and(|offset| *offset <= row[0].position().byte_offset)
                    });
            previous_time = row_time;
            previous_offset = Some(row[0].position().byte_offset);
            if broken {
                previous_window = None;
                previous_model = None;
                segment += 1;
            }
            let windows: Vec<_> = row
                .iter()
                .filter_map(|event| match event.payload() {
                    Payload::ContextWindow { model, tokens } => Some((model.as_deref(), *tokens)),
                    _ => None,
                })
                .collect();
            let consistent = windows
                .first()
                .copied()
                .filter(|first| windows.iter().all(|window| window == first));
            if !windows.is_empty() && consistent.is_none() {
                conflicting_window_records += 1;
                previous_window = None;
                segment += 1;
            }
            if consistent.is_some_and(|(window_model, _)| {
                window_model.is_some()
                    && previous_model.is_some_and(|(model, _)| window_model != model)
            }) {
                previous_model = None;
                previous_window = None;
                segment += 1;
            }
            for event in row {
                let Payload::Measurement { value, .. } = event.payload() else {
                    continue;
                };
                let Some(value) = canonical.get(value.id.as_str()).copied() else {
                    continue;
                };
                let model = (
                    value.model.raw.as_deref(),
                    value.reasoning_effort.as_deref(),
                );
                if previous_model != Some(model) {
                    previous_window = None;
                    segment += 1;
                }
                previous_model = Some(model);
                let valid_scope = scope.3.is_some()
                    && scope.4.is_some()
                    && scope.0.as_str() == value.source_instance_id.as_ref()
                    && scope.3 == value.thread_id.as_deref()
                    && scope.4 == value.turn_id.as_deref()
                    && event.time().timestamp.is_some()
                    && !broken
                    && !conflicts.contains(value.id.as_str());
                let same_record = consistent
                    .filter(|(window_model, tokens)| {
                        *tokens > 0 && window_model.is_none_or(|name| Some(name) == model.0)
                    })
                    .map(|(_, tokens)| MatchedWindow {
                        tokens,
                        basis: WindowBasis::SameRecord,
                    });
                if !windows.is_empty() && same_record.is_none() {
                    previous_window = None;
                }
                let window = valid_scope
                    .then(|| same_record.or(previous_window))
                    .flatten();
                if model.0.is_some() && model.1.is_some() && valid_scope {
                    previous_window = window.map(|window| MatchedWindow {
                        basis: WindowBasis::HistoricalContinuation,
                        ..window
                    });
                } else {
                    previous_window = None;
                }
                if let Some(index) = seen.get(value.id.as_str()).copied() {
                    let old: &mut Associated<'_> = &mut associated[index];
                    if old.2.map(|window| window.tokens) != window.map(|window| window.tokens)
                        || old.1 != format!("{:?}/{segment}", scope)
                    {
                        old.2 = None;
                    }
                    // Distinct source positions for one reconciled sample do not
                    // establish a unique compaction neighbor, even if inputs agree.
                    old.4 = None;
                    continue;
                }
                seen.insert(value.id.as_str(), associated.len());
                let segment_id = format!("{:?}/{segment}", scope);
                associated.push((
                    value,
                    segment_id,
                    window,
                    event.position().byte_offset,
                    // Unknown model/effort cannot establish a shared historical
                    // segment for neighbors; same-record ratios remain usable.
                    if valid_scope && model.0.is_some() && model.1.is_some() {
                        row_time.map(|time| time.timestamp_millis())
                    } else {
                        None
                    },
                ));
            }
            // A window-only record cannot establish an effort segment. Preserve a
            // known segment only when its model matches and it has valid time.
            if !broken
                && row
                    .iter()
                    .all(|event| !matches!(event.payload(), Payload::Measurement { .. }))
                && let Some((window_model, tokens)) = consistent
            {
                if tokens > 0
                    && row.iter().all(|event| event.time().timestamp.is_some())
                    && previous_model.is_some_and(|(model, effort)| {
                        model.is_some() && effort.is_some() && window_model == model
                    })
                {
                    previous_window = Some(MatchedWindow {
                        tokens,
                        basis: WindowBasis::HistoricalContinuation,
                    });
                } else {
                    previous_window = None;
                }
            }
            for event in row {
                if matches!(
                    event.payload(),
                    Payload::Lifecycle {
                        lifecycle: LifecycleKind::Compaction,
                        ..
                    } | Payload::Item {
                        item_kind: ItemKind::Compaction,
                        ..
                    }
                ) {
                    compactions.push((
                        event.id().to_owned(),
                        format!("{:?}/{segment}", scope),
                        event.position().byte_offset,
                        row_time.map(|time| time.timestamp_millis()),
                    ));
                }
            }
            offset = end;
        }
    }
    // Keep every authoritative candidate in coverage, including measurements for
    // which the retained safe event scope cannot establish a historical position.
    for value in canonical.values() {
        if !seen.contains_key(value.id.as_str()) {
            associated.push((value, format!("unassociated/{}", value.id), None, 0, None));
        }
    }
    let mut statistics = summarize(associated.iter().map(
        |(measurement, segment_id, window, _, _)| Candidate {
            measurement,
            segment_id,
            window: *window,
        },
    ));
    statistics.conflicting_measurements = conflicts.len();
    statistics.conflicting_window_records = conflicting_window_records;
    let mut sample_index: BTreeMap<&str, Vec<&Associated<'_>>> = BTreeMap::new();
    for entry in &associated {
        if entry.0.request_scoped && entry.0.tokens.raw_input.is_some() && entry.4.is_some() {
            sample_index.entry(&entry.1).or_default().push(entry);
        }
    }
    statistics.compactions = compactions
        .into_iter()
        .map(|(event_id, segment_id, position, time)| {
            let reliable = sample_index
                .get(segment_id.as_str())
                .map(Vec::as_slice)
                .unwrap_or_default();
            let before_index = reliable.partition_point(|entry| entry.3 < position);
            let after_index = reliable.partition_point(|entry| entry.3 <= position);
            let before = before_index
                .checked_sub(1)
                .and_then(|index| reliable.get(index))
                .copied();
            let after = reliable.get(after_index).copied();
            let neighbor = |entry: Option<&Associated<'_>>| {
                entry.and_then(|(measurement, _, window, _, timestamp)| {
                    let distance_ms = (*timestamp)?.abs_diff(time?);
                    Some(Neighbor {
                        measurement_id: measurement.id.clone(),
                        raw_input: measurement.tokens.raw_input?,
                        ratio: window.map(|window| {
                            measurement.tokens.raw_input.unwrap() as f64 / window.tokens as f64
                        }),
                        distance_ms,
                    })
                })
            };
            CompactionNeighbors {
                event_id,
                segment_id,
                before: neighbor(before),
                after: neighbor(after),
            }
        })
        .collect();
    statistics
}

// Only disagreements between observed context facts are conflicts. Missing fields
// can be supplemented by the accounting projection; row evidence, sequence and
// observation timestamps describe copies rather than request-input identity.
fn conflicting_context(copies: &[&Measurement]) -> bool {
    fn differs<T: PartialEq>(mut values: impl Iterator<Item = T>) -> bool {
        values
            .next()
            .is_some_and(|first| values.any(|value| value != first))
    }
    differs(copies.iter().filter_map(|value| value.tokens.raw_input))
        || differs(copies.iter().filter_map(|value| value.model.raw.as_deref()))
        || differs(
            copies
                .iter()
                .filter_map(|value| value.reasoning_effort.as_deref()),
        )
        || differs(copies.iter().filter_map(|value| value.thread_id.as_deref()))
        || differs(copies.iter().filter_map(|value| value.turn_id.as_deref()))
}

pub const METHOD: &str = "request_input_window_v1";
pub const QUANTILE_METHOD: &str = "type_7";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowBasis {
    SameRecord,
    HistoricalContinuation,
}

#[derive(Clone, Copy, Debug)]
pub struct MatchedWindow {
    pub tokens: u64,
    pub basis: WindowBasis,
}

/// A candidate is one reconciled measurement, never one raw event copy.
/// `segment_id` identifies an evidence-established historical model/effort segment.
pub struct Candidate<'a> {
    pub measurement: &'a Measurement,
    pub segment_id: &'a str,
    pub window: Option<MatchedWindow>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Distribution {
    pub samples: usize,
    pub median: Option<f64>,
    pub p90: Option<f64>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Segment {
    pub id: String,
    pub candidates: usize,
    pub non_request_scoped: usize,
    pub missing_raw_input: usize,
    pub missing_window: usize,
    pub invalid_window: usize,
    pub same_record_windows: usize,
    pub continued_windows: usize,
    pub above_window: usize,
    pub input: Distribution,
    pub ratio: Distribution,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Statistics {
    pub method: &'static str,
    pub quantile_method: &'static str,
    pub candidates: usize,
    pub conflicting_measurements: usize,
    pub conflicting_window_records: usize,
    pub input: Distribution,
    pub ratio: Distribution,
    pub segments: Vec<Segment>,
    pub compactions: Vec<CompactionNeighbors>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Neighbor {
    pub measurement_id: String,
    pub raw_input: u64,
    pub ratio: Option<f64>,
    pub distance_ms: u64,
}

/// Entries describe source compaction observations, not deduplicated lifecycle counts.
#[derive(Clone, Debug, PartialEq)]
pub struct CompactionNeighbors {
    pub event_id: String,
    pub segment_id: String,
    pub before: Option<Neighbor>,
    pub after: Option<Neighbor>,
}

#[derive(Default)]
struct Accumulator {
    segment: Segment,
    inputs: Vec<f64>,
    ratios: Vec<f64>,
}

/// O(n log n) time and O(n) space; the query must bound its candidate input.
/// Missing window values do not remove reliable input samples. Ratios above one
/// are retained as observations, and zero input remains a valid sample.
pub fn summarize<'a>(candidates: impl IntoIterator<Item = Candidate<'a>>) -> Statistics {
    let mut segments: BTreeMap<String, Accumulator> = BTreeMap::new();
    let mut inputs = Vec::new();
    let mut ratios = Vec::new();
    let mut count = 0;
    for candidate in candidates {
        count += 1;
        let accumulator = segments.entry(candidate.segment_id.to_owned()).or_default();
        let segment = &mut accumulator.segment;
        segment.candidates += 1;
        if !candidate.measurement.request_scoped {
            segment.non_request_scoped += 1;
            continue;
        }
        // raw_input already includes cache read/create. Never add cache categories
        // or reconstruct a request from an interval/delta with incomplete evidence.
        let Some(raw_input) = candidate.measurement.tokens.raw_input else {
            segment.missing_raw_input += 1;
            continue;
        };
        let input = raw_input as f64;
        accumulator.inputs.push(input);
        inputs.push(input);
        let Some(window) = candidate.window else {
            segment.missing_window += 1;
            continue;
        };
        if window.tokens == 0 {
            segment.invalid_window += 1;
            continue;
        }
        match window.basis {
            WindowBasis::SameRecord => segment.same_record_windows += 1,
            WindowBasis::HistoricalContinuation => segment.continued_windows += 1,
        }
        if raw_input > window.tokens {
            segment.above_window += 1;
        }
        let ratio = input / window.tokens as f64;
        accumulator.ratios.push(ratio);
        ratios.push(ratio);
    }
    Statistics {
        method: METHOD,
        quantile_method: QUANTILE_METHOD,
        candidates: count,
        conflicting_measurements: 0,
        conflicting_window_records: 0,
        input: distribution(inputs),
        ratio: distribution(ratios),
        segments: segments
            .into_iter()
            .map(|(id, mut accumulator)| {
                accumulator.segment.id = id;
                accumulator.segment.input = distribution(accumulator.inputs);
                accumulator.segment.ratio = distribution(accumulator.ratios);
                accumulator.segment
            })
            .collect(),
        compactions: Vec::new(),
    }
}

fn distribution(mut values: Vec<f64>) -> Distribution {
    values.sort_unstable_by(f64::total_cmp);
    Distribution {
        samples: values.len(),
        median: quantile(&values, 0.5),
        p90: quantile(&values, 0.9),
    }
}

fn quantile(sorted: &[f64], probability: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let h = (sorted.len() - 1) as f64 * probability;
    let lower = h.floor() as usize;
    let upper = h.ceil() as usize;
    Some(sorted[lower] + (sorted[upper] - sorted[lower]) * (h - lower as f64))
}

#[cfg(test)]
#[path = "context/tests.rs"]
mod tests;
