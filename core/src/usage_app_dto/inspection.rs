//! Versioned inspection features, never diagnoses or savings predictions.
use super::*;
pub(crate) const INSPECTION_RESPONSE_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InspectionKind {
    Investigate,
    Trajectory,
    Resources,
    Review,
    Context,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InspectionSignal {
    HighUsage,
    LowCacheReuse,
    InputJump,
    FailureShare,
    RepeatedRequest,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InspectionLimit {
    SourcePartial,
    ContextOccupancyUnavailable,
    ActualChangesUnavailable,
    UnlocatedOperations,
    UnknownInputOrder,
    OperationOutcomesPartial,
    OperationModelAssociation,
    ContextMetadataUnavailable,
    SelectedTurnOnly,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InputBoundary {
    First,
    Compaction,
    ModelChange,
    SourceChange,
    AmbiguousOrder,
    MissingInput,
    ScopeGap,
    SourceGap,
    TurnChange,
    MissingContext,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum InspectionEvidenceView {
    Task,
    Turn,
    Operation,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectionEvidence {
    pub view: InspectionEvidenceView,
    #[schemars(range(min = 1, max = 1))]
    pub method_version: u32,
    pub snapshot_id: String,
    pub scope: Scope,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub operation_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectionPolicy {
    pub minimum_tokens: u64,
    pub minimum_input: u64,
    pub maximum_cache_share: f64,
    pub minimum_input_jump: u64,
    pub minimum_determinate_operations: u64,
    pub minimum_failures: u64,
    pub minimum_failure_share: f64,
    pub minimum_repeated_requests: u64,
}
impl Default for InspectionPolicy {
    fn default() -> Self {
        Self {
            minimum_tokens: 1_000_000,
            minimum_input: 100_000,
            maximum_cache_share: 0.2,
            minimum_input_jump: 100_000,
            minimum_determinate_operations: 5,
            minimum_failures: 2,
            minimum_failure_share: 0.4,
            minimum_repeated_requests: 3,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InvestigationCandidate {
    pub thread_id: String,
    pub title: Option<String>,
    pub signals: Vec<InspectionSignal>,
    pub usage: UsageSummary,
    pub input: Option<u64>,
    pub cache_share: Option<f64>,
    pub largest_uncached_jump: Option<u64>,
    pub determinate_operations: u64,
    pub failed_operations: u64,
    pub outcome_gaps: u64,
    /// Identical callable/argument observations inside one exact turn/receiver.
    pub repeated_requests: u64,
    pub evidence: Vec<InspectionEvidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InputPoint {
    pub measurement_id: String,
    pub timestamp: Option<String>,
    pub input: Option<u64>,
    pub uncached_input: Option<u64>,
    pub cache_read: Option<u64>,
    pub input_delta: Option<i64>,
    pub uncached_delta: Option<i64>,
    pub boundary: Option<InputBoundary>,
    pub epoch: u64,
    pub evidence: InspectionEvidence,
    /// Two observations separated by a compaction marker; not a continuous delta or causal effect.
    pub compaction_comparison: Option<CompactionInputComparison>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompactionInputComparison {
    pub before_measurement_id: String,
    pub before_input: u64,
    pub after_input: u64,
    pub input_difference: i64,
    pub before_evidence: InspectionEvidence,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ContextRecordKind {
    InjectedContext,
    ModelWindow,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextInventoryRecord {
    pub id: String,
    pub kind: ContextRecordKind,
    pub timestamp: Option<String>,
    pub record_kind: Option<String>,
    pub phase: Option<String>,
    pub presence: Option<String>,
    pub model: Option<String>,
    pub model_context_window: Option<u64>,
    /// Native source records do not retain historical resource versions or measured bodies.
    pub content_version: Option<String>,
    pub bytes: Option<u64>,
    pub evidence: InspectionEvidence,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContextInventory {
    pub observed_records: usize,
    pub injected_records: usize,
    pub model_window_records: usize,
    /// Physical safe records, not logical requests, messages or injection counts.
    pub records: Vec<ContextInventoryRecord>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResourceHotspot {
    pub id: String,
    pub source_instance_id: String,
    pub project: Option<String>,
    pub path: String,
    /// Verified lexical read target or unnormalized source-reported change path.
    pub identity_basis: String,
    pub operations: u64,
    pub reads: u64,
    pub proposed_changes: u64,
    pub reported_changes: u64,
    pub failed_operations: u64,
    pub known_duration_ms: Option<u64>,
    pub duration_covered_operations: u64,
    /// Source write reports do not establish independently observed disk changes.
    pub actual_changes: Option<u64>,
    pub evidence: Vec<InspectionEvidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGroup {
    pub key: Option<String>,
    pub usage: UsageSummary,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ToolFamilyCount {
    pub kind: String,
    pub operations: u64,
    pub failed: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PeriodReview {
    pub comparison: Option<Comparison>,
    pub top_tasks: Vec<InvestigationCandidate>,
    pub models: Vec<ReviewGroup>,
    pub tools: Vec<ToolFamilyCount>,
    pub remaining_model_usage: UsageSummary,
    pub week_start: Option<String>,
    pub concentration: Option<ReviewConcentration>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewConcentration {
    #[schemars(range(min = 1, max = 1))]
    pub method_version: u32,
    pub measured_tasks: usize,
    pub total_tokens: Option<u64>,
    pub top_task_tokens: Option<u64>,
    pub top_task_share: Option<f64>,
    pub top_five_tokens: Option<u64>,
    pub top_five_share: Option<f64>,
    pub top_ten_tokens: Option<u64>,
    pub top_ten_share: Option<f64>,
    pub remaining_task_usage: UsageSummary,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Inspection {
    #[schemars(range(min = 3, max = 3))]
    pub method_version: u32,
    pub kind: InspectionKind,
    pub policy: InspectionPolicy,
    pub partial: bool,
    pub limitations: Vec<InspectionLimit>,
    pub candidates: Vec<InvestigationCandidate>,
    pub trajectory: Vec<InputPoint>,
    pub resources: Vec<ResourceHotspot>,
    pub review: Option<PeriodReview>,
    pub candidate_count: usize,
    pub resource_count: usize,
    pub unlocated_operations: usize,
    pub context: Option<ContextInventory>,
    pub activity: Option<ActivityReview>,
    pub opportunities: Option<OpportunityReview>,
}

#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivitySignal {
    RepeatedSlowRequest,
    FailureSpike,
    DurationSpike,
    RecurringWorkflow,
    RepeatedFailure,
    RepeatedRejection,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityStats {
    pub operations: u64,
    pub tasks: usize,
    pub determinate_operations: u64,
    pub failed_operations: u64,
    pub rejected_operations: u64,
    pub failure_share: Option<f64>,
    pub outcome_gaps: u64,
    pub duration_samples: usize,
    pub slow_operations: u64,
    pub maximum_duration_ms: Option<u64>,
    pub median_duration_ms: Option<f64>,
    pub maximum_failures_in_task: u64,
    pub maximum_rejections_in_task: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityPolicy {
    pub slow_duration_ms: u64,
    pub minimum_slow_operations: u64,
    pub minimum_current_outcomes: u64,
    pub minimum_baseline_outcomes: u64,
    pub minimum_spike_failures: u64,
    pub minimum_failure_share: f64,
    pub failure_share_multiplier: f64,
    pub baseline_failure_share_floor: f64,
    pub minimum_baseline_durations: usize,
    pub minimum_baseline_median_ms: u64,
    pub duration_multiplier: f64,
    pub minimum_duration_increase_ms: u64,
    pub minimum_workflow_operations: u64,
    pub minimum_workflow_tasks: usize,
    pub minimum_failures_in_task: u64,
    pub minimum_rejections_in_task: u64,
}
impl Default for ActivityPolicy {
    fn default() -> Self {
        Self {
            slow_duration_ms: 30_000,
            minimum_slow_operations: 2,
            minimum_current_outcomes: 5,
            minimum_baseline_outcomes: 20,
            minimum_spike_failures: 3,
            minimum_failure_share: 0.2,
            failure_share_multiplier: 3.0,
            baseline_failure_share_floor: 0.01,
            minimum_baseline_durations: 8,
            minimum_baseline_median_ms: 2_000,
            duration_multiplier: 10.0,
            minimum_duration_increase_ms: 20_000,
            minimum_workflow_operations: 5,
            minimum_workflow_tasks: 2,
            minimum_failures_in_task: 3,
            minimum_rejections_in_task: 2,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityFinding {
    pub id: String,
    pub signals: Vec<ActivitySignal>,
    pub source_instance_id: String,
    pub project: Option<String>,
    pub tool: String,
    pub current: ActivityStats,
    pub baseline: Option<ActivityStats>,
    pub evidence: Vec<InspectionEvidence>,
    pub baseline_evidence: Vec<InspectionEvidence>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityCoverage {
    pub observed_operations: u64,
    pub matched_operations: u64,
    pub outcome_gaps: u64,
    pub duration_samples: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActivityReview {
    #[schemars(range(min = 1, max = 1))]
    pub method_version: u32,
    pub policy: ActivityPolicy,
    /// Same authorized scope, preceding disjoint dates; absent for unbounded selections.
    pub baseline_scope: Option<Scope>,
    pub current_coverage: ActivityCoverage,
    pub baseline_coverage: Option<ActivityCoverage>,
    pub findings: Vec<ActivityFinding>,
    pub finding_count: usize,
    pub limit: usize,
}
