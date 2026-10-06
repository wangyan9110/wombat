//! Repeated behavior from bounded, canonical safe events. No ledger or source-body access.
//! Counts concern supported requests and path observations, never waste or equal content.
use super::intervals;
use crate::{
    adapters::contract::ReadMatchTarget,
    operation_association::{ResolvedPhase, Scope, check, endpoints::Endpoints},
    session_events::Event,
};
use anyhow::Result;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, atomic::AtomicBool},
};
mod metadata;
mod order;
pub const FAILURE_METHOD: &str = "same_operation_after_failure_v1";
pub const READ_METHOD: &str = "same_target_read_v1";
pub const DETAIL_LIMIT: usize = 200;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Budget {
    pub operations: usize,
    pub metadata: usize,
    pub string_bytes: usize,
}
impl Default for Budget {
    fn default() -> Self {
        Self {
            operations: 100_000,
            metadata: 100_000,
            string_bytes: 64 * 1024 * 1024,
        }
    }
}
#[derive(Debug, Default, PartialEq, Eq)]
pub struct DurationTotal {
    /// Known subtotal; None when matched operations exist but none has a usable duration.
    pub sum_ms: Option<u128>,
    pub recorded_count: usize,
    pub calculated_count: usize,
    pub missing_count: usize,
}
impl DurationTotal {
    fn add(&mut self, duration: Option<(u64, bool)>) {
        if let Some((value, native)) = duration {
            self.sum_ms = Some(self.sum_ms.unwrap_or(0) + u128::from(value));
            if native {
                self.recorded_count += 1;
            } else {
                self.calculated_count += 1;
            }
        } else {
            self.missing_count += 1;
        }
    }
    fn finish(&mut self) {
        if self.missing_count > 0 && self.recorded_count + self.calculated_count == 0 {
            self.sum_ms = None;
        }
    }
}
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Metric {
    pub count: Option<usize>,
    pub duration: DurationTotal,
}
impl Metric {
    fn observed() -> Self {
        Self {
            count: Some(0),
            duration: DurationTotal {
                sum_ms: Some(0),
                ..DurationTotal::default()
            },
        }
    }
    fn add(&mut self, duration: Option<(u64, bool)>) {
        *self.count.as_mut().expect("computed count") += 1;
        self.duration.add(duration);
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadLayer {
    SamePathRangeUnconfirmed,
}
#[derive(Debug, PartialEq, Eq)]
pub struct Match {
    pub operation_id: String,
    pub after_failure_predecessor: Option<String>,
    pub successful_read_predecessors: Vec<String>,
    pub repeated_read_targets: usize,
    pub read_layer: Option<ReadLayer>,
    pub later_duration_ms: Option<u64>,
    pub duration_is_native: bool,
    pub recovery_span_ms: Option<u64>,
}
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Coverage {
    pub candidates: usize,
    pub eligible_commands: usize,
    pub missing_identity_records: usize,
    pub excluded_receivers: usize,
    pub missing_matching: usize,
    pub conflicting: usize,
    pub missing_start: usize,
    pub indeterminate_outcomes: usize,
    pub order_gaps: usize,
    pub context_resets: usize,
    pub crossed_context: usize,
    pub missing_clock_domain: usize,
    pub source_metadata_gaps: usize,
    pub duration_conflicts: usize,
    pub budget_exceeded: bool,
    pub partial: bool,
}
#[derive(Debug, PartialEq, Eq)]
pub struct Projection {
    pub failure_method: &'static str,
    pub read_method: &'static str,
    pub computed: bool,
    pub after_failure: Metric,
    pub repeated_read: Metric,
    /// Additional same-target request observations in fixed source order, without success claims.
    pub repeated_read_request_count: Option<usize>,
    pub same_request_observation_count: Option<usize>,
    pub recovery_span_sum_ms: Option<u128>,
    pub missing_recovery_span_count: usize,
    pub combined_operation_count: Option<usize>,
    pub combined_union_ms: Option<u64>,
    pub combined_missing_interval_count: usize,
    pub details: Vec<Match>,
    pub detail_limited: bool,
    pub coverage: Coverage,
}
impl Default for Projection {
    fn default() -> Self {
        Self {
            failure_method: FAILURE_METHOD,
            read_method: READ_METHOD,
            computed: false,
            after_failure: Metric::default(),
            repeated_read: Metric::default(),
            repeated_read_request_count: None,
            same_request_observation_count: None,
            recovery_span_sum_ms: None,
            missing_recovery_span_count: 0,
            combined_operation_count: None,
            combined_union_ms: None,
            combined_missing_interval_count: 0,
            details: vec![],
            detail_limited: false,
            coverage: Coverage::default(),
        }
    }
}
#[derive(Clone, Copy, Eq, PartialEq, Ord, PartialOrd)]
struct Chain<'a> {
    scope: Scope<'a>,
    receiver: &'a str,
    file: &'a str,
    generation: &'a str,
    phase: usize,
}
#[derive(Default)]
struct Linked {
    failure: Option<usize>,
    reads: BTreeSet<usize>,
    targets: usize,
    requests: bool,
    same_request: bool,
}

/// Reuses one identity/endpoint pass. O((E + P) log(E + P)) time, O(E + P) space,
/// where P is bounded matching metadata. Any budget failure discards the whole result.
pub(crate) fn project(
    events: &[Arc<Event>],
    controls: &[Arc<Event>],
    phases: &[ResolvedPhase<'_>],
    endpoints: &Endpoints<'_>,
    window: Option<intervals::Window>,
    budget: Budget,
    cancelled: &AtomicBool,
) -> Result<Projection> {
    check(cancelled)?;
    let mut coverage = Coverage {
        missing_identity_records: endpoints
            .missing_identity
            .iter()
            .filter(|&&index| metadata::eligible_kind(phases[index].kind))
            .count(),
        ..Coverage::default()
    };
    let Some(candidates) = metadata::collect(
        events,
        controls,
        phases,
        endpoints,
        budget,
        &mut coverage,
        cancelled,
    )?
    else {
        coverage.budget_exceeded = true;
        coverage.partial = true;
        return Ok(Projection {
            coverage,
            ..Projection::default()
        });
    };
    let mut requests: BTreeMap<(Chain<'_>, &str), Vec<usize>> = BTreeMap::new();
    let mut reads: BTreeMap<(Chain<'_>, &ReadMatchTarget), Vec<usize>> = BTreeMap::new();
    for (index, candidate) in candidates.iter().enumerate() {
        check(cancelled)?;
        let chain = Chain {
            scope: candidate.endpoint.scope,
            receiver: candidate.receiver,
            file: candidate.domain.0,
            generation: candidate.domain.1,
            phase: candidate.phase,
        };
        if let Some(fingerprint) = candidate.fingerprint {
            requests
                .entry((chain, fingerprint))
                .or_default()
                .push(index);
        }
        for target in candidate.targets {
            check(cancelled)?;
            reads.entry((chain, target)).or_default().push(index);
        }
    }
    let mut linked: Vec<Linked> = candidates.iter().map(|_| Linked::default()).collect();
    let mut order_gaps = BTreeSet::new();
    for indices in requests.values() {
        for later in order::observed_repeats(&candidates, indices, cancelled)? {
            linked[later].same_request = true;
        }
        for (later, prior) in order::predecessors(&candidates, indices, &mut order_gaps, cancelled)?
        {
            check(cancelled)?;
            if candidates[prior].failed && candidates[prior].completes_before(&candidates[later]) {
                linked[later].failure = Some(prior);
            }
        }
    }
    for indices in reads.values() {
        for later in order::observed_repeats(&candidates, indices, cancelled)? {
            linked[later].requests = true;
        }
        for (later, prior) in order::successful_reads(&candidates, indices, cancelled)? {
            check(cancelled)?;
            linked[later].reads.insert(prior);
            linked[later].targets += 1;
        }
    }
    coverage.order_gaps = order_gaps.len();
    coverage.partial = coverage.missing_identity_records > 0
        || coverage.excluded_receivers > 0
        || coverage.missing_matching > 0
        || coverage.conflicting > 0
        || coverage.missing_start > 0
        || coverage.indeterminate_outcomes > 0
        || coverage.order_gaps > 0
        || coverage.crossed_context > 0
        || coverage.missing_clock_domain > 0
        || events
            .iter()
            .chain(controls)
            .any(|event| !event.gaps().is_empty());
    coverage.partial |= coverage.source_metadata_gaps > 0 || coverage.duration_conflicts > 0;
    let mut out = Projection {
        computed: true,
        after_failure: Metric::observed(),
        repeated_read: Metric::observed(),
        repeated_read_request_count: Some(0),
        same_request_observation_count: Some(0),
        combined_operation_count: Some(0),
        recovery_span_sum_ms: Some(0),
        coverage,
        ..Projection::default()
    };
    let mut intervals = Vec::new();
    let mut known_recovery = 0;
    for (index, links) in linked.into_iter().enumerate() {
        check(cancelled)?;
        let later = &candidates[index];
        if links.requests {
            *out.repeated_read_request_count.as_mut().unwrap() += 1;
        }
        if links.same_request {
            *out.same_request_observation_count.as_mut().unwrap() += 1;
        }
        if links.failure.is_none() && links.reads.is_empty() {
            continue;
        }
        let recovery = links.failure.and_then(|prior| {
            candidates[prior]
                .endpoint
                .completion_ms
                .zip(later.endpoint.completion_ms)
                .and_then(|(start, end)| metadata::elapsed(start, end))
        });
        if links.failure.is_some() {
            out.after_failure.add(later.duration);
            if let Some(span) = recovery {
                *out.recovery_span_sum_ms.as_mut().unwrap() += u128::from(span);
                known_recovery += 1;
            } else {
                out.missing_recovery_span_count += 1;
            }
        }
        if !links.reads.is_empty() {
            out.repeated_read.add(later.duration);
        }
        *out.combined_operation_count.as_mut().unwrap() += 1;
        if later
            .endpoint
            .start_ms
            .zip(later.endpoint.end_ms)
            .is_none_or(|(start, end)| end < start)
        {
            out.combined_missing_interval_count += 1;
        }
        intervals.push(intervals::LifecycleInterval {
            identity: intervals::Identity {
                source: later.endpoint.scope.source.into(),
                task: later.receiver.into(),
                turn: later.endpoint.scope.turn.unwrap().into(),
                item: later.endpoint.identity.clone(),
            },
            category: intervals::Category::Command,
            start_ms: later.endpoint.start_ms,
            end_ms: later.endpoint.end_ms,
            evidence_ids: later.endpoint.evidence_ids.clone(),
        });
        if !out.detail_limited {
            if out.details.len() == DETAIL_LIMIT {
                out.details.clear();
                out.detail_limited = true;
            } else {
                out.details.push(Match {
                    operation_id: later.endpoint.identity.clone(),
                    after_failure_predecessor: links
                        .failure
                        .map(|prior| candidates[prior].endpoint.identity.clone()),
                    successful_read_predecessors: links
                        .reads
                        .iter()
                        .map(|&prior| candidates[prior].endpoint.identity.clone())
                        .collect(),
                    repeated_read_targets: links.targets,
                    read_layer: (!links.reads.is_empty())
                        .then_some(ReadLayer::SamePathRangeUnconfirmed),
                    later_duration_ms: later.duration.map(|(value, _)| value),
                    duration_is_native: later.duration.is_some_and(|(_, native)| native),
                    recovery_span_ms: recovery,
                });
            }
        }
    }
    if known_recovery == 0 && out.missing_recovery_span_count > 0 {
        out.recovery_span_sum_ms = None;
    }
    out.after_failure.duration.finish();
    out.repeated_read.duration.finish();
    out.combined_union_ms = intervals::analyze_cancellable(
        window,
        &intervals,
        &[],
        budget.operations.min(100_000),
        cancelled,
    )?
    .covered_ms;
    check(cancelled)?;
    Ok(out)
}
#[cfg(test)]
mod tests;
