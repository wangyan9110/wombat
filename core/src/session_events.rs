//! Safe, versioned source facts. Source bodies cannot be represented in this model.
//! Storage and projections share these identities; public query DTOs remain separate.
use crate::adapters::contract::{
    EvidenceRef, MAX_SAFE_INTEGER, Measurement, Operation, Thread, Turn,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub const EVENT_VERSION: u32 = 1;

/// A generation belongs to one physical source file, not to an entire source root.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Position {
    pub source_instance_id: String,
    pub file_id: String,
    pub generation: String,
    pub byte_offset: u64,
    pub ordinal: u32,
}
impl Position {
    pub fn event_id(&self) -> Result<String> {
        ensure!(
            !self.source_instance_id.is_empty()
                && !self.file_id.is_empty()
                && !self.generation.is_empty(),
            "event source identity is incomplete"
        );
        // Structured encoding keeps delimiter characters in native identities unambiguous.
        Ok(crate::hash(serde_json::to_vec(self)?))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Precision {
    Second,
    Millisecond,
    Microsecond,
    Nanosecond,
    Unknown,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Time {
    pub timestamp: Option<String>,
    pub precision: Precision,
}
impl Time {
    /// Invalid timestamps are an explicit gap; they never discard an otherwise valid fact.
    pub fn from_source(value: Option<&str>) -> (Self, Option<Gap>) {
        let parsed = value.and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok());
        let Some(parsed) = parsed else {
            return (
                Self {
                    timestamp: None,
                    precision: Precision::Unknown,
                },
                value.map(|_| Gap::InvalidTimestamp),
            );
        };
        let digits = value
            .and_then(|text| text.split_once('.'))
            .map_or(0, |(_, tail)| {
                tail.chars().take_while(char::is_ascii_digit).count()
            });
        let precision = match digits {
            0 => Precision::Second,
            1..=3 => Precision::Millisecond,
            4..=6 => Precision::Microsecond,
            _ => Precision::Nanosecond,
        };
        (
            Self {
                timestamp: Some(
                    parsed
                        .to_utc()
                        .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true),
                ),
                precision,
            },
            None,
        )
    }
    fn validate(&self) -> Result<()> {
        if let Some(time) = &self.timestamp {
            ensure!(
                chrono::DateTime::parse_from_rfc3339(time).is_ok(),
                "invalid event timestamp"
            );
            ensure!(
                self.precision != Precision::Unknown,
                "known timestamp needs precision"
            );
        } else {
            ensure!(
                self.precision == Precision::Unknown,
                "missing timestamp cannot have precision"
            );
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Gap {
    InvalidTimestamp,
    InvalidNativeField,
    MissingIdentity,
    ConflictingIdentity,
    UnmatchedBoundary,
    SourcePartial,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Started,
    Progress,
    Completed,
    Failed,
    Cancelled,
    Unknown,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleKind {
    Turn,
    ModelRequest,
    Compaction,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Assistant,
    Reasoning,
    Tool,
}

/// Source-backed provenance only; an unclassified user record is not authorization.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageOrigin {
    AssistantVisible,
    UserInput,
    UserUnclassified,
    InjectedContext,
    Reasoning,
    InterAgent,
    Inherited,
    Compaction,
    Unknown,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContentPresence {
    NonEmpty,
    Empty,
    Unknown,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MessageRecordKind {
    LegacySnapshot,
    ResponseSnapshot,
    NativeSnapshot,
    Delta,
    Unknown,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContentPhase {
    Commentary,
    FinalAnswer,
    Unknown,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Assistant,
    Reasoning,
    User,
    Command,
    File,
    Mcp,
    Tool,
    Compaction,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativeDuration {
    pub secs: u64,
    pub nanos: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Payload {
    Ancestry {
        parent_id: String,
        evidence: EvidenceRef,
    },
    Thread {
        value: Thread,
        project_path: Option<String>,
        evidence: EvidenceRef,
    },
    Turn {
        value: Turn,
        evidence: EvidenceRef,
    },
    /// Preserve source accounting inputs before cross-file deduplication and reconciliation.
    Measurement {
        value: Arc<Measurement>,
        direct: bool,
        cumulative: Option<u64>,
        interval_start: Option<u64>,
        fingerprint: String,
    },
    Operation {
        value: Arc<Operation>,
        phase: Phase,
    },
    Lifecycle {
        lifecycle: LifecycleKind,
        phase: Phase,
        native_id: Option<String>,
        duration_ms: Option<u64>,
        first_token_ms: Option<u64>,
    },
    Activity {
        activity: ActivityKind,
    },
    /// Presence is observed in memory; no body, size, hash or media reference is retained.
    Message {
        origin: MessageOrigin,
        presence: ContentPresence,
        native_id: Option<String>,
        record_kind: MessageRecordKind,
        record_phase: Phase,
        content_phase: ContentPhase,
    },
    Item {
        item_kind: ItemKind,
        native_id: Option<String>,
        phase: Phase,
        started_at_ms: Option<i64>,
        completed_at_ms: Option<i64>,
        duration: Option<NativeDuration>,
    },
    ContextWindow {
        model: Option<String>,
        tokens: u64,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredEvent {
    version: u32,
    id: String,
    position: Position,
    thread_id: Option<String>,
    turn_id: Option<String>,
    time: Time,
    gaps: Vec<Gap>,
    payload: Payload,
}

/// Constructors and deserialization both enforce the same current-format envelope.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(try_from = "StoredEvent", into = "StoredEvent")]
pub struct Event(StoredEvent);
impl Event {
    pub fn new(
        position: Position,
        thread_id: Option<String>,
        turn_id: Option<String>,
        time: Time,
        gaps: Vec<Gap>,
        payload: Payload,
    ) -> Result<Self> {
        let id = position.event_id()?;
        Self::try_from(StoredEvent {
            version: EVENT_VERSION,
            id,
            position,
            thread_id,
            turn_id,
            time,
            gaps,
            payload,
        })
    }
    pub fn id(&self) -> &str {
        &self.0.id
    }
    pub fn position(&self) -> &Position {
        &self.0.position
    }
    pub fn payload(&self) -> &Payload {
        &self.0.payload
    }
    pub fn time(&self) -> &Time {
        &self.0.time
    }
    pub fn thread_id(&self) -> Option<&str> {
        self.0.thread_id.as_deref()
    }
    pub fn turn_id(&self) -> Option<&str> {
        self.0.turn_id.as_deref()
    }
    pub fn gaps(&self) -> &[Gap] {
        &self.0.gaps
    }
}
impl TryFrom<StoredEvent> for Event {
    type Error = anyhow::Error;
    fn try_from(value: StoredEvent) -> Result<Self> {
        ensure!(value.version == EVENT_VERSION, "unsupported event version");
        ensure!(
            value.id == value.position.event_id()?,
            "event identity mismatch"
        );
        ensure!(
            value.turn_id.is_none() || value.thread_id.is_some(),
            "turn requires thread identity"
        );
        ensure!(
            value.thread_id.as_ref().is_none_or(|id| !id.is_empty())
                && value.turn_id.as_ref().is_none_or(|id| !id.is_empty()),
            "empty event scope identity"
        );
        let thread = value.thread_id.as_deref();
        let turn = value.turn_id.as_deref();
        match &value.payload {
            Payload::Ancestry { parent_id, .. } => ensure!(
                !parent_id.is_empty() && thread.is_some() && turn.is_none(),
                "invalid ancestry identity"
            ),
            Payload::Thread { value: fact, .. } => ensure!(
                thread == Some(fact.id.as_str())
                    && turn.is_none()
                    && fact.source_instance_id == value.position.source_instance_id,
                "thread event scope mismatch"
            ),
            Payload::Turn { value: fact, .. } => ensure!(
                thread == Some(fact.thread_id.as_str()) && turn == Some(fact.id.as_str()),
                "turn event scope mismatch"
            ),
            Payload::Measurement { value: fact, .. } => ensure!(
                thread == fact.thread_id.as_deref()
                    && turn == fact.turn_id.as_deref()
                    && fact.source_instance_id.as_ref() == value.position.source_instance_id,
                "measurement event scope mismatch"
            ),
            Payload::Operation { value: fact, .. } => ensure!(
                thread == Some(fact.thread_id.as_ref()) && turn == fact.turn_id.as_deref(),
                "operation event scope mismatch"
            ),
            Payload::ContextWindow { tokens, .. } => {
                ensure!(*tokens > 0, "context window must be positive")
            }
            Payload::Lifecycle { native_id, .. } | Payload::Message { native_id, .. } => ensure!(
                native_id.as_ref().is_none_or(|id| !id.is_empty()),
                "empty lifecycle identity"
            ),
            Payload::Item {
                native_id,
                duration,
                started_at_ms,
                completed_at_ms,
                ..
            } => {
                ensure!(
                    native_id.as_ref().is_none_or(|id| !id.is_empty()),
                    "empty item identity"
                );
                ensure!(
                    duration.as_ref().is_none_or(
                        |d| d.nanos < 1_000_000_000 && d.secs <= MAX_SAFE_INTEGER / 1000
                    ),
                    "invalid native duration"
                );
                ensure!(
                    [started_at_ms, completed_at_ms]
                        .into_iter()
                        .all(|v| v.is_none_or(|n| n.unsigned_abs() <= MAX_SAFE_INTEGER)),
                    "unsafe native timestamp"
                );
            }
            Payload::Activity { .. } => {}
        }
        value.time.validate()?;
        Ok(Self(value))
    }
}
impl From<Event> for StoredEvent {
    fn from(value: Event) -> Self {
        value.0
    }
}

#[cfg(test)]
mod tests;
