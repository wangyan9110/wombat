//! First observed visible-content record, distinct from a model's first token.
use super::*;
use crate::session_events::{ContentPresence, MessageOrigin, MessageRecordKind};

fn order(event: &Event) -> (u64, u32) {
    (event.position().byte_offset, event.position().ordinal)
}
fn domain(event: &Event) -> (&str, &str) {
    (&event.position().file_id, &event.position().generation)
}
fn breaks(event: &Event) -> bool {
    event.gaps().iter().any(|gap| {
        matches!(
            gap,
            Gap::InvalidTimestamp
                | Gap::SourcePartial
                | Gap::UnmatchedBoundary
                | Gap::MissingIdentity
                | Gap::ConflictingIdentity
        )
    })
}

/// Physical order is meaningful only within one file generation. Multiple
/// domains need their own explicit start and agreeing first-record timestamps.
/// Unknown/untimed earlier candidates and source breaks are never filled by a
/// later known record. O(E log E) time, O(E) space within the analysis event budget.
pub(super) fn first_record(events: &[Arc<Event>], controls: &[Arc<Event>], result: &mut Analysis) {
    let mut candidates: BTreeMap<(&str, &str), Vec<&Event>> = BTreeMap::new();
    let mut signatures = BTreeMap::new();
    let mut starts = BTreeMap::new();
    let mut source_breaks: BTreeMap<_, BTreeSet<_>> = BTreeMap::new();
    for event in events {
        if matches!(
            event.payload(),
            Payload::Lifecycle {
                lifecycle: LifecycleKind::Turn,
                phase: Phase::Started,
                ..
            }
        ) {
            starts
                .entry(domain(event))
                .and_modify(|first: &mut &Event| {
                    if order(event) < order(first) {
                        *first = event;
                    }
                })
                .or_insert(event.as_ref());
        }
    }
    for event in events.iter().chain(controls) {
        if breaks(event) {
            source_breaks
                .entry(domain(event))
                .or_default()
                .insert(order(event));
        }
    }
    let mut conflict = false;
    for event in events {
        let Payload::Message {
            origin,
            presence,
            native_id,
            record_kind,
            record_phase,
            ..
        } = event.payload()
        else {
            continue;
        };
        if !matches!(
            origin,
            MessageOrigin::AssistantVisible | MessageOrigin::Unknown
        ) {
            continue;
        }
        result.coverage.content_candidates += 1;
        if *origin == MessageOrigin::Unknown || *presence == ContentPresence::Unknown {
            result.coverage.unknown_content_records += 1;
        }
        match presence {
            ContentPresence::NonEmpty => result.coverage.nonempty_content_records += 1,
            ContentPresence::Unknown => {}
            ContentPresence::Empty => {}
        }
        // Completed snapshots with one native identity must agree about presence
        // and provenance. Empty starts followed by nonempty completion, and
        // different fragments of a delta stream, are expected transitions.
        if !matches!(record_kind, MessageRecordKind::Delta)
            && *record_phase != Phase::Started
            && let Some(id) = native_id
        {
            let signature = (*origin, *presence);
            if signatures
                .insert(id, signature)
                .is_some_and(|old| old != signature)
            {
                conflict = true;
                result
                    .issues
                    .push(Issue::ContentConflict(event.id().to_owned()));
            }
        }
        if *origin == MessageOrigin::Unknown || *presence != ContentPresence::Empty {
            if timestamp(event).is_none() {
                result.coverage.missing_content_time_records += 1;
            }
            candidates.entry(domain(event)).or_default().push(event);
        }
    }
    if conflict {
        result.coverage.partial = true;
        return;
    }
    let Some(start) = result.start.as_ref() else {
        return;
    };
    let start_ms = start.timestamp_ms;
    let mut first_times = BTreeSet::new();
    let mut unknown = false;
    if !candidates.is_empty() {
        for event in events.iter().chain(controls) {
            if breaks(event) && !candidates.contains_key(&domain(event)) {
                unknown = true;
                result
                    .issues
                    .push(Issue::UnmatchedContentDomain(event.id().to_owned()));
            }
        }
    }
    for (domain_id, mut records) in candidates {
        records.sort_by_key(|event| order(event));
        records.dedup_by_key(|event| event.id());
        let first = records[0];
        let matching_start = starts.get(&domain_id).copied();
        let Some(boundary) = matching_start else {
            unknown = true;
            result
                .issues
                .push(Issue::UnmatchedContentDomain(first.id().to_owned()));
            continue;
        };
        if timestamp(boundary) != Some(start_ms) {
            unknown = true;
            result
                .issues
                .push(Issue::MissingBoundaryTime(boundary.id().to_owned()));
        }
        let Payload::Message {
            origin, presence, ..
        } = first.payload()
        else {
            unreachable!()
        };
        if *origin == MessageOrigin::Unknown || *presence == ContentPresence::Unknown {
            unknown = true;
            result
                .issues
                .push(Issue::UnknownContent(first.id().to_owned()));
        }
        let first_ms = timestamp(first);
        if first_ms.is_none() {
            unknown = true;
            result
                .issues
                .push(Issue::MissingContentTime(first.id().to_owned()));
        }
        if order(first) < order(boundary) || first_ms.is_some_and(|time| time < start_ms) {
            unknown = true;
            result
                .issues
                .push(Issue::ContentConflict(first.id().to_owned()));
        }
        // A later record whose clock moves behind the first record makes this
        // order ambiguous. Unknown later records cannot alter an established first.
        for later in records.iter().skip(1) {
            if timestamp(later)
                .zip(first_ms)
                .is_some_and(|(later, first)| later < first)
            {
                unknown = true;
                result
                    .issues
                    .push(Issue::ContentConflict(later.id().to_owned()));
            }
        }
        if order(boundary) <= order(first)
            && source_breaks.get(&domain_id).is_some_and(|positions| {
                positions
                    .range(order(boundary)..=order(first))
                    .next()
                    .is_some()
            })
        {
            unknown = true;
            // All relevant source gaps are already reported by the caller.
        }
        if let Some(time) = first_ms {
            first_times.insert(time);
        }
    }
    if first_times.len() > 1 {
        unknown = true;
        result
            .issues
            .push(Issue::ContentConflict("multiple-source-domains".into()));
    }
    if unknown {
        result.coverage.partial = true;
    } else if let Some(time) = first_times.first() {
        result.first_content_record_delay_ms =
            Some((i128::from(*time) - i128::from(start_ms)) as u64);
    }
}
