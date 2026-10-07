//! Bounded descriptive comparisons. Contributions describe arithmetic, not causality.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ComparisonRequest {
    Periods {
        baseline_since: String,
        baseline_until: String,
        dimension: DriverDimension,
    },
    Sessions {
        left_thread_id: String,
        right_thread_id: String,
        #[serde(default)]
        include_descendants: bool,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DriverDimension {
    Project,
    Model,
    Thread,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsageDelta {
    /// Complete analyzed totals only; missing observations never become zero.
    pub tokens: Option<i64>,
    /// Complete configured valuations only, with exact decimal subtraction.
    pub cost: Option<String>,
    /// No percentage for a zero or unavailable baseline.
    pub token_ratio: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComparedUsage {
    pub scope: Scope,
    pub usage: UsageSummary,
    /// Includes source coverage and windows not yet closed at publication time.
    pub partial: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UsageDriver {
    pub key: Option<String>,
    pub baseline: ComparedUsage,
    pub current: ComparedUsage,
    pub delta: UsageDelta,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ComparedSession {
    pub thread_id: String,
    pub title: Option<String>,
    pub own: UsageSummary,
    pub descendants: UsageSummary,
    pub selected: UsageSummary,
    pub member_count: usize,
    /// Conflicting/cyclic ancestry, absent parents or incomplete source coverage.
    pub partial: bool,
    pub scope: Scope,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Comparison {
    Periods {
        dimension: DriverDimension,
        baseline: Box<ComparedUsage>,
        current: Box<ComparedUsage>,
        delta: UsageDelta,
        drivers: Vec<UsageDriver>,
        /// Contribution of all drivers outside this page, so pages remain reconcilable.
        remaining: UsageDelta,
        undated_records: usize,
    },
    Sessions {
        left: Box<ComparedSession>,
        right: Box<ComparedSession>,
        delta: UsageDelta,
        include_descendants: bool,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationChange {
    #[schemars(range(min = 1, max = 1))]
    pub method_version: u32,
    pub baseline: SnapshotRef,
    pub current: SnapshotRef,
    pub measurements_added: usize,
    pub measurements_removed: usize,
    pub measurements_changed: usize,
    pub threads_added: usize,
    pub turns_changed: usize,
    pub prices_changed: bool,
    pub coverage_changed: bool,
    pub delta: UsageDelta,
}
