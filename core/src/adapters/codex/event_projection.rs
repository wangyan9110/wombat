//! Accounting and operation projections consume safe source events, never raw rows.
use super::*;
use crate::session_events::{Event, Payload as SafePayload};

/// Match deterministic source traversal, not timestamp or hashed event-ID order.
pub(super) fn order(event: &Event) -> (&str, u64, u32) {
    let evidence = match event.payload() {
        SafePayload::Thread { evidence, .. }
        | SafePayload::Turn { evidence, .. }
        | SafePayload::Ancestry { evidence, .. } => Some(evidence),
        SafePayload::Measurement { value, .. } => value.evidence.first(),
        SafePayload::Operation { value, .. } => value.evidence.first(),
        _ => None,
    };
    (
        evidence.map_or(event.position().file_id.as_str(), |e| e.file.as_ref()),
        event.position().byte_offset,
        event.position().ordinal,
    )
}

pub(super) fn apply(facts: &mut Facts, event: &Event, report: &mut SourceReport) {
    match event.payload() {
        SafePayload::Thread {
            value,
            project_path,
            ..
        } => {
            let id = facts.project_thread(
                &value.source_instance_id,
                &value.upstream_id,
                value.started_at.as_deref(),
                project_path.as_deref(),
            );
            if let Some(time) = &value.last_activity_at
                && let Some(thread) = facts.threads.get_mut(&id)
                && thread
                    .last_activity_at
                    .as_ref()
                    .is_none_or(|old| old < time)
            {
                thread.last_activity_at = Some(time.clone());
            }
        }
        SafePayload::Turn { value, .. } => {
            facts.project_turn(
                &value.thread_id,
                &value.upstream_id,
                value.started_at.as_deref(),
                (value.status != "unknown").then_some(value.status.as_str()),
            );
        }
        SafePayload::Ancestry { parent_id, .. } => {
            if let Some(thread) = event.thread_id() {
                facts.parents.insert(thread.into(), parent_id.clone());
            }
        }
        SafePayload::Measurement {
            value,
            context_conflicts,
            direct,
            cumulative,
            interval_start,
            fingerprint,
        } => {
            let mut candidate = Candidate {
                measurement: value.clone(),
                direct: *direct,
                cumulative: *cumulative,
                interval_start: *interval_start,
                fingerprint: fingerprint.clone(),
            };
            context::apply(facts, &mut candidate, context_conflicts, report);
            facts.project_measurement(candidate, report);
        }

        SafePayload::Operation { value, .. } => {
            facts.project_operation(value.as_ref().clone(), report)
        }
        _ => {}
    }
}
