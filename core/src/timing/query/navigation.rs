//! Local fragment locators use the exact partition order, never analysis order.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
pub(super) const LIMIT_BYTES: usize = 64 * 1024;
const PAGE_ROWS: usize = 200;

pub(super) fn unavailable(candidate: Count, reason: Basis) -> IntervalPages {
    IntervalPages {
        detail: m::capability(Support::Unavailable, reason),
        candidate_interval_count: candidate,
        located_interval_count: m::unavailable(reason),
        missing_event_ref_count: m::unavailable(reason),
        page_count: m::unavailable(reason),
        limit_bytes: LIMIT_BYTES,
        entries: vec![],
    }
}
fn corrupt() -> anyhow::Error {
    operation_error(
        "SNAPSHOT_CORRUPT",
        "Timing fragment evidence does not match the fixed target",
    )
}
struct Size<'a> {
    bytes: usize,
    cancelled: &'a AtomicBool,
}
impl Write for Size<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(std::io::Error::other("navigation cancelled"));
        }
        self.bytes = self.bytes.saturating_add(bytes.len());
        if self.bytes > LIMIT_BYTES {
            return Err(std::io::Error::other("navigation budget"));
        }
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn size(value: &impl serde::Serialize, cancelled: &AtomicBool) -> Result<Option<usize>> {
    let mut writer = Size {
        bytes: 0,
        cancelled,
    };
    let encoded = serde_json::to_writer(&mut writer, value);
    check(cancelled)?;
    Ok(encoded.is_ok().then_some(writer.bytes))
}
fn observed(value: usize) -> Count {
    m::count(Some(value as u128), Basis::ExactEventPage, &[])
}

pub(super) fn build(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    timeline: &Timeline,
    events: Option<&[Arc<Event>]>,
    fallback: Option<Basis>,
    cancelled: &AtomicBool,
) -> Result<IntervalPages> {
    check(cancelled)?;
    let candidate = timeline.track_count.clone();
    let Some(events) = events else {
        return Ok(unavailable(
            candidate,
            fallback.unwrap_or(Basis::NotRecorded),
        ));
    };
    if timeline.tracks.is_empty() {
        let mut empty = unavailable(candidate, timeline.detail.reason);
        if empty.candidate_interval_count.value == Some(0) {
            empty.detail.reason = Basis::NoCandidates;
            empty.located_interval_count = observed(0);
            empty.missing_event_ref_count = observed(0);
            empty.page_count = observed(0);
        }
        return Ok(empty);
    }
    if timeline.tracks.len() > PAGE_ROWS
        || timeline
            .tracks
            .iter()
            .any(|track| track.evidence_refs.len() > 3)
    {
        return Ok(unavailable(candidate, Basis::ResourceLimit));
    }
    // At most 200 * 3 borrowed identifiers; no second full-event map is retained.
    let mut selected = BTreeMap::<&str, Option<usize>>::new();
    let mut unknown_proof = false;
    for track in &timeline.tracks {
        check(cancelled)?;
        if track.evidence_scope == FragmentEvidence::Unavailable && track.evidence_refs.is_empty() {
            unknown_proof = true;
            continue;
        }
        if track.evidence_scope != FragmentEvidence::EventRecords || track.evidence_refs.is_empty()
        {
            return Err(corrupt());
        }
        let mut unique = BTreeSet::new();
        for reference in &track.evidence_refs {
            let id = reference
                .strip_prefix("event:")
                .filter(|id| !id.is_empty())
                .ok_or_else(corrupt)?;
            if !unique.insert(id) {
                return Err(corrupt());
            }
            selected.entry(id).or_default();
        }
    }
    for (index, event) in events.iter().enumerate() {
        check(cancelled)?;
        if event.thread_id() != Some(target.thread)
            || event.turn_id() != Some(target.turn)
            || event.position().source_instance_id != target.source
        {
            return Err(corrupt());
        }
        if let Some(offset) = selected.get_mut(event.id())
            && offset.replace(index).is_some()
        {
            return Err(corrupt());
        }
    }
    if selected.values().any(Option::is_none) {
        return Err(corrupt());
    }
    // Groups contain only bounded borrowed refs and integer offsets. Cursor strings
    // are constructed one interval at a time after full locator counts are known.
    let mut groups = Vec::with_capacity(timeline.tracks.len());
    let mut page_count = 0;
    for track in &timeline.tracks {
        check(cancelled)?;
        if track.evidence_refs.is_empty() {
            continue;
        }
        let mut pages = BTreeMap::<usize, Vec<&str>>::new();
        for reference in &track.evidence_refs {
            let offset = selected[reference.strip_prefix("event:").unwrap()].unwrap();
            pages
                .entry(offset / PAGE_ROWS * PAGE_ROWS)
                .or_default()
                .push(reference);
        }
        page_count += pages.len();
        groups.push((track.interval_alias.as_str(), pages));
    }
    let mut result = IntervalPages {
        detail: m::capability(
            if unknown_proof {
                Support::Partial
            } else {
                Support::Supported
            },
            if unknown_proof {
                Basis::MissingIdentity
            } else {
                Basis::ExactEventPage
            },
        ),
        candidate_interval_count: candidate,
        located_interval_count: observed(groups.len()),
        missing_event_ref_count: if unknown_proof {
            m::unavailable(Basis::MissingIdentity)
        } else {
            observed(0)
        },
        page_count: observed(page_count),
        limit_bytes: LIMIT_BYTES,
        entries: Vec::with_capacity(groups.len()),
    };
    let mut bytes = size(&result, cancelled)?.unwrap_or(LIMIT_BYTES + 1);
    let target = EventTarget::turn(target.thread, target.turn);
    for (alias, groups) in groups {
        check(cancelled)?;
        let mut pages = Vec::with_capacity(groups.len());
        for (offset, references) in groups {
            let cursor = snapshot.event_cursor_at_offset(&target, offset, cancelled)?;
            let cursor = match cursor.map(encode_cursor).transpose() {
                Ok(cursor) => cursor,
                Err(error)
                    if error
                        .downcast_ref::<crate::dto::OperationError>()
                        .is_some_and(|e| e.code == "RESOURCE_LIMIT") =>
                {
                    result.entries.clear();
                    result.detail = m::capability(Support::Unavailable, Basis::ResourceLimit);
                    return Ok(result);
                }
                Err(error) => return Err(error),
            };
            pages.push(FragmentPage {
                cursor,
                limit: PAGE_ROWS,
                evidence_refs: references.into_iter().map(str::to_owned).collect(),
            });
        }
        let entry = IntervalPage {
            interval_alias: alias.into(),
            pages,
        };
        let added = size(&entry, cancelled)?.unwrap_or(LIMIT_BYTES + 1)
            + usize::from(!result.entries.is_empty());
        bytes = bytes.saturating_add(added);
        if bytes > LIMIT_BYTES {
            result.entries.clear();
            result.detail = m::capability(Support::Unavailable, Basis::ResourceLimit);
            return Ok(result);
        }
        result.entries.push(entry);
    }
    check(cancelled)?;
    Ok(result)
}
