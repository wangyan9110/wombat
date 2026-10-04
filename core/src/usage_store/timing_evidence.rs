//! Bounded facts for one explicit turn. This is a storage API, not a transport DTO.
//! Existing manifests remain resident; this reader bounds additional facts, encodings
//! and metadata inspections. It never traverses the ledger or unrelated event blocks.
//! Production timing queries use this reader. All three budgets apply simultaneously:
//! reaching fewer than 100,000 facts can exhaust metadata.
//! Bytes include full touched encodings, facts include skipped operations and every
//! event in touched blocks; these limits do not claim a process-wide RAM bound.
use super::*;
use crate::session_events::{Event, Position};
use std::{
    collections::BTreeSet,
    sync::atomic::{AtomicBool, Ordering},
};

pub const MAX_TIMING_FACTS: usize = 100_000;
pub const MAX_TIMING_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_TIMING_METADATA: usize = 100_000;
#[derive(Clone, Copy, Debug)]
pub struct TimingReadBudget {
    pub max_facts: usize,
    pub max_bytes: u64,
    pub max_metadata: usize,
}
impl Default for TimingReadBudget {
    fn default() -> Self {
        Self {
            max_facts: MAX_TIMING_FACTS,
            max_bytes: MAX_TIMING_BYTES,
            max_metadata: MAX_TIMING_METADATA,
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct TurnTarget<'a> {
    pub source: &'a str,
    pub thread: &'a str,
    pub turn: &'a str,
}
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReadCoverage {
    pub facts: usize,
    pub bytes: u64,
    pub metadata: usize,
    pub event_blocks: usize,
}
#[derive(Debug)]
pub struct DomainCoverage<'a> {
    pub file_id: String,
    pub generation: String,
    pub first_offset: u64,
    pub last_offset: u64,
    /// None means no matching per-file observation, never complete coverage.
    pub watermark: Option<&'a SourceWatermark>,
    pub generation_matches: bool,
}
#[derive(Debug)]
pub struct TimingEvidence<'a> {
    pub snapshot_id: &'a str,
    pub thread: &'a Thread,
    pub turn: Option<&'a Turn>,
    /// Existing generic parser capabilities; this does not invent timing support.
    pub source: Option<&'a SourceReport>,
    pub measurements: Vec<Arc<Measurement>>,
    pub events: Vec<Arc<Event>>,
    pub controls: Vec<Arc<Event>>,
    pub domains: Vec<DomainCoverage<'a>>,
    /// Counts of complete attribution buckets, not per-source unassigned counts.
    pub snapshot_unassigned_total: usize,
    pub thread_unassigned_total: usize,
    pub coverage: ReadCoverage,
}
pub(super) struct Meter<'a> {
    limits: TimingReadBudget,
    pub coverage: ReadCoverage,
    pub cancelled: &'a AtomicBool,
    pub failure: Option<&'static str>,
}
impl<'a> Meter<'a> {
    fn new(budget: TimingReadBudget, cancelled: &'a AtomicBool) -> Self {
        Self {
            limits: TimingReadBudget {
                max_facts: budget.max_facts.min(MAX_TIMING_FACTS),
                max_bytes: budget.max_bytes.min(MAX_TIMING_BYTES),
                max_metadata: budget.max_metadata.min(MAX_TIMING_METADATA),
            },
            coverage: ReadCoverage::default(),
            cancelled,
            failure: None,
        }
    }
    pub fn check(&mut self) -> Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            self.failure = Some("CANCELLED");
            return Err(operation_error("CANCELLED", "轮次证据读取已取消"));
        }
        Ok(())
    }
    fn limit(&mut self) -> anyhow::Error {
        self.failure = Some("RESOURCE_LIMIT");
        operation_error("RESOURCE_LIMIT", "轮次证据读取超过资源预算")
    }
    pub fn facts(&mut self, n: usize) -> Result<()> {
        self.check()?;
        if n > self.limits.max_facts.saturating_sub(self.coverage.facts) {
            return Err(self.limit());
        }
        self.coverage.facts += n;
        Ok(())
    }
    pub fn bytes(&mut self, n: u64) -> Result<()> {
        self.check()?;
        if n > self.limits.max_bytes.saturating_sub(self.coverage.bytes) {
            return Err(self.limit());
        }
        self.coverage.bytes += n;
        Ok(())
    }
    pub fn work(&mut self, n: usize) -> Result<()> {
        self.check()?;
        if n > self
            .limits
            .max_metadata
            .saturating_sub(self.coverage.metadata)
        {
            return Err(self.limit());
        }
        self.coverage.metadata += n;
        Ok(())
    }
    fn partition<'s>(
        &mut self,
        snapshot: &'s Snapshot,
        target: &EventTarget,
    ) -> Result<Option<&'s EventPartition>> {
        // Charge the logarithmic search's upper bound, including an empty lookup.
        self.work(
            snapshot
                .manifest
                .events
                .partitions
                .len()
                .checked_ilog2()
                .unwrap_or(0) as usize
                + 1,
        )?;
        snapshot.event_partition(target)
    }
    fn block(
        &mut self,
        snapshot: &Snapshot,
        partition: &EventPartition,
        index: usize,
    ) -> Result<Vec<Arc<Event>>> {
        self.work(1)?;
        let chunk = &partition.chunks[index];
        self.facts(chunk.count)?;
        self.bytes(chunk.bytes)?;
        self.coverage.event_blocks += 1;
        snapshot.event_range(
            partition,
            chunk.offset,
            chunk.count,
            EventReadBudget {
                max_facts: chunk.count,
                max_bytes: chunk.bytes,
            },
            self.cancelled,
        )
    }
}
fn lower_chunk(chunks: &[EventChunk], low: &Position, meter: &mut Meter<'_>) -> Result<usize> {
    let (mut start, mut end) = (0, chunks.len());
    while start < end {
        meter.work(1)?;
        let mid = start + (end - start) / 2;
        if super::events::position_order(&chunks[mid].last, low).is_lt() {
            start = mid + 1;
        } else {
            end = mid;
        }
    }
    Ok(start)
}
impl Snapshot {
    /// Complete exact-turn evidence or an error. Controls are selected by physical
    /// source spans, never nearby times. A shared meter covers all phases.
    pub fn timing_evidence<'a>(
        &'a self,
        target: TurnTarget<'_>,
        budget: TimingReadBudget,
        cancelled: &AtomicBool,
    ) -> Result<TimingEvidence<'a>> {
        let mut meter = Meter::new(budget, cancelled);
        meter.check()?;
        if [target.source, target.thread, target.turn]
            .iter()
            .any(|id| id.is_empty())
        {
            return Err(operation_error("INVALID_ARGUMENT", "轮次证据目标不能为空"));
        }
        let mut owner = None;
        for entry in &self.manifest.threads {
            meter.work(1)?;
            if entry.thread.id == target.thread {
                owner = Some(entry);
                break;
            }
        }
        let owner = owner.ok_or_else(|| operation_error("NOT_FOUND", "未找到对话"))?;
        if owner.thread.source_instance_id != target.source {
            return Err(operation_error("INVALID_ARGUMENT", "轮次来源身份不匹配"));
        }
        meter.work(owner.turns.len().checked_ilog2().unwrap_or(0) as usize + 1)?;
        let turn = owner
            .turns
            .get(target.turn)
            .ok_or_else(|| operation_error("NOT_FOUND", "未找到轮次"))?;
        let exact = meter.partition(self, &EventTarget::turn(target.thread, target.turn))?;
        // This complete bucket's count is already known. Reject before loading
        // measurements or a prefix of a target that cannot fit the fact budget.
        if exact.is_some_and(|partition| partition.count > meter.limits.max_facts) {
            return Err(meter.limit());
        }
        let measurements = self.timing_measurements(owner, turn, target, &mut meter)?;
        let mut events = vec![];
        if let Some(partition) = exact {
            for index in 0..partition.chunks.len() {
                events.extend(meter.block(self, partition, index)?);
            }
        }
        let mut spans = BTreeMap::<(String, String), (u64, u64)>::new();
        for event in &events {
            meter.work(1)?;
            let p = event.position();
            if p.source_instance_id != target.source {
                return Err(corrupt("轮次事件来源身份不匹配"));
            }
            let span = spans
                .entry((p.file_id.clone(), p.generation.clone()))
                .or_insert((p.byte_offset, p.byte_offset));
            span.0 = span.0.min(p.byte_offset);
            span.1 = span.1.max(p.byte_offset);
        }
        let global = meter.partition(
            self,
            &EventTarget {
                thread_id: None,
                turn_id: None,
            },
        )?;
        let unassigned = meter.partition(
            self,
            &EventTarget {
                thread_id: Some(target.thread.into()),
                turn_id: None,
            },
        )?;
        let mut controls = vec![];
        for partition in [global, unassigned].into_iter().flatten() {
            let mut selected = BTreeSet::new();
            for ((file_id, generation), (first, last)) in &spans {
                meter.work(1)?;
                let low = Position {
                    source_instance_id: target.source.into(),
                    file_id: file_id.clone(),
                    generation: generation.clone(),
                    byte_offset: *first,
                    ordinal: 0,
                };
                let high = Position {
                    byte_offset: *last,
                    ordinal: u32::MAX,
                    ..low.clone()
                };
                let start = lower_chunk(&partition.chunks, &low, &mut meter)?;
                for index in start..partition.chunks.len() {
                    meter.work(1)?;
                    if super::events::position_order(&partition.chunks[index].first, &high).is_gt()
                    {
                        break;
                    }
                    selected.insert(index);
                }
            }
            for index in selected {
                for event in meter.block(self, partition, index)? {
                    meter.work(1)?;
                    let p = event.position();
                    if p.source_instance_id == target.source
                        && !event.gaps().is_empty()
                        && spans
                            .get(&(p.file_id.clone(), p.generation.clone()))
                            .is_some_and(|(first, last)| {
                                *first <= p.byte_offset && p.byte_offset <= *last
                            })
                    {
                        controls.push(event);
                    }
                }
            }
        }
        let files: BTreeSet<_> = spans.keys().map(|(file, _)| file.as_str()).collect();
        let mut watermarks = BTreeMap::new();
        for row in &self.manifest.watermarks {
            meter.work(1)?;
            if row.source_instance_id == target.source && files.contains(row.file_id.as_str()) {
                watermarks.insert(row.file_id.as_str(), row);
            }
        }
        let mut domains = vec![];
        for ((file_id, generation), (first_offset, last_offset)) in spans {
            meter.work(1)?;
            let watermark = watermarks.get(file_id.as_str()).copied();
            let generation_matches =
                watermark.is_some_and(|row| row.generation.as_deref() == Some(&generation));
            domains.push(DomainCoverage {
                file_id,
                generation,
                first_offset,
                last_offset,
                watermark,
                generation_matches,
            });
        }
        let mut source = None;
        for row in &self.manifest.sources {
            meter.work(1)?;
            if row.source.id == target.source {
                source = Some(row);
                break;
            }
        }
        meter.check()?;
        Ok(TimingEvidence {
            snapshot_id: &self.manifest.snapshot_ref.snapshot_id,
            thread: &owner.thread,
            turn: turn.turn.as_ref(),
            source,
            measurements,
            events,
            controls,
            domains,
            snapshot_unassigned_total: global.map_or(0, |p| p.count),
            thread_unassigned_total: unassigned.map_or(0, |p| p.count),
            coverage: meter.coverage,
        })
    }
}
#[cfg(test)]
mod tests;
