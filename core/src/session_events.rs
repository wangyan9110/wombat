//! Safe, versioned source facts. Source bodies cannot be represented in this model.
//! Storage and projections share these identities; public query DTOs remain separate.
use crate::adapters::contract::{Measurement, Operation, Thread, Turn};
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Payload {
    Thread {
        value: Thread,
    },
    Turn {
        value: Turn,
    },
    /// Preserve source accounting inputs before cross-file deduplication and reconciliation.
    Measurement {
        value: Arc<Measurement>,
        direct: bool,
        cumulative: Option<u64>,
        interval_start: Option<u64>,
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
            Payload::Thread { value: fact } => ensure!(
                thread == Some(fact.id.as_str())
                    && turn.is_none()
                    && fact.source_instance_id == value.position.source_instance_id,
                "thread event scope mismatch"
            ),
            Payload::Turn { value: fact } => ensure!(
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
            Payload::Lifecycle { native_id, .. } => ensure!(
                native_id.as_ref().is_none_or(|id| !id.is_empty()),
                "empty lifecycle identity"
            ),
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
