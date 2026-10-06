//! Aggregate-only repeated behavior. Private matching keys and target paths never cross this boundary.
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
