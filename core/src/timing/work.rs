//! Observed work within an already bounded, exact-turn canonical operation slice.
//! Source completeness never establishes unlogged activity or an entire repository diff.
//! No event pairing, ledger reads, command interpretation or filesystem access occurs here.
use crate::{
    adapters::contract::{
        Operation, SourceReport, Thread, WORK_OBSERVATION_VERSION, WorkData, WorkGap, WorkStage,
    },
    dto::operation_error,
    usage_observations,
};
use anyhow::Result;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

pub(crate) const METHOD_VERSION: u32 = 1;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SourceCoverage {
    Complete,
    Partial,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Basis {
    CanonicalOperationIdentity,
    TerminalOutcome,
    FileOperationIdentity,
    ReportedPathUnion,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Gap {
    MissingIdentity,
    CanonicalConflict,
    UnknownOutcome,
    UnknownOperationKind,
    MissingWorkMetadata,
    NonTerminalFile,
    InvalidFileMetadata,
    MissingChanges,
    ResourceLimit,
    MissingPathScope,
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Count {
    pub value: Option<u64>,
    pub basis: Basis,
    pub gaps: Vec<Gap>,
}
impl Count {
    fn observed(basis: Basis) -> Self {
        Self {
            value: Some(0),
            basis,
            gaps: vec![],
        }
    }
    fn add(&mut self) {
        if let Some(value) = &mut self.value {
            *value += 1;
        }
    }
    fn unknown(&mut self, gap: Gap) {
        self.value = None;
        if !self.gaps.contains(&gap) {
            self.gaps.push(gap);
        }
    }
}
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
pub(crate) struct Input<'a> {
    pub thread: &'a Thread,
    pub turn: &'a str,
    pub source: Option<&'a SourceReport>,
    pub operations: &'a [Arc<Operation>],
    pub budget: Budget,
    pub cancelled: &'a AtomicBool,
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Coverage {
    pub source: SourceCoverage,
    pub records: usize,
    pub excluded_records: usize,
    pub replay_records: usize,
    pub identity_gaps: usize,
    pub canonical_conflicts: usize,
    pub unknown_outcomes: usize,
    pub time_gaps: usize,
    pub unknown_kinds: usize,
    pub file_metadata_gaps: usize,
    pub nonterminal_files: usize,
    pub path_scope_gaps: usize,
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Projection {
    pub method_version: u32,
    pub operation_candidates: Count,
    pub closed_operations: Count,
    pub failed_operations: Count,
    pub file_change_records: Count,
    pub changed_files: Count,
    pub coverage: Coverage,
}
struct Meter<'a> {
    units: usize,
    bytes: usize,
    cancelled: &'a AtomicBool,
}
impl Meter<'_> {
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            Err(operation_error("CANCELLED", "工作观察投影已取消"))
        } else {
            Ok(())
        }
    }
    fn work(&mut self, bytes: usize) -> Result<()> {
        self.check()?;
        self.units = self.units.checked_sub(1).ok_or_else(limit)?;
        self.bytes = self.bytes.checked_sub(bytes).ok_or_else(limit)?;
        Ok(())
    }
}
fn limit() -> anyhow::Error {
    operation_error("RESOURCE_LIMIT", "工作观察投影超过资源预算")
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum Family {
    Execution,
    File,
    Excluded,
    Unknown,
}
fn family(operation: &Operation) -> Family {
    if operation.kind.as_ref() == "skillRead"
        && usage_observations::is_skill_read_candidate(operation)
    {
        return Family::Excluded;
    }
    match operation.kind.as_ref() {
        "file" => Family::File,
        "tool" | "command" | "skillRead" | "mcp" | "mcpTool" | "mcpResource" | "mcpDiscovery"
        | "mcpUnclassified" | "mcpConflict" | "search" | "image" | "agent" => Family::Execution,
        "skillCatalog" | "skillAvailable" | "skillUse" | "instructionLoad" | "compaction" => {
            Family::Excluded
        }
        _ => Family::Unknown,
    }
}
fn outcome(operation: &Operation) -> (Option<bool>, Option<bool>) {
    let failed = operation.exit_code.is_some_and(|code| code != 0);
    match operation.status.as_ref() {
        "failed" | "error" => (Some(true), Some(true)),
        "completed" | "success" => (Some(true), Some(failed)),
        "cancelled" | "interrupted" | "declined" => (Some(true), Some(failed)),
        "running" | "in_progress" => {
            if failed {
                (None, None)
            } else {
                (Some(false), Some(false))
            }
        }
        _ if failed => (None, Some(true)),
        _ => (None, None),
    }
}
struct Group<'a> {
    operation: &'a Operation,
    conflict: bool,
    file_possible: bool,
}
fn same(left: &Operation, right: &Operation) -> bool {
    left.kind == right.kind
        && left.status == right.status
        && left.exit_code == right.exit_code
        && left.outcome_conflict == right.outcome_conflict
        && left.work == right.work
}
fn metadata(operation: &Operation, meter: &mut Meter<'_>) -> Result<()> {
    let Some(work) = &operation.work else {
        return Ok(());
    };
    if work.format_version != WORK_OBSERVATION_VERSION {
        return Err(operation_error(
            "UNSUPPORTED_VERSION",
            "不支持此工作观察元数据版本",
        ));
    }
    meter.work(0)?;
    for _ in &work.gaps {
        meter.work(0)?;
    }
    match &work.data {
        WorkData::FileChange {
            changes: Some(paths),
        } => {
            for path in paths {
                meter.work(path.path.len())?;
                if let Some(moved) = &path.move_path {
                    meter.work(moved.len())?;
                }
            }
        }
        WorkData::Command {
            cwd,
            parsed_commands,
            ..
        } => {
            if let Some(cwd) = cwd {
                meter.work(cwd.len())?;
            }
            if let Some(commands) = parsed_commands {
                for command in commands {
                    meter.work(command.path().map_or(0, str::len))?;
                }
            }
        }
        WorkData::FileChange { changes: None } => {}
    }
    Ok(())
}
fn paths(
    operation: &Operation,
    meter: &mut Meter<'_>,
    projection: &mut Projection,
    out: &mut BTreeSet<PathBuf>,
) -> Result<()> {
    let Some(work) = &operation.work else {
        projection.changed_files.unknown(Gap::MissingWorkMetadata);
        projection.coverage.file_metadata_gaps += 1;
        return Ok(());
    };
    if !work.gaps.is_empty() {
        for gap in &work.gaps {
            projection.changed_files.unknown(match gap {
                WorkGap::ConflictingObservation => Gap::CanonicalConflict,
                WorkGap::ResourceLimit => Gap::ResourceLimit,
                WorkGap::MissingChanges => Gap::MissingChanges,
                WorkGap::UnknownVariant => Gap::UnknownOperationKind,
                _ => Gap::InvalidFileMetadata,
            });
        }
        projection.coverage.file_metadata_gaps += 1;
    }
    if work.stage != WorkStage::Terminal {
        projection.changed_files.unknown(Gap::NonTerminalFile);
        projection.coverage.nonterminal_files += 1;
        return Ok(());
    }
    let WorkData::FileChange {
        changes: Some(paths),
    } = &work.data
    else {
        projection.changed_files.unknown(Gap::MissingWorkMetadata);
        projection.coverage.file_metadata_gaps += 1;
        return Ok(());
    };
    for path in paths {
        for endpoint in [Some(path.path.as_str()), path.move_path.as_deref()]
            .into_iter()
            .flatten()
        {
            meter.work(endpoint.len())?;
            if !crate::adapters::contract::valid_work_path(endpoint) {
                projection.changed_files.unknown(Gap::InvalidFileMetadata);
                projection.coverage.file_metadata_gaps += 1;
                continue;
            }
            if !Path::new(endpoint).is_absolute() {
                projection.changed_files.unknown(Gap::MissingPathScope);
                projection.coverage.path_scope_gaps += 1;
                continue;
            }
            // absolute input: lexical normalization only, never host cwd or current filesystem.
            let normalized = crate::absolute(endpoint)?;
            if !normalized.is_absolute() {
                projection.changed_files.unknown(Gap::MissingPathScope);
                projection.coverage.path_scope_gaps += 1;
                continue;
            }
            meter.work(normalized.as_os_str().len())?;
            out.insert(normalized);
        }
    }
    Ok(())
}
pub(crate) fn project(input: Input<'_>) -> Result<Projection> {
    let mut meter = Meter {
        units: input.budget.metadata.min(100_000),
        bytes: input.budget.string_bytes.min(64 * 1024 * 1024),
        cancelled: input.cancelled,
    };
    meter.check()?;
    if input.thread.id.is_empty()
        || input.thread.source_instance_id.is_empty()
        || input.turn.is_empty()
        || input
            .source
            .is_some_and(|source| source.source.id != input.thread.source_instance_id)
    {
        return Err(operation_error(
            "INVALID_ARGUMENT",
            "工作观察投影目标身份无效",
        ));
    }
    if input.operations.len() > input.budget.operations.min(100_000) {
        return Err(limit());
    }
    meter.work(
        input
            .thread
            .id
            .len()
            .saturating_add(input.thread.source_instance_id.len())
            .saturating_add(input.turn.len()),
    )?;
    let source = match input.source {
        Some(source) if source.status == "complete" && source.issues.is_empty() => {
            SourceCoverage::Complete
        }
        Some(_) => SourceCoverage::Partial,
        None => SourceCoverage::Unknown,
    };
    let mut result = Projection {
        method_version: METHOD_VERSION,
        operation_candidates: Count::observed(Basis::CanonicalOperationIdentity),
        closed_operations: Count::observed(Basis::TerminalOutcome),
        failed_operations: Count::observed(Basis::TerminalOutcome),
        file_change_records: Count::observed(Basis::FileOperationIdentity),
        changed_files: Count::observed(Basis::ReportedPathUnion),
        coverage: Coverage {
            source,
            records: input.operations.len(),
            excluded_records: 0,
            replay_records: 0,
            identity_gaps: 0,
            canonical_conflicts: 0,
            unknown_outcomes: 0,
            time_gaps: 0,
            unknown_kinds: 0,
            file_metadata_gaps: 0,
            nonterminal_files: 0,
            path_scope_gaps: 0,
        },
    };
    let mut groups: BTreeMap<(&str, &str), Group<'_>> = BTreeMap::new();
    for operation in input.operations {
        meter.work(
            operation
                .id
                .len()
                .saturating_add(operation.thread_id.len())
                .saturating_add(operation.kind.len())
                .saturating_add(operation.status.len())
                .saturating_add(operation.turn_id.as_deref().map_or(0, str::len))
                .saturating_add(operation.timestamp.as_deref().map_or(0, str::len)),
        )?;
        if operation.thread_id.as_ref() != input.thread.id
            || operation.turn_id.as_deref() != Some(input.turn)
        {
            return Err(operation_error(
                "INVALID_ARGUMENT",
                "工作观察操作归属不匹配",
            ));
        }
        if family(operation) == Family::Excluded {
            result.coverage.excluded_records += 1;
            continue;
        }
        for id in [operation.call_id.as_deref(), operation.item_id.as_deref()]
            .into_iter()
            .flatten()
        {
            meter.work(id.len())?;
        }
        metadata(operation, &mut meter)?;
        if usage_observations::time_basis(operation) == usage_observations::TimeBasis::Unknown {
            result.coverage.time_gaps += 1;
        }
        let Some(identity) = usage_observations::operation_identity(operation) else {
            result.coverage.identity_gaps += 1;
            result.operation_candidates.unknown(Gap::MissingIdentity);
            result.closed_operations.unknown(Gap::MissingIdentity);
            result.failed_operations.unknown(Gap::MissingIdentity);
            if matches!(family(operation), Family::File | Family::Unknown) {
                result.file_change_records.unknown(Gap::MissingIdentity);
                result.changed_files.unknown(Gap::MissingIdentity);
            }
            continue;
        };
        match groups.entry(identity) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(Group {
                    operation,
                    conflict: false,
                    file_possible: matches!(family(operation), Family::File | Family::Unknown),
                });
            }
            std::collections::btree_map::Entry::Occupied(mut entry) => {
                result.coverage.replay_records += 1;
                entry.get_mut().file_possible |=
                    matches!(family(operation), Family::File | Family::Unknown);
                if !same(entry.get().operation, operation) {
                    entry.get_mut().conflict = true;
                }
            }
        }
    }
    let mut distinct = BTreeSet::new();
    for group in groups.into_values() {
        meter.check()?;
        let op = group.operation;
        let kind = family(op);
        if group.conflict {
            result.coverage.canonical_conflicts += 1;
            result.operation_candidates.unknown(Gap::CanonicalConflict);
            result.closed_operations.unknown(Gap::CanonicalConflict);
            result.failed_operations.unknown(Gap::CanonicalConflict);
            if group.file_possible {
                result.file_change_records.unknown(Gap::CanonicalConflict);
                result.changed_files.unknown(Gap::CanonicalConflict);
            }
            continue;
        }
        if kind == Family::Unknown {
            result.coverage.unknown_kinds += 1;
            result
                .operation_candidates
                .unknown(Gap::UnknownOperationKind);
            result.closed_operations.unknown(Gap::UnknownOperationKind);
            result.failed_operations.unknown(Gap::UnknownOperationKind);
            result
                .file_change_records
                .unknown(Gap::UnknownOperationKind);
            result.changed_files.unknown(Gap::UnknownOperationKind);
            continue;
        }
        result.operation_candidates.add();
        let (closed, failed) = outcome(op);
        if closed.is_none() || failed.is_none() {
            result.coverage.unknown_outcomes += 1;
        }
        match closed {
            Some(true) => result.closed_operations.add(),
            Some(false) => {}
            None => result.closed_operations.unknown(Gap::UnknownOutcome),
        }
        match failed {
            Some(true) => result.failed_operations.add(),
            Some(false) => {}
            None => result.failed_operations.unknown(Gap::UnknownOutcome),
        }
        if kind == Family::File {
            result.file_change_records.add();
            paths(op, &mut meter, &mut result, &mut distinct)?;
        }
    }
    meter.check()?;
    if result.changed_files.value.is_some() {
        result.changed_files.value = Some(distinct.len() as u64);
    }
    Ok(result)
}

#[cfg(test)]
mod tests;
