//! Bounded request-input comparisons. The method uses physical observation order.
use super::{Capability, Count};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InputChangeMethod {
    RequestInputObservationChangeV1,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputChange {
    pub method: InputChangeMethod,
    pub availability: Capability,
    pub statistics: Option<InputChangeStatistics>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputChangeStatistics {
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub candidates: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub ordered_samples: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub non_request_scoped: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub missing_input: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub unassociated: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub numeric_range: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub comparable_stages: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub increasing_stages: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub decreasing_stages: usize,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub unchanged_stages: usize,
    /// Zero means comparable stages had no positive first-to-last change; null means no comparison.
    pub maximum_increase: Count,
    pub largest_increase: Option<InputChangeStage>,
    #[schemars(length(max = 32))]
    pub stages: Vec<InputChangeStage>,
    pub details_omitted: bool,
    pub partial: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputChangeStage {
    #[schemars(length(min = 1, max = 64))]
    pub id: String,
    #[schemars(range(min = 2, max = 9007199254740991_u64))]
    pub samples: usize,
    #[schemars(length(min = 1, max = 4096))]
    pub first_ref: String,
    #[schemars(length(min = 1, max = 4096))]
    pub last_ref: String,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub first_input: u64,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub last_input: u64,
    #[schemars(range(min = -9007199254740991_i64, max = 9007199254740991_i64))]
    pub delta: i64,
    #[schemars(range(min = 0, max = 9007199254740991_u64))]
    pub factor: Option<f64>,
}
