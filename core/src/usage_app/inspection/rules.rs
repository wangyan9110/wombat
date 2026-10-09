//! Pure checks over shared task statistics; no snapshot access or source reads.
use crate::usage_app_dto::{InspectionPolicy, InspectionSignal, InvestigationCandidate};

pub(super) fn signals(
    candidate: &InvestigationCandidate,
    p: &InspectionPolicy,
) -> Vec<InspectionSignal> {
    let mut signals = vec![];
    if candidate
        .usage
        .complete_token_total()
        .is_some_and(|n| n >= p.minimum_tokens)
    {
        signals.push(InspectionSignal::HighUsage);
    }
    if candidate.input.is_some_and(|n| n >= p.minimum_input)
        && candidate
            .cache_share
            .is_some_and(|r| r <= p.maximum_cache_share)
    {
        signals.push(InspectionSignal::LowCacheReuse);
    }
    if candidate
        .largest_uncached_jump
        .is_some_and(|n| n >= p.minimum_input_jump)
    {
        signals.push(InspectionSignal::InputJump);
    }
    if candidate.determinate_operations >= p.minimum_determinate_operations
        && candidate.failed_operations >= p.minimum_failures
        && candidate.failed_operations as f64 / candidate.determinate_operations as f64
            >= p.minimum_failure_share
    {
        signals.push(InspectionSignal::FailureShare);
    }
    if candidate.repeated_requests >= p.minimum_repeated_requests {
        signals.push(InspectionSignal::RepeatedRequest);
    }
    signals
}
