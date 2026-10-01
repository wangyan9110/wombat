//! Public v3 query contract. All calculations remain in the Rust core.
use crate::adapters::contract::{Issue, SourceReport, TokenUsage};
use crate::pricing::PriceResult;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub timezone: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub agent_kind: Option<String>,
    pub source_instance_id: Option<String>,
    pub model: Option<String>,
    pub model_unknown: Option<bool>,
    pub effort_unknown: Option<bool>,
    pub undated: Option<bool>,
    pub reasoning_effort: Option<String>,
    pub project: Option<String>,
    pub thread_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Refresh,
    Usage,
    Threads,
    Turns,
    Steps,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Group {
    #[default]
    Day,
    Week,
    Month,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Sort {
    Tokens,
    Cost,
    Recent,
    Time,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Presentation {
    Distribution,
    Details,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub action: Action,
    pub snapshot_id: Option<String>,
    pub roots: Option<Vec<String>>,
    #[serde(default)]
    pub scope: Scope,
    pub group: Option<Group>,
    pub sort: Option<Sort>,
    pub presentation: Option<Presentation>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub search: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub tokens: TokenUsage,
    pub price: PriceResult,
    pub measurement_count: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRef {
    pub snapshot_id: String,
    pub created_at: String,
    /// Fixed selector for externally located legacy files; v3 uses snapshotId.
    #[serde(default)]
    pub selector: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
    pub next_offset: Option<usize>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Quality {
    pub status: String,
    pub issues: Vec<Issue>,
    pub sources: Vec<SourceReport>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AvailableRange {
    pub since: Option<String>,
    /// Exclusive local date boundary.
    pub until: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Item {
    Usage {
        date: Option<String>,
        /// Inclusive display date. Scope.until remains exclusive for queries.
        end_date: Option<String>,
        is_subtotal: bool,
        model: Option<String>,
        reasoning_effort: Option<String>,
        usage: UsageSummary,
        scope: Scope,
        share: Option<f64>,
        cost_share: Option<f64>,
    },
    Thread {
        id: String,
        agent_kind: String,
        source_instance_id: String,
        title: Option<String>,
        project: Option<String>,
        started_at: Option<String>,
        last_activity_at: Option<String>,
        models: Vec<String>,
        reasoning_efforts: Vec<String>,
        matched_usage: UsageSummary,
        thread_usage: UsageSummary,
    },
    Turn {
        id: String,
        thread_id: String,
        ordinal: Option<u64>,
        started_at: Option<String>,
        ended_at: Option<String>,
        status: String,
        models: Vec<String>,
        reasoning_efforts: Vec<String>,
        usage: UsageSummary,
        matched_usage: UsageSummary,
        share: Option<f64>,
        cost_share: Option<f64>,
    },
    Measurement {
        id: String,
        thread_id: Option<String>,
        turn_id: Option<String>,
        timestamp: Option<String>,
        model: Option<String>,
        reasoning_effort: Option<String>,
        usage: UsageSummary,
        share: Option<f64>,
        cost_share: Option<f64>,
        sequence: u64,
        time_precision: String,
    },
    Operation {
        id: String,
        thread_id: String,
        turn_id: Option<String>,
        timestamp: Option<String>,
        name: String,
        status: String,
        sequence: u64,
        time_precision: String,
        operation_type: String,
        exit_code: Option<i64>,
        duration_ms: Option<u64>,
        path: Option<String>,
        server: Option<String>,
        tool: Option<String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Distribution {
    pub unpriced_tokens: Option<u64>,
    pub max_tokens: Option<u64>,
    pub max_cost: Option<String>,
    pub peak_token_dates: Vec<Option<String>>,
    pub peak_cost_dates: Vec<Option<String>>,
    pub peak_token_scopes: Vec<Scope>,
    pub peak_cost_scopes: Vec<Scope>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distribution: Option<Distribution>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price_update: Option<crate::pricing_sync::Automatic>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freshness: Option<crate::live::Freshness>,
    pub output_version: u32,
    pub action: Action,
    pub snapshot_ref: SnapshotRef,
    pub scope: Scope,
    pub available_range: AvailableRange,
    pub summary: UsageSummary,
    pub items: Vec<Item>,
    pub page: Page,
    pub quality: Quality,
}
