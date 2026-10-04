//! Reviewable, version-bound Codex handoffs; no execution or recovery states.
use crate::optimize_dto::{Finding, RuleOverrides};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    #[default]
    Preview,
    Send,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub action: Action,
    pub roots: Option<Vec<String>>,
    pub project_roots: Option<Vec<String>>,
    pub project: Option<String>,
    pub source_instance_id: Option<String>,
    pub read_view: Option<String>,
    pub decision_revision: Option<String>,
    pub rule_overrides: Option<RuleOverrides>,
    pub suggestion_ids: Option<Vec<String>>,
    pub selection_version: Option<String>,
    pub language: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub item_id: String,
    pub suggestion_ids: Vec<String>,
    pub path: String,
    pub content_hash: String,
    pub expected_exists: bool,
    pub shared_projects: Vec<String>,
    pub findings: Vec<Finding>,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub cwd: String,
    pub targets: Vec<Target>,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub project_id: String,
    pub status: String,
    pub thread_id: Option<String>,
    pub native_version: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AllowanceCheck {
    pub project_id: String,
    pub assessment: crate::account_dto::AllowanceAssessment,
}
#[derive(Clone, Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub output_version: u8,
    pub action: Action,
    pub selection_version: String,
    pub read_view: String,
    pub decision_revision: String,
    pub projects: Vec<Project>,
    pub deliveries: Vec<Delivery>,
    pub allowance_checks: Vec<AllowanceCheck>,
}
