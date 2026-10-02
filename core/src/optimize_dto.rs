//! Narrow, object-bound review operations. No source writes or command execution.
use crate::config_dto::{Issue, Item};
use crate::usage_app_dto::Page;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    #[default]
    List,
    Detail,
    Ignore,
    MarkEdited,
    Restore,
    Recheck,
    Capabilities,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Group {
    #[default]
    Pending,
    History,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    #[serde(default)]
    pub action: Action,
    pub roots: Option<Vec<String>>,
    pub project_roots: Option<Vec<String>>,
    pub read_view: Option<String>,
    pub decision_revision: Option<String>,
    pub project: Option<String>,
    pub source_instance_id: Option<String>,
    pub suggestion_id: Option<String>,
    #[serde(default)]
    pub group: Group,
    pub category: Option<Category>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
    pub rule_overrides: Option<RuleOverrides>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleOverrides {
    pub agents_bytes: Option<u64>,
    pub description_characters: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuleParameters {
    pub version: String,
    pub agents_bytes_default: u64,
    pub description_characters_default: u64,
    pub overrides: RuleOverrides,
    pub body_tokens: u64,
    pub description_standard_max: u64,
    pub applicability: String,
}
impl Default for RuleParameters {
    fn default() -> Self {
        Self {
            version: "static-config-v4".into(),
            agents_bytes_default: 16384,
            description_characters_default: 500,
            overrides: RuleOverrides::default(),
            body_tokens: 5000,
            description_standard_max: 1024,
            applicability: "authorizedCurrentConfigurationOnly".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Repair,
    Trim,
    Organize,
    Space,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub rule: String,
    pub status: String,
    pub observed: Option<u64>,
    pub threshold: Option<u64>,
    pub evidence_codes: Vec<String>,
    #[serde(default)]
    pub basis: Option<String>,
    /// Positions and relationships only; never retain source text or command arguments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<StaticEvidence>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct StaticEvidence {
    pub method: String,
    pub applicability: String,
    pub declaration_hash: Option<String>,
    pub relation_id: Option<String>,
    pub direction: Option<String>,
    pub transform: Option<String>,
    pub versions: Vec<FileVersion>,
    pub positions: Vec<BlockPosition>,
    /// Scope-bound owner; legacy evidence without this cannot prove a declared relation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation: Option<RelationIdentity>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct RelationIdentity {
    pub source_instance_id: String,
    pub project: String,
    pub declaration_path: String,
    pub declaration_hash: String,
    pub relation_id: String,
    pub kind: RelationKind,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RelationKind {
    Chain,
    Copy,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub item_id: String,
    pub path: String,
    pub content_hash: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BlockPosition {
    pub item_id: String,
    pub start_byte: usize,
    pub end_byte: usize,
    pub start_line: usize,
    pub end_line: usize,
    pub block_hash: String,
}

/// Existing, user-maintained .wombat/analysis.json; it declares intent, never host loading.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisDeclaration {
    pub version: u32,
    #[serde(default)]
    pub chains: Vec<DeclaredChain>,
    #[serde(default)]
    pub copies: Vec<DeclaredCopy>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclaredChain {
    pub id: String,
    /// Project-relative paths that the user explicitly declares jointly applicable.
    pub files: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclaredCopy {
    pub id: String,
    pub source: String,
    pub copy: String,
    /// First supported version: identity-v1. Other transforms stay unknown.
    pub transform: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub scope_project: Option<String>,
    pub id: String,
    pub item: Item,
    pub category: Category,
    pub status: String,
    pub findings: Vec<Finding>,
    pub checked_at: String,
    pub rule_version: String,
    #[serde(default)]
    pub rule_parameters: Option<RuleParameters>,
    #[serde(default)]
    pub recheck_rule_parameters: Option<RuleParameters>,
    /// Exact measured metadata at manual-review marking; no source body is retained.
    #[serde(default)]
    pub review_baseline: Option<Item>,
    pub record_id: Option<String>,
    pub recorded_at: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub static_checks: bool,
    pub manual_edit_review: bool,
    pub decisions: bool,
    pub inactivity: bool,
    pub mcp_faults: bool,
    pub space_cleanup: bool,
    pub previews: bool,
    pub execution: bool,
    pub recovery: bool,
    pub loading_budget_diagnosis: bool,
    pub exact_instruction_blocks: bool,
    pub declared_copy_drift: bool,
    pub hook_support: HookSupport,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct HookSupport {
    pub host: Option<String>,
    pub host_version: Option<String>,
    pub effective_registry: bool,
    pub status: HookSupportStatus,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HookSupportStatus {
    #[default]
    NoVerifiedAdapter,
}
impl Default for Capabilities {
    fn default() -> Self {
        Self {
            static_checks: true,
            manual_edit_review: true,
            decisions: true,
            inactivity: false,
            mcp_faults: false,
            space_cleanup: false,
            previews: false,
            execution: false,
            recovery: false,
            loading_budget_diagnosis: false,
            exact_instruction_blocks: true,
            declared_copy_drift: true,
            hook_support: HookSupport::default(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub output_version: u32,
    pub action: Action,
    pub capabilities: Capabilities,
    pub read_view: Option<String>,
    pub config_revision: String,
    pub usage_revision: Option<String>,
    pub decision_revision: String,
    pub checked_at: String,
    pub suggestions: Vec<Suggestion>,
    pub pending: usize,
    pub history: usize,
    pub page: Page,
    pub issues: Vec<Issue>,
    pub result_status: String,
    pub rule_parameters: RuleParameters,
}
