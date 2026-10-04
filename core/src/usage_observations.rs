//! Per-object use projections over authoritative, reconciled source operations.
//!
//! Adapters own call/result aliases and explicit fork inheritance. This projection
//! neither pairs log records nor guesses operation identity from paths or time.
use crate::adapters::contract::Operation;
use std::{collections::BTreeSet, path::Path};

pub(crate) const METHOD_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum UseKind {
    SkillRead,
    McpTool,
    McpResource,
}

/// Catalogs, declarations, discovery and unresolved MCP identities are not uses.
pub(crate) fn use_kind(operation: &Operation) -> Option<UseKind> {
    if is_skill_read_candidate(operation) {
        return None;
    }
    match operation.kind.as_ref() {
        "skillRead" => Some(UseKind::SkillRead),
        "tool"
            if operation.name.as_ref() == "read_file"
                && operation.path.as_deref().is_some_and(is_skill_file) =>
        {
            Some(UseKind::SkillRead)
        }
        "mcpTool" => Some(UseKind::McpTool),
        "mcpResource" => Some(UseKind::McpResource),
        _ => None,
    }
}

pub(crate) fn is_skill_file(path: &str) -> bool {
    Path::new(path)
        .file_name()
        .is_some_and(|name| name == "SKILL.md")
}

/// Completion of a legacy exec wrapper does not establish dispatch of a read
/// whose command was only extracted from a literal in the wrapper's input.
pub(crate) fn is_skill_read_candidate(operation: &Operation) -> bool {
    operation.kind.as_ref() == "skillRead" && operation.name.as_ref() == "read_skill_file"
}

/// Operation currently stores the earliest observed source time. It does not
/// distinguish a dispatch from a result-only timestamp.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TimeBasis {
    SourceOperationTime,
    Unknown,
}

pub(crate) fn time_basis(operation: &Operation) -> TimeBasis {
    if operation
        .timestamp
        .as_deref()
        .is_some_and(|timestamp| chrono::DateTime::parse_from_rfc3339(timestamp).is_ok())
    {
        TimeBasis::SourceOperationTime
    } else {
        TimeBasis::Unknown
    }
}

#[derive(Debug, Default, Eq, PartialEq)]
pub(crate) struct Coverage {
    pub dispatch_gaps: usize,
    pub identity_gaps: usize,
    pub target_gaps: usize,
    pub time_gaps: usize,
    pub turn_gaps: usize,
}

/// Business identity has already been reconciled by the adapter. A physical
/// record hash alone cannot establish a distinct dispatch, read or retry.
pub(crate) fn operation_identity(operation: &Operation) -> Option<(&str, &str)> {
    (!operation.thread_id.is_empty()
        && !operation.id.is_empty()
        && [operation.call_id.as_deref(), operation.item_id.as_deref()]
            .into_iter()
            .flatten()
            .any(|identity| !identity.is_empty()))
    .then_some((operation.thread_id.as_ref(), operation.id.as_str()))
}

/// A projection belongs to one resolved object; the object is implicitly part
/// of every key. Space is O(observed operations + related turns/tasks).
#[derive(Debug, Default)]
pub(crate) struct Projection {
    operations: BTreeSet<(String, String)>,
    related_turns: BTreeSet<(String, String)>,
    related_tasks: BTreeSet<String>,
    pub coverage: Coverage,
}

impl Projection {
    /// Outcomes never subtract dispatched uses. Reliable source identities are
    /// already canonicalized; independent retries retain independent IDs.
    pub(crate) fn observe(&mut self, operation: &Operation) {
        if let Some((thread, id)) = operation_identity(operation) {
            self.operations.insert((thread.to_owned(), id.to_owned()));
        } else {
            self.coverage.identity_gaps += 1;
        }
        self.related_tasks.insert(operation.thread_id.to_string());
        if let Some(turn) = operation.turn_id.as_deref().filter(|turn| !turn.is_empty()) {
            self.related_turns
                .insert((operation.thread_id.to_string(), turn.to_owned()));
        } else {
            self.coverage.turn_gaps += 1;
        }
        if time_basis(operation) == TimeBasis::Unknown {
            self.coverage.time_gaps += 1;
        }
    }

    /// Missing timestamps affect date-window membership, not a known all-time
    /// operation identity. Time coverage stays visible in either case.
    pub(crate) fn count(&self, time_filtered: bool) -> Option<u64> {
        (self.coverage.dispatch_gaps == 0
            && self.coverage.identity_gaps == 0
            && self.coverage.target_gaps == 0
            && (!time_filtered || self.coverage.time_gaps == 0))
            .then_some(self.operations.len() as u64)
    }

    pub(crate) fn related_turns(&self) -> usize {
        self.related_turns.len()
    }

    pub(crate) fn related_tasks(&self) -> usize {
        self.related_tasks.len()
    }
}

#[cfg(test)]
mod tests;
