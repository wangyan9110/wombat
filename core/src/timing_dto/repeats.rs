//! Repeated aggregates and local-only proof navigation. Matching keys and target paths stay private.
use super::*;
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FailureRepeatMethod {
    SameOperationAfterFailureV1,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReadRepeatMethod {
    SameTargetReadV1,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepeatedReadLayer {
    SamePathRangeUnconfirmed,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepeatCoverageReason {
    MissingMatching,
    ExcludedReceivers,
    IdentityGaps,
    ConflictingOperations,
    MissingStart,
    IndeterminateOutcomes,
    OrderGaps,
    ContextBoundaries,
    CrossedContext,
    MissingClockDomain,
    SourceMetadataGaps,
    DurationConflicts,
    MissingDurations,
    MissingRecoverySpans,
    MissingIntervals,
    MissingWindow,
    SourcePartial,
    ResourceLimit,
    NumericRange,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatedDuration {
    pub known_sum_ms: Count,
    pub recorded_count: Count,
    pub calculated_count: Count,
    pub missing_count: Count,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatedMetric {
    pub count: Count,
    pub duration: RepeatedDuration,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatCoverage {
    pub candidate_operations: Count,
    pub eligible_commands: Count,
    pub missing_identity_records: Count,
    pub excluded_receivers: Count,
    pub missing_matching: Count,
    pub conflicting_operations: Count,
    pub missing_start: Count,
    pub indeterminate_outcomes: Count,
    pub order_gaps: Count,
    pub context_boundaries: Count,
    pub crossed_context: Count,
    pub missing_clock_domain: Count,
    pub source_metadata_gaps: Count,
    pub duration_conflicts: Count,
    pub partial: bool,
    pub reason_codes: Vec<RepeatCoverageReason>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatedBehavior {
    pub failure_method: FailureRepeatMethod,
    pub read_method: ReadRepeatMethod,
    #[schemars(range(min = 1, max = 1))]
    pub endpoint_method_version: u32,
    pub support: Capability,
    pub read_layer: RepeatedReadLayer,
    pub after_failure: RepeatedMetric,
    pub repeated_read: RepeatedMetric,
    pub same_request_observation_count: Count,
    pub repeated_read_request_count: Count,
    pub recovery_span_sum_ms: Count,
    pub missing_recovery_span_count: Count,
    pub combined_operation_count: Count,
    pub combined_union_ms: Count,
    pub combined_missing_interval_count: Count,
    pub coverage: RepeatCoverage,
}

/// Local source-record proofs. Sharing contains no repeat locators or aliases.
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatEvidencePage {
    pub cursor: Option<Cursor>,
    #[schemars(range(min = 200, max = 200))]
    pub limit: usize,
    #[schemars(length(min = 1, max = 16))]
    pub evidence_refs: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatProof {
    pub operation_alias: String,
    #[schemars(length(min = 1, max = 16))]
    pub pages: Vec<RepeatEvidencePage>,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatEvidenceEntry {
    pub later: RepeatProof,
    pub after_failure: Option<RepeatProof>,
    #[schemars(length(max = 599))]
    pub successful_reads: Vec<RepeatProof>,
    pub repeated_read_target_count: u64,
    pub later_duration_ms: Count,
    pub recovery_span_ms: Count,
}
#[derive(Clone, Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepeatPages {
    pub detail: Capability,
    pub candidate_operation_count: Count,
    pub located_operation_count: Count,
    pub page_count: Count,
    #[schemars(range(min = 65536, max = 65536))]
    pub limit_bytes: usize,
    #[schemars(length(max = 200))]
    pub entries: Vec<RepeatEvidenceEntry>,
}
