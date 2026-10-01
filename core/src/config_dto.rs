//! Read-only configuration analysis. Counts are evidence, never exclusive cost attribution.
use crate::usage_app_dto::{Page, UsageSummary};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    #[default]
    List,
    Detail,
    Evidence,
    RelatedScopes,
    Capabilities,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Rule,
    Skill,
    Mcp,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Observation {
    Used,
    LoadedOnly,
    Unknown,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub since: Option<String>,
    pub until: Option<String>,
    pub timezone: Option<String>,
    pub project: Option<String>,
    pub agent_kind: Option<String>,
    pub source_instance_id: Option<String>,
    pub thread_id: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Sort {
    #[default]
    Tokens,
    Activity,
    Size,
    Name,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub action: Action,
    pub roots: Option<Vec<String>>,
    pub project_roots: Option<Vec<String>>,
    pub snapshot_id: Option<String>,
    pub read_view: Option<String>,
    #[serde(default)]
    pub scope: Scope,
    pub kind: Option<Kind>,
    pub observation: Option<Observation>,
    pub search: Option<String>,
    #[serde(default)]
    pub sort: Sort,
    pub item_id: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub kinds: Vec<Kind>,
    pub evidence_types: Vec<String>,
    pub token_estimates: bool,
    pub historical_content: bool,
    pub writes: bool,
    pub project_registry: bool,
}
impl Default for Capabilities {
    fn default() -> Self {
        Self {
            kinds: vec![Kind::Rule, Kind::Skill, Kind::Mcp],
            evidence_types: vec!["file_read".into(), "tool_call".into()],
            token_estimates: false,
            historical_content: false,
            writes: false,
            project_registry: false,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub source_instance_id: String,
    pub path: String,
    pub project: Option<String>,
    pub native_key: Option<String>,
    pub configured_state: String,
    pub content_hash: String,
    pub observed_at: String,
    pub current: bool,
    pub stale: bool,
    pub bytes: Option<u64>,
    pub content_tokens: Option<u64>,
    pub estimate_status: String,
    pub observation: Observation,
    pub counts: Counts,
    pub related_turns: usize,
    pub usage: Option<UsageSummary>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub file_reads: u64,
    pub tool_calls: u64,
    pub succeeded: u64,
    pub failed: u64,
    pub outcome_unknown: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub id: String,
    pub item_id: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub title: Option<String>,
    pub project: Option<String>,
    pub timestamp: Option<String>,
    pub event_type: String,
    pub outcome: String,
    pub association: String,
    pub usage: Option<UsageSummary>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub code: String,
    pub path: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub status: String,
    pub history_status: String,
    pub issues: Vec<Issue>,
    pub supported_evidence: Vec<String>,
    pub absence_observable: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub current_items: usize,
    pub historical_items: usize,
    pub observed_items: usize,
    pub usage: Option<UsageSummary>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RelatedScope {
    pub project: Option<String>,
    pub evidence_count: usize,
    pub usage: Option<UsageSummary>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub output_version: u32,
    pub action: Action,
    pub capabilities: Capabilities,
    pub read_view: Option<String>,
    pub usage_revision: Option<String>,
    pub config_revision: String,
    pub checked_at: String,
    pub scope: Scope,
    pub authorized_projects: Vec<String>,
    pub summary: Summary,
    pub items: Vec<Item>,
    pub evidence: Vec<Evidence>,
    pub related_scopes: Vec<RelatedScope>,
    pub page: Page,
    pub coverage: Coverage,
}
