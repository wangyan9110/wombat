//! Query-time review facts. These do not create configuration decisions or execution records.
use super::*;

#[derive(
    Clone, Copy, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord,
)]
#[serde(rename_all = "snake_case")]
pub enum OpportunityRule {
    UnpricedUsage,
    EstimateConcentration,
    EstimateOutlier,
    EstimateIncrease,
    CacheCreationReuse,
    ModelReview,
    SensitiveRead,
    SensitiveChange,
    OutsideProjectChange,
    RiskyCommand,
    SecretExposure,
    SensitiveOutbound,
    RepeatedRiskyDecline,
    PermissionFriction,
    UnansweredQuestion,
    LongInteraction,
    FrequentPolling,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpportunityStatus {
    Hit,
    Miss,
    Insufficient,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpportunityGap {
    SourcePartial,
    NoObservations,
    IncompletePrices,
    NoBaseline,
    UnknownCache,
    PathIdentity,
    RuntimeCoverage,
    InteractionAssociation,
    OutcomeUnknown,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpportunityMetricName {
    UnpricedTokens,
    Amount,
    BaselineAmount,
    Share,
    Multiple,
    Operations,
    Tasks,
    MedianOperations,
    CacheCreated,
    CacheRead,
    ReadCreateRatio,
    Requests,
    Unanswered,
    IntervalMs,
    Samples,
    Unknown,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OpportunityUnit {
    Count,
    Token,
    Usd,
    Ratio,
    Factor,
    Milliseconds,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpportunityMetric {
    pub name: OpportunityMetricName,
    /// Exact decimal representation; no client-side measurement or ratio calculation.
    pub value: Option<String>,
    pub unit: OpportunityUnit,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpportunityFinding {
    pub id: String,
    pub object: Option<String>,
    pub metrics: Vec<OpportunityMetric>,
    pub safety_labels: Vec<crate::session_events::SafetyLabel>,
    pub evidence: Vec<InspectionEvidence>,
    pub baseline_evidence: Vec<InspectionEvidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpportunityCheck {
    pub rule: OpportunityRule,
    pub status: OpportunityStatus,
    pub gaps: Vec<OpportunityGap>,
    pub finding_count: usize,
    pub findings: Vec<OpportunityFinding>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpportunityPolicy {
    pub minimum_unpriced_tokens: u64,
    pub minimum_amount_usd: String,
    pub concentration_share: f64,
    pub outlier_multiple: f64,
    pub increase_multiple: f64,
    pub minimum_increase_usd: String,
    pub minimum_cache_created: u64,
    pub maximum_read_create_ratio: f64,
    pub model_share: f64,
    pub maximum_median_operations: usize,
    pub minimum_model_tasks: usize,
    pub minimum_outlier_tasks: usize,
    pub minimum_permission_requests: usize,
    pub permission_request_share: f64,
    pub long_interaction_ms: u64,
    pub outbound_window_ms: u64,
    pub minimum_risky_declines: usize,
    pub minimum_polls: usize,
    pub maximum_poll_wait_ms: u64,
    pub minimum_observed_tasks: usize,
    pub minimum_polling_tasks: usize,
    pub minimum_polling_days: usize,
    pub polling_window_days: u32,
}
impl Default for OpportunityPolicy {
    fn default() -> Self {
        Self {
            minimum_unpriced_tokens: 50_000,
            minimum_amount_usd: "1".into(),
            concentration_share: 0.4,
            outlier_multiple: 2.0,
            increase_multiple: 2.0,
            minimum_increase_usd: "1".into(),
            minimum_cache_created: 100_000,
            maximum_read_create_ratio: 0.3,
            model_share: 0.6,
            maximum_median_operations: 15,
            minimum_model_tasks: 5,
            minimum_outlier_tasks: 5,
            minimum_permission_requests: 5,
            permission_request_share: 0.1,
            long_interaction_ms: 30_000,
            outbound_window_ms: 300_000,
            minimum_risky_declines: 2,
            minimum_polls: 5,
            maximum_poll_wait_ms: 2_000,
            minimum_observed_tasks: 5,
            minimum_polling_tasks: 3,
            minimum_polling_days: 2,
            polling_window_days: 7,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpportunityReview {
    #[schemars(range(min = 1, max = 1))]
    pub method_version: u32,
    pub policy: OpportunityPolicy,
    pub checks: Vec<OpportunityCheck>,
    pub limit_per_check: usize,
}
