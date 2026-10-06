//! Proven nearest dispatch under partial timestamps; physical completion order is insufficient.
use super::{metadata::Candidate, *};
/// Source order selects which request to label as additional; it does not prove execution order.
pub(super) fn observed_repeats(
    candidates: &[Candidate<'_, '_>],
    indices: &[usize],
    cancelled: &AtomicBool,
) -> Result<Vec<usize>> {
    check(cancelled)?;
    let mut ordered = indices.to_vec();
    ordered.sort_unstable_by_key(|&index| (candidates[index].physical_order, index));
    check(cancelled)?;
    Ok(ordered.into_iter().skip(1).collect())
}
pub(super) fn predecessors(
    candidates: &[Candidate<'_, '_>],
    indices: &[usize],
    gaps: &mut BTreeSet<usize>,
    cancelled: &AtomicBool,
) -> Result<Vec<(usize, usize)>> {
    let mut known = Vec::new();
    let mut unknown = Vec::new();
    let mut maximum_unknown_end = None;
    let mut open_unknown = false;
    for &index in indices {
        check(cancelled)?;
        let endpoint = candidates[index].endpoint;
        if let Some(start) = endpoint.start_ms {
            known.push((start, index));
        } else {
            unknown.push(index);
            if let Some(end) = endpoint.completion_ms {
                maximum_unknown_end =
                    Some(maximum_unknown_end.map_or(end, |previous: i64| previous.max(end)));
            } else {
                open_unknown = true;
            }
        }
    }
    check(cancelled)?;
    known.sort_unstable();
    check(cancelled)?;
    let mut out = Vec::new();
    let mut prior_group = &[][..];
    let mut cursor = 0;
    while cursor < known.len() {
        check(cancelled)?;
        let end = cursor + known[cursor..].partition_point(|(time, _)| *time == known[cursor].0);
        let current = &known[cursor..end];
        if current.len() != 1 {
            gaps.extend(current.iter().map(|(_, index)| *index));
        } else {
            let (start, later) = current[0];
            if prior_group.len() == 1 {
                let (prior_start, prior) = prior_group[0];
                // An untimed dispatch ending after the known predecessor may be nearer.
                if !open_unknown && maximum_unknown_end.is_none_or(|end| end <= prior_start) {
                    out.push((later, prior));
                } else {
                    gaps.insert(later);
                }
            } else if prior_group.is_empty()
                && unknown.len() == 1
                && !open_unknown
                && maximum_unknown_end.is_some_and(|end| end <= start)
            {
                out.push((later, unknown[0]));
            } else if !prior_group.is_empty() || !unknown.is_empty() {
                gaps.insert(later);
            }
        }
        prior_group = current;
        cursor = end;
    }
    Ok(out)
}
/// Any prior successful same-target completion establishes the path layer. An intervening
/// failed/indeterminate request cannot erase that observation or prove identical content.
pub(super) fn successful_reads(
    candidates: &[Candidate<'_, '_>],
    indices: &[usize],
    cancelled: &AtomicBool,
) -> Result<Vec<(usize, usize)>> {
    let mut successes = Vec::new();
    for &index in indices {
        check(cancelled)?;
        if candidates[index].succeeded
            && let Some(end) = candidates[index].endpoint.completion_ms
        {
            successes.push((end, candidates[index].physical_order, index));
        }
    }
    check(cancelled)?;
    successes.sort_unstable();
    check(cancelled)?;
    let mut out = Vec::new();
    for &later in indices {
        check(cancelled)?;
        let Some(start) = candidates[later].endpoint.start_ms else {
            continue;
        };
        let upper = successes.partition_point(|(end, position, _)| {
            *end < start || (*end == start && *position < candidates[later].physical_order)
        });
        if upper > 0 {
            out.push((later, successes[upper - 1].2));
        }
    }
    Ok(out)
}
