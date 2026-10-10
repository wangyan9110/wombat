//! Descriptive task populations; task means a recorded thread with selected measurements.
use super::*;

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskPopulation {
    pub measured_tasks: usize,
    pub complete_tasks: usize,
    pub incomplete_tasks: usize,
    pub complete_task_tokens: Option<u64>,
    pub mean_tokens: Option<f64>,
    pub median_tokens: Option<f64>,
    pub p90_tokens: Option<f64>,
    pub unassigned_usage: UsageSummary,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatisticsGroup {
    pub key: Option<String>,
    pub population: TaskPopulation,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskGrowth {
    pub baseline_scope: Scope,
    pub baseline: TaskPopulation,
    pub task_count_delta: i64,
    pub mean_tokens_delta: Option<f64>,
    /// Symmetric arithmetic decomposition: ΔN × (μ0+μ1)/2.
    /// Only available for complete, nonempty populations; never a causal attribution.
    pub task_count_contribution: Option<f64>,
    /// Δμ × (N0+N1)/2; sums with count contribution to attributed token growth.
    pub per_task_contribution: Option<f64>,
    pub attributed_token_delta: Option<i64>,
    pub unassigned_token_delta: Option<i64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatistics {
    pub selected_task: Option<TaskTypicality>,
    #[schemars(range(min = 1, max = 1))]
    pub method_version: u32,
    /// Linear interpolation at (n-1)p, shared with timing distributions.
    pub quantile_method: String,
    pub population: TaskPopulation,
    pub dimension: Option<Presentation>,
    /// A task using several models occurs in each model population; counts are not additive.
    pub groups: Vec<TaskStatisticsGroup>,
    pub growth: Option<TaskGrowth>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskTypicality {
    pub thread_id: String,
    pub tokens: Option<u64>,
    pub complete_population_tasks: usize,
    /// Midrank: (number below + half of ties) / complete sample size.
    pub percentile_rank: Option<f64>,
    pub above_p90: Option<bool>,
}
