//! Accounting and operation projections consume safe source events, never raw rows.
use super::*;
use crate::session_events::{Event, Payload as SafePayload};

pub(super) fn apply(facts: &mut Facts, event: &Event, report: &mut SourceReport) {
    match event.payload() {
        SafePayload::Ancestry { parent_id, .. } => {
            if let Some(thread) = event.thread_id() {
                facts.parents.insert(thread.into(), parent_id.clone());
            }
        }
        SafePayload::Measurement {
            value,
            direct,
            cumulative,
            interval_start,
            fingerprint,
        } => {
            facts.project_measurement(
                Candidate {
                    measurement: value.clone(),
                    direct: *direct,
                    cumulative: *cumulative,
                    interval_start: *interval_start,
                    fingerprint: fingerprint.clone(),
                },
                report,
            );
        }
        SafePayload::Operation { value, .. } => {
            facts.project_operation(value.as_ref().clone(), report)
        }
        _ => {}
    }
}
