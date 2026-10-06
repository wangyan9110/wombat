//! First/last request-input changes in evidence-established historical stages.
//! Source order is observation order, not execution order or active occupancy.
use super::{Associated, check};
use std::{collections::BTreeMap, sync::atomic::AtomicBool};

pub const DETAIL_LIMIT: usize = 32;
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ChangeStatistics {
    pub candidates: usize,
    pub ordered_samples: usize,
    pub non_request_scoped: usize,
    pub missing_input: usize,
    pub unassociated: usize,
    pub numeric_range: usize,
    pub comparable_stages: usize,
    pub increasing_stages: usize,
    pub decreasing_stages: usize,
    pub unchanged_stages: usize,
    pub largest_increase: Option<Change>,
    pub stages: Vec<Change>,
    pub details_omitted: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct Change {
    pub stage: u64,
    pub samples: usize,
    pub first_ref: String,
    pub last_ref: String,
    pub first_input: u64,
    pub last_input: u64,
    pub delta: i64,
    /// A zero baseline has no finite multiplicative factor.
    pub factor: Option<f64>,
}
struct Endpoints<'a> {
    first: &'a Associated<'a>,
    last: &'a Associated<'a>,
    samples: usize,
}
pub(super) fn summarize(
    entries: &[Associated<'_>],
    cancelled: &AtomicBool,
) -> anyhow::Result<ChangeStatistics> {
    let mut result = ChangeStatistics {
        candidates: entries.len(),
        ..Default::default()
    };
    let mut stages: BTreeMap<u64, Endpoints<'_>> = BTreeMap::new();
    for entry in entries {
        check(cancelled)?;
        if !entry.measurement.request_scoped {
            result.non_request_scoped += 1;
            continue;
        }
        let Some(input) = entry.measurement.tokens.raw_input else {
            result.missing_input += 1;
            continue;
        };
        if input > crate::timing_dto::MAX_SAFE_INTEGER {
            result.numeric_range += 1;
            continue;
        }
        let Some(stage) = entry.change_stage else {
            result.unassociated += 1;
            continue;
        };
        result.ordered_samples += 1;
        let endpoints = stages.entry(stage).or_insert(Endpoints {
            first: entry,
            last: entry,
            samples: 0,
        });
        endpoints.samples += 1;
        if entry
            .position
            .expect("associated stage has a source position")
            .byte_offset
            < endpoints.first.position.unwrap().byte_offset
        {
            endpoints.first = entry;
        }
        if entry
            .position
            .expect("associated stage has a source position")
            .byte_offset
            > endpoints.last.position.unwrap().byte_offset
        {
            endpoints.last = entry;
        }
    }
    for (stage, endpoints) in stages {
        check(cancelled)?;
        if endpoints.samples < 2 {
            continue;
        }
        let first = endpoints.first.measurement.tokens.raw_input.unwrap();
        let last = endpoints.last.measurement.tokens.raw_input.unwrap();
        // Each endpoint is bounded to the safe integer range, hence so is its difference.
        let delta = last as i64 - first as i64;
        let change = Change {
            stage,
            samples: endpoints.samples,
            first_ref: endpoints.first.measurement.id.clone(),
            last_ref: endpoints.last.measurement.id.clone(),
            first_input: first,
            last_input: last,
            delta,
            factor: (first > 0).then(|| last as f64 / first as f64),
        };
        result.comparable_stages += 1;
        match delta.cmp(&0) {
            std::cmp::Ordering::Greater => {
                result.increasing_stages += 1;
                if result
                    .largest_increase
                    .as_ref()
                    .is_none_or(|old| delta > old.delta)
                {
                    result.largest_increase = Some(change.clone());
                }
            }
            std::cmp::Ordering::Less => result.decreasing_stages += 1,
            std::cmp::Ordering::Equal => result.unchanged_stages += 1,
        }
        if result.stages.len() < DETAIL_LIMIT {
            result.stages.push(change);
        } else {
            result.details_omitted = true;
        }
    }
    check(cancelled)?;
    Ok(result)
}
