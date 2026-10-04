//! Pure, identity-bound interval coverage; response proxies never cover unknown time.
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Window {
    pub start_ms: i64,
    pub end_ms: i64,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Identity {
    pub source: String,
    pub task: String,
    pub turn: String,
    pub item: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Category {
    Command,
    Compaction,
    Reasoning,
}
impl Category {
    fn index(self) -> usize {
        match self {
            Self::Command => 0,
            Self::Compaction => 1,
            Self::Reasoning => 2,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LifecycleInterval {
    pub identity: Identity,
    pub category: Category,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Issue {
    InvalidWindow,
    ResourceLimit,
    Conflict(Identity),
    Open(Identity),
    Reversed(Identity),
    Clipped(Identity),
    InvalidGap,
}

/// Coverage arrays represent durations only when `observed_window_ms` is `Some` and `partial` is false.
#[derive(Debug, PartialEq)]
pub struct IntervalMetrics {
    pub observed_window_ms: Option<u64>,
    pub category_union_ms: [u64; 3],
    pub category_sum_ms: [u128; 3],
    /// Bit 0 command, bit 1 compaction, bit 2 reasoning; 0 is unknown.
    pub mask_ms: [u64; 8],
    pub covered_ms: Option<u64>,
    pub unclassified_ms: Option<u64>,
    pub coverage_ratio: Option<f64>,
    pub gap_union_ms: u64,
    pub gap_intersection_mask_ms: [u64; 8],
    pub candidates: [usize; 3],
    pub complete_intervals: [usize; 3],
    pub partial: bool,
    pub issues: Vec<Issue>,
}

fn length(window: Window) -> u64 {
    (i128::from(window.end_ms) - i128::from(window.start_ms)) as u64
}
fn clip(interval: Window, window: Window) -> Option<Window> {
    let clipped = Window {
        start_ms: interval.start_ms.max(window.start_ms),
        end_ms: interval.end_ms.min(window.end_ms),
    };
    (clipped.start_ms < clipped.end_ms).then_some(clipped)
}

/// Budget counts all supplied lifecycle records and gap records, including duplicates.
/// An exceeded budget returns no coverage instead of selecting an order-dependent subset.
/// Inputs must already belong to the requested explicit target; identities are not guessed.
pub fn analyze(
    window: Option<Window>,
    intervals: &[LifecycleInterval],
    gaps: &[Window],
    budget: usize,
) -> IntervalMetrics {
    let mut result = IntervalMetrics {
        observed_window_ms: None,
        category_union_ms: [0; 3],
        category_sum_ms: [0; 3],
        mask_ms: [0; 8],
        covered_ms: None,
        unclassified_ms: None,
        coverage_ratio: None,
        gap_union_ms: 0,
        gap_intersection_mask_ms: [0; 8],
        candidates: [0; 3],
        complete_intervals: [0; 3],
        partial: false,
        issues: Vec::new(),
    };
    let usable_window = window.filter(|window| window.end_ms >= window.start_ms);
    if window.is_some() && usable_window.is_none() {
        result.issues.push(Issue::InvalidWindow);
    }
    result.observed_window_ms = usable_window.map(length);
    if intervals
        .len()
        .checked_add(gaps.len())
        .is_none_or(|n| n > budget)
    {
        result.partial = true;
        result.issues.push(Issue::ResourceLimit);
        return result;
    }
    let mut unique: BTreeMap<&Identity, Option<&LifecycleInterval>> = BTreeMap::new();
    for interval in intervals {
        result.candidates[interval.category.index()] += 1;
        unique
            .entry(&interval.identity)
            .and_modify(|previous| {
                if previous.is_some_and(|value| value != interval) {
                    *previous = None;
                }
            })
            .or_insert(Some(interval));
    }
    let mut endpoints: BTreeMap<i64, [i64; 4]> = BTreeMap::new();
    if let Some(window) = usable_window {
        endpoints.entry(window.start_ms).or_default();
        endpoints.entry(window.end_ms).or_default();
    }
    for (identity, interval) in unique {
        let Some(interval) = interval else {
            result.issues.push(Issue::Conflict(identity.clone()));
            continue;
        };
        let (Some(start_ms), Some(end_ms)) = (interval.start_ms, interval.end_ms) else {
            result.issues.push(Issue::Open(identity.clone()));
            continue;
        };
        if end_ms < start_ms {
            result.issues.push(Issue::Reversed(identity.clone()));
            continue;
        }
        let category = interval.category.index();
        result.complete_intervals[category] += 1;
        let Some(window) = usable_window else {
            continue;
        };
        let raw = Window { start_ms, end_ms };
        if start_ms < window.start_ms || end_ms > window.end_ms {
            result.issues.push(Issue::Clipped(identity.clone()));
        }
        if let Some(value) = clip(raw, window) {
            result.category_sum_ms[category] += u128::from(length(value));
            endpoints.entry(value.start_ms).or_default()[category] += 1;
            endpoints.entry(value.end_ms).or_default()[category] -= 1;
        }
    }
    for gap in gaps {
        if gap.end_ms < gap.start_ms {
            result.issues.push(Issue::InvalidGap);
        } else if let Some(value) = usable_window.and_then(|window| clip(*gap, window)) {
            endpoints.entry(value.start_ms).or_default()[3] += 1;
            endpoints.entry(value.end_ms).or_default()[3] -= 1;
        }
    }
    let Some(window) = usable_window else {
        return result;
    };
    let mut active = [0_i64; 4];
    let mut previous = window.start_ms;
    for (time, changes) in endpoints {
        let duration = length(Window {
            start_ms: previous,
            end_ms: time,
        });
        let mut mask = 0;
        for (index, count) in active[..3].iter().enumerate() {
            if *count > 0 {
                mask |= 1 << index;
                result.category_union_ms[index] += duration;
            }
        }
        result.mask_ms[mask] += duration;
        if active[3] > 0 {
            result.gap_union_ms += duration;
            result.gap_intersection_mask_ms[mask] += duration;
        }
        for (count, change) in active.iter_mut().zip(changes) {
            *count += change;
        }
        previous = time;
    }
    let observed = length(window);
    let covered = observed - result.mask_ms[0];
    result.covered_ms = Some(covered);
    result.unclassified_ms = Some(result.mask_ms[0]);
    result.coverage_ratio = (observed != 0).then(|| covered as f64 / observed as f64);
    result
}

#[cfg(test)]
mod tests;
