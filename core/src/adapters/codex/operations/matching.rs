//! Shared source request matching. No raw parameters enter retained observations.
use crate::adapters::contract::{MatchGap, OperationMatchObservation};
mod mcp;
pub(super) use mcp::{function as mcp_function, observe as mcp};
fn add(gaps: &mut Vec<MatchGap>, gap: MatchGap) {
    if !gaps.contains(&gap) {
        gaps.push(gap);
    }
}
pub(super) fn invalidate(observation: &mut Option<OperationMatchObservation>) {
    if let Some(value) = observation {
        value.request_fingerprint = None;
        value.function_request_fingerprint = None;
        value.receiver_owner = None;
        value.read_targets.clear();
        add(&mut value.gaps, MatchGap::ConflictingObservation);
    }
}
pub(super) fn merge(
    old: &mut Option<OperationMatchObservation>,
    new: &Option<OperationMatchObservation>,
) {
    let Some(next) = new else {
        return;
    };
    let Some(previous) = old else {
        old.clone_from(new);
        return;
    };
    if previous.gaps.contains(&MatchGap::ConflictingObservation) {
        return;
    }
    if previous
        .function_request_fingerprint
        .as_ref()
        .zip(next.function_request_fingerprint.as_ref())
        .is_some_and(|(a, b)| a != b)
        || next.gaps.contains(&MatchGap::ConflictingObservation)
        || previous
            .receiver_owner
            .as_ref()
            .zip(next.receiver_owner.as_ref())
            .is_some_and(|(a, b)| a != b)
        || previous
            .request_fingerprint
            .as_ref()
            .zip(next.request_fingerprint.as_ref())
            .is_some_and(|(a, b)| a != b)
        || !previous.read_targets.is_empty()
            && !next.read_targets.is_empty()
            && previous.read_targets != next.read_targets
    {
        invalidate(old);
        return;
    }
    if previous.receiver_owner.is_none() {
        previous.receiver_owner.clone_from(&next.receiver_owner);
    }
    if previous.request_fingerprint.is_none() {
        previous
            .request_fingerprint
            .clone_from(&next.request_fingerprint);
    }
    if previous.function_request_fingerprint.is_none() {
        previous
            .function_request_fingerprint
            .clone_from(&next.function_request_fingerprint);
    }
    if previous.read_targets.is_empty() {
        previous.read_targets.clone_from(&next.read_targets);
    }
    previous.expected_nonzero |= next.expected_nonzero;
    for gap in &next.gaps {
        add(&mut previous.gaps, gap.clone());
    }
    previous.gaps.retain(|gap| match gap {
        MatchGap::MissingParameters | MatchGap::MissingHistoricalCwd => {
            previous.request_fingerprint.is_none()
        }
        MatchGap::MissingReceiver => previous.receiver_owner.is_none(),
        _ => true,
    });
}
