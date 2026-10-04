//! Account observations are independent of local project usage and pricing.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    #[default]
    Read,
    Refresh,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub action: Action,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub status: String,
    pub checked_at: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub kind: String,
    pub masked_email: Option<String>,
    pub plan: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub id: String,
    pub bucket_id: String,
    pub bucket_name: Option<String>,
    /// Native normalModelSlug: presentation metadata, not quota applicability.
    pub model: Option<String>,
    pub used_percent: f64,
    pub duration_minutes: Option<u64>,
    pub resets_at: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Credits {
    /// Native decimal text; no currency or token conversion is inferred.
    pub balance: Option<String>,
    pub has_credits: Option<bool>,
    pub unlimited: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpendLimit {
    pub limit: Option<String>,
    pub used: Option<String>,
    pub remaining_percent: Option<f64>,
    pub resets_at: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub id: String,
    pub name: Option<String>,
    /// Native normalModelSlug: presentation metadata, not quota applicability.
    pub model: Option<String>,
    pub credits: Option<Credits>,
    pub individual_limit: Option<SpendLimit>,
    pub spend_control_reached: Option<bool>,
    pub rate_limit_reached_type: Option<String>,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResetCredit {
    pub id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub granted_at: Option<String>,
    pub expires_at: Option<String>,
    pub reset_type: String,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResetCredits {
    pub available_count: Option<u64>,
    /// None means details were not provided; an empty list is an observed empty list.
    pub credits: Option<Vec<ResetCredit>>,
    pub details_truncated: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub lifetime_tokens: Option<u64>,
    pub current_streak_days: Option<u64>,
    pub longest_streak_days: Option<u64>,
    pub peak_daily_tokens: Option<u64>,
    pub longest_running_turn_seconds: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ModelRestriction {
    /// Explicit blocked_model_slug from an identity-bound native usage-limit notice.
    pub model: String,
    pub resets_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub output_version: u8,
    pub action: Action,
    pub native_version: Option<String>,
    pub account: Section,
    pub allowance: Section,
    pub activity: Section,
    pub identity: Option<Identity>,
    pub windows: Vec<Window>,
    pub buckets: Vec<Bucket>,
    pub reset_credits: Option<ResetCredits>,
    pub ordinary_usage_allowed: Option<bool>,
    pub model_restriction: Option<ModelRestriction>,
    pub summary: Option<Summary>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AllowanceStatus {
    #[default]
    Unknown,
    Available,
    Low,
    Blocked,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceAssessment {
    pub status: AllowanceStatus,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub checked_at: Option<String>,
    /// An observation deadline, not a prediction that allowance recovers then.
    pub valid_until: Option<String>,
    pub bucket_id: Option<String>,
    pub window_id: Option<String>,
    pub reason: String,
}
