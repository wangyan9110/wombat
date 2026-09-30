//! Source-neutral facts. No pricing or user-interface policy belongs in an adapter.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input: Option<u64>,
    pub cache_read: Option<u64>,
    pub cache_create: Option<u64>,
    pub output: Option<u64>,
    /// Subset of output, never an additional billable category.
    pub reasoning: Option<u64>,
    pub total: Option<u64>,
    /// Source input including caches; retained for request-level price conditions.
    pub raw_input: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelRef {
    pub raw: Option<String>,
    pub provider: Option<String>,
    pub api_provider: Option<String>,
    pub pricing_model: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRef {
    pub file: Arc<str>,
    pub line: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub usage: bool,
    pub threads: bool,
    pub turns: bool,
    pub operations: bool,
    pub reasoning_effort: bool,
    pub response_identity: bool,
    pub measurement_grain: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AdapterDescriptor {
    pub agent_kind: String,
    pub adapter_version: String,
    pub capabilities: Capabilities,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceInstance {
    pub id: String,
    pub agent_kind: String,
    pub root: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub code: String,
    pub message: String,
    pub source_instance_id: Option<String>,
    pub evidence: Option<EvidenceRef>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SourceReport {
    pub source: SourceInstance,
    pub adapter_version: String,
    #[serde(default)]
    pub source_versions: Vec<String>,
    pub capabilities: Capabilities,
    /// complete, partial, failed, notFound, cancelled
    pub status: String,
    pub files_read: u64,
    pub bytes_read: u64,
    pub issues: Vec<Issue>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub id: String,
    pub agent_kind: String,
    pub source_instance_id: String,
    pub upstream_id: String,
    pub title: Option<String>,
    pub project: Option<String>,
    pub started_at: Option<String>,
    pub last_activity_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: String,
    pub thread_id: String,
    pub upstream_id: String,
    pub ordinal: u64,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    /// running, completed, interrupted, failed, unknown
    pub status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub id: String,
    pub agent_kind: String,
    pub source_instance_id: String,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub response_id: Option<String>,
    pub timestamp: Option<String>,
    pub interval_end: Option<String>,
    pub grain: String,
    pub time_precision: String,
    pub model: ModelRef,
    pub reasoning_effort: Option<String>,
    pub tokens: TokenUsage,
    pub request_scoped: bool,
    pub reported_cost: Option<String>,
    pub service_tier: Option<String>,
    pub sequence: u64,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub call_id: Option<String>,
    pub response_id: Option<String>,
    pub kind: String,
    pub name: String,
    pub sequence: u64,
    pub timestamp: Option<String>,
    pub time_precision: String,
    pub status: String,
    pub exit_code: Option<i64>,
    pub duration_ms: Option<u64>,
    pub path: Option<String>,
    pub server: Option<String>,
    pub tool: Option<String>,
    pub evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Collected {
    pub sources: Vec<SourceReport>,
    pub threads: Vec<Thread>,
    pub turns: Vec<Turn>,
    pub measurements: Vec<Arc<Measurement>>,
    pub operations: Vec<Arc<Operation>>,
    pub issues: Vec<Issue>,
}

#[derive(Clone, Debug, Default)]
pub struct DiscoveryRequest {
    pub roots: Vec<PathBuf>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryReport {
    pub sources: Vec<SourceInstance>,
    pub issues: Vec<Issue>,
}
#[derive(Clone, Debug, Default)]
pub struct ReadPlan;

#[derive(Clone, Debug)]
pub struct RunContext {
    pub cancelled: Arc<AtomicBool>,
    pub max_files: usize,
    pub max_bytes: u64,
}
impl Default for RunContext {
    fn default() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            max_files: 1_000_000,
            max_bytes: 1_000_000_000_000,
        }
    }
}
impl RunContext {
    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

pub enum Fact {
    Thread(Thread),
    Turn(Turn),
    Measurement(Arc<Measurement>),
    Operation(Arc<Operation>),
}
pub trait FactSink {
    fn push(&mut self, fact: Fact);
}
impl FactSink for Collected {
    fn push(&mut self, fact: Fact) {
        match fact {
            Fact::Thread(value) => self.threads.push(value),
            Fact::Turn(value) => self.turns.push(value),
            Fact::Measurement(value) => self.measurements.push(value),
            Fact::Operation(value) => self.operations.push(value),
        }
    }
}
pub trait AgentAdapter: Send + Sync {
    fn descriptor(&self) -> AdapterDescriptor;
    fn discover(&self, request: &DiscoveryRequest) -> DiscoveryReport;
    fn collect(
        &self,
        source: &SourceInstance,
        plan: &ReadPlan,
        context: &RunContext,
        sink: &mut dyn FactSink,
    ) -> SourceReport;
}

/// Source paths repeat across every record; keep one allocation per observed path.
#[derive(Default)]
pub(crate) struct EvidencePaths(std::collections::BTreeSet<Arc<str>>);
impl EvidencePaths {
    pub(crate) fn compact(&mut self, evidence: &mut [EvidenceRef]) {
        for item in evidence {
            if let Some(path) = self.0.get(item.file.as_ref()) {
                item.file = Arc::clone(path);
            } else {
                self.0.insert(Arc::clone(&item.file));
            }
        }
    }
}
