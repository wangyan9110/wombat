//! Local predecessor navigation reuses domain-selected witnesses and exact event order.
use super::*;
use crate::timing::repeats::{DETAIL_LIMIT, PROOF_LIMIT, PROOF_REF_LIMIT, Projection};
use std::collections::{BTreeMap, BTreeSet};
const PAGE_ROWS: usize = 200;
pub(super) fn unavailable(candidate: Count, reason: Basis) -> RepeatPages {
    RepeatPages {
        detail: m::capability(Support::Unavailable, reason),
        candidate_operation_count: candidate,
        located_operation_count: m::unavailable(reason),
        page_count: m::unavailable(reason),
        limit_bytes: navigation::LIMIT_BYTES,
        entries: vec![],
    }
}
pub(super) fn omit(result: &mut RepeatPages, reason: Basis) {
    result.entries.clear();
    result.detail = m::capability(Support::Unavailable, reason);
}
pub(super) fn build(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    projection: &Projection,
    events: Option<&[Arc<Event>]>,
    fallback: Option<Basis>,
    cancelled: &AtomicBool,
) -> Result<RepeatPages> {
    build_budget(
        snapshot,
        target,
        projection,
        events,
        fallback,
        navigation::LIMIT_BYTES,
        cancelled,
    )
}
fn proof(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    alias: String,
    refs: &[String],
    selected: &BTreeMap<&str, Option<usize>>,
    cancelled: &AtomicBool,
) -> Result<RepeatProof> {
    let mut groups = BTreeMap::<usize, Vec<String>>::new();
    for id in refs {
        check(cancelled)?;
        let offset = selected[id.as_str()].ok_or_else(navigation::corrupt)?;
        groups
            .entry(offset / PAGE_ROWS * PAGE_ROWS)
            .or_default()
            .push(format!("event:{id}"));
    }
    let pages = groups
        .into_iter()
        .map(|(offset, evidence_refs)| {
            Ok(RepeatEvidencePage {
                cursor: navigation::cursor(snapshot, target, offset, cancelled)?,
                limit: PAGE_ROWS,
                evidence_refs,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(RepeatProof {
        operation_alias: alias,
        pages,
    })
}
#[allow(clippy::too_many_arguments)]
pub(super) fn build_budget(
    snapshot: &Snapshot,
    target: TurnTarget<'_>,
    projection: &Projection,
    events: Option<&[Arc<Event>]>,
    fallback: Option<Basis>,
    limit_bytes: usize,
    cancelled: &AtomicBool,
) -> Result<RepeatPages> {
    check(cancelled)?;
    let candidate = m::count(
        projection.combined_operation_count.map(|v| v as u128),
        Basis::CanonicalOperationIdentity,
        &[],
    );
    let Some(events) = events.filter(|_| projection.computed) else {
        return Ok(unavailable(
            candidate,
            fallback.unwrap_or(Basis::NotRecorded),
        ));
    };
    if projection.detail_limited || projection.details.len() > DETAIL_LIMIT {
        return Ok(unavailable(candidate, Basis::ResourceLimit));
    }
    if projection.details.is_empty() {
        let mut result = unavailable(candidate, Basis::NoCandidates);
        result.located_operation_count = navigation::observed(0);
        result.page_count = navigation::observed(0);
        return Ok(result);
    }
    let mut selected = BTreeMap::new();
    let mut proofs = 0;
    for entry in &projection.details {
        check(cancelled)?;
        for refs in std::iter::once(&entry.later_evidence)
            .chain(entry.after_failure_evidence.iter())
            .chain(entry.successful_read_evidence.iter())
        {
            proofs += 1;
            if proofs > PROOF_LIMIT || refs.len() > PROOF_REF_LIMIT {
                return Ok(unavailable(candidate, Basis::ResourceLimit));
            }
            if refs.is_empty() {
                return Err(navigation::corrupt());
            }
            let mut unique = BTreeSet::new();
            for id in refs {
                if !unique.insert(id) {
                    return Err(navigation::corrupt());
                }
                selected.entry(id.as_str()).or_insert(None);
            }
        }
    }
    navigation::locate(events, target, &mut selected, cancelled)?;
    let total_pages = projection
        .details
        .iter()
        .flat_map(|entry| {
            std::iter::once(&entry.later_evidence)
                .chain(entry.after_failure_evidence.iter())
                .chain(entry.successful_read_evidence.iter())
        })
        .map(|refs| {
            refs.iter()
                .map(|id| selected[id.as_str()].unwrap() / PAGE_ROWS)
                .collect::<BTreeSet<_>>()
                .len()
        })
        .sum();
    let mut result = RepeatPages {
        detail: m::capability(Support::Supported, Basis::ExactEventPage),
        candidate_operation_count: candidate,
        located_operation_count: navigation::observed(projection.details.len()),
        page_count: navigation::observed(total_pages),
        limit_bytes: navigation::LIMIT_BYTES,
        entries: vec![],
    };
    for (index, entry) in projection.details.iter().enumerate() {
        check(cancelled)?;
        let made: Result<RepeatEvidenceEntry> = (|| {
            let later = proof(
                snapshot,
                target,
                format!("repeat:{index}:later"),
                &entry.later_evidence,
                &selected,
                cancelled,
            )?;
            let after_failure = entry
                .after_failure_evidence
                .as_ref()
                .map(|refs| {
                    proof(
                        snapshot,
                        target,
                        format!("repeat:{index}:failure"),
                        refs,
                        &selected,
                        cancelled,
                    )
                })
                .transpose()?;
            let successful_reads = entry
                .successful_read_evidence
                .iter()
                .enumerate()
                .map(|(prior, refs)| {
                    proof(
                        snapshot,
                        target,
                        format!("repeat:{index}:read:{prior}"),
                        refs,
                        &selected,
                        cancelled,
                    )
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(RepeatEvidenceEntry {
                later,
                after_failure,
                successful_reads,
                repeated_read_target_count: entry.repeated_read_targets as u64,
                later_duration_ms: m::count(
                    entry.later_duration_ms.map(u128::from),
                    if entry.later_duration_ms.is_none() {
                        Basis::NotRecorded
                    } else if entry.duration_is_native {
                        Basis::NativeRecord
                    } else {
                        Basis::ExplicitBoundary
                    },
                    &[],
                ),
                recovery_span_ms: m::count(
                    entry.recovery_span_ms.map(u128::from),
                    if entry.recovery_span_ms.is_some() {
                        Basis::FailureRecoverySpan
                    } else {
                        Basis::NotRecorded
                    },
                    &[],
                ),
            })
        })();
        let item = match made {
            Ok(item) => item,
            Err(error)
                if error
                    .downcast_ref::<crate::dto::OperationError>()
                    .is_some_and(|e| e.code == "RESOURCE_LIMIT") =>
            {
                omit(&mut result, Basis::ResourceLimit);
                return Ok(result);
            }
            Err(error) => return Err(error),
        };
        result.entries.push(item);
        if navigation::size(&result, cancelled)?.is_none_or(|n| n > limit_bytes) {
            omit(&mut result, Basis::ResourceLimit);
            return Ok(result);
        }
    }
    Ok(result)
}
