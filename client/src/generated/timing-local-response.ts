/* Generated from Rust. Run pnpm contracts:generate. */

export type SummaryAction = "summary";
export type LocalProfile = "local";
export type PrivacyProfile = "local" | "share-v1";
export type Support = "supported" | "partial" | "unavailable";
export type Basis =
  | "native_record"
  | "explicit_boundary"
  | "lifecycle_union"
  | "lifecycle_sum"
  | "interval_mask"
  | "request_input"
  | "historical_window"
  | "type7"
  | "safe_message_record"
  | "safe_message_delay"
  | "safe_event_count"
  | "response_gap_v1"
  | "not_recorded"
  | "adapter_not_mapped"
  | "unsupported_method"
  | "missing_identity"
  | "missing_time"
  | "boundary_conflict"
  | "source_partial"
  | "resource_limit"
  | "numeric_range"
  | "no_candidates"
  | "missing_batch_cycle"
  | "missing_repository_baseline";
export type MetricStatus = "observed" | "derived" | "proxy" | "unavailable";
export type TurnState = "running" | "completed" | "failed" | "cancelled" | "unknown";
export type FindingKind = "fact" | "proxy" | "user_annotation";
export type CollectionKind = "turn_events" | "canonical_measurements" | "source_controls" | "native_boundary_index";

export interface LocalResponse {
  outputVersion: number;
  action: SummaryAction;
  methodVersion: string;
  profile: LocalProfile;
  privacy: Privacy;
  readView: ReadView;
  scope: LocalScope;
  capabilities: Capabilities;
  anchors: Anchors;
  time: Time;
  context: Context;
  work: Work;
  findings: Finding[];
  coverage: Coverage;
  quality: Quality;
  freshness: QueryFreshness;
  evidence: EvidenceIndex;
}
export interface Privacy {
  profile: PrivacyProfile;
  omittedFields: string[];
  aliases: string;
}
export interface ReadView {
  snapshotId: string;
  snapshotSchema: number;
  createdAt: string;
  adapterVersions: string[];
  projectionVersion: number;
}
export interface LocalScope {
  sourceInstanceId: string;
  threadId: string;
  turnId: string;
  agentKind: string;
  wholeTurn: boolean;
}
export interface Capabilities {
  wallClock: Capability;
  nativeTtft: Capability;
  firstContentRecordDelay: Capability;
  lifecycleIntervals: Capability;
  contextPressure: Capability;
  strictResponseGap: Capability;
  exploratoryGap: Capability;
  commandLabels: Capability;
  fileChanges: Capability;
  messageRecords: Capability;
}
export interface Capability {
  support: Support;
  reason: Basis;
}
export interface Anchors {
  startMs: TimingMetricInt64;
  endMs: TimingMetricInt64;
}
export interface TimingMetricInt64 {
  value: number | null;
  status: MetricStatus;
  basis: Basis;
  evidenceRefs: string[];
}
export interface Time {
  state: TurnState;
  nativeWallClockMs: TimingMetricUint64;
  derivedWallClockMs: TimingMetricUint64;
  nativeTtftMs: TimingMetricUint64;
  firstContentRecordDelayMs: TimingMetricUint64;
  boundaryDiscrepancyMs: TimingMetricInt64;
  observedWindowMs: TimingMetricUint64;
  command: Category;
  compaction: Category;
  reasoning: Category;
  /**
   * Masks 0..7: command bit 1, compaction bit 2, reasoning bit 4.
   */
  intersectionMasksMs: TimingMetricUint64[];
  coveredMs: TimingMetricUint64;
  unclassifiedMs: TimingMetricUint64;
  coverageRatio: TimingMetricDouble;
  waitingProxyMs: TimingMetricUint64;
  strictResponseGapMs: TimingMetricUint64;
  exploratoryGapMs: TimingMetricUint64;
}
export interface TimingMetricUint64 {
  value: number | null;
  status: MetricStatus;
  basis: Basis;
  evidenceRefs: string[];
}
export interface Category {
  candidates: TimingMetricUint64;
  closed: TimingMetricUint64;
  unionMs: TimingMetricUint64;
  sumMs: TimingMetricUint64;
}
export interface TimingMetricDouble {
  value: number | null;
  status: MetricStatus;
  basis: Basis;
  evidenceRefs: string[];
}
export interface Context {
  activeContextOccupancy: TimingMetricDouble;
  compactionRecords: TimingMetricUint64;
  compactionTimeMs: TimingMetricUint64;
  method: string;
  quantileMethod: string;
  candidates: TimingMetricUint64;
  conflictingMeasurements: TimingMetricUint64;
  conflictingWindowRecords: TimingMetricUint64;
  input: Distribution;
  ratio: Distribution;
  segmentCount: TimingMetricUint64;
  segments: Segment[];
  compactionNeighbors: CompactionNeighbors[];
  detail: Capability;
}
export interface Distribution {
  samples: TimingMetricUint64;
  median: TimingMetricDouble;
  p90: TimingMetricDouble;
}
export interface Segment {
  id: string;
  candidates: TimingMetricUint64;
  nonRequestScoped: TimingMetricUint64;
  missingRawInput: TimingMetricUint64;
  missingWindow: TimingMetricUint64;
  invalidWindow: TimingMetricUint64;
  sameRecordWindows: TimingMetricUint64;
  continuedWindows: TimingMetricUint64;
  aboveWindow: TimingMetricUint64;
  input: Distribution;
  ratio: Distribution;
}
export interface CompactionNeighbors {
  evidenceRef: string;
  segmentId: string;
  before?: Neighbor | null;
  after?: Neighbor | null;
}
export interface Neighbor {
  measurementRef: string;
  rawInput: TimingMetricUint64;
  ratio: TimingMetricDouble;
  distanceMs: TimingMetricUint64;
}
export interface Work {
  operationCandidates: TimingMetricUint64;
  closedOperations: TimingMetricUint64;
  failedOperations: TimingMetricUint64;
  labelledCommandMs: TimingMetricUint64;
  fileChangeRecords: TimingMetricUint64;
  changedFiles: TimingMetricUint64;
  addedLines: TimingMetricUint64;
  removedLines: TimingMetricUint64;
  messageRecordCandidates: TimingMetricUint64;
  nonemptyVisibleContentRecords: TimingMetricUint64;
  unknownContentRecords: TimingMetricUint64;
  missingContentTimeRecords: TimingMetricUint64;
  userBoundaryRecords: TimingMetricUint64;
  injectedContextRecords: TimingMetricUint64;
  reasoningMessageRecords: TimingMetricUint64;
  compactionRecords: TimingMetricUint64;
  repositoryBaseline: Capability;
}
export interface Finding {
  code: string;
  kind: FindingKind;
  metricRefs: string[];
  evidenceRefs: string[];
}
export interface Coverage {
  facts: TimingMetricUint64;
  bytes: TimingMetricUint64;
  metadata: TimingMetricUint64;
  eventBlocks: TimingMetricUint64;
  scopedEvents: TimingMetricUint64;
  scopedMeasurements: TimingMetricUint64;
  boundaryCandidates: TimingMetricUint64;
  lifecycleCandidates: TimingMetricUint64[];
  linkedLifecycles: TimingMetricUint64[];
  conflictingLifecycles: TimingMetricUint64;
  missingIdentityLifecycles: TimingMetricUint64;
  contentCandidates: TimingMetricUint64;
  domainCount: TimingMetricUint64;
  missingWatermarks: TimingMetricUint64;
  generationMismatches: TimingMetricUint64;
  incompleteDomains: TimingMetricUint64;
  snapshotUnassignedTotal: TimingMetricUint64;
  threadUnassignedTotal: TimingMetricUint64;
  sourceStatus: string;
}
export interface Quality {
  partial: boolean;
  running: boolean;
  censored: boolean;
  reasonCodes: Basis[];
  factLimit: number;
  summaryLimitBytes: number;
}
/**
 * Internal selector observation; not a request option or source capability.
 */
export interface QueryFreshness {
  status: string;
  checkedAt?: string | null;
  revision?: number | null;
  errorCode?: string | null;
}
export interface EvidenceIndex {
  collections: EvidenceCollection[];
  available: boolean;
  limit: number;
  snapshotId: string;
  refs: string[];
  method: string;
}
export interface EvidenceCollection {
  reference: string;
  kind: CollectionKind;
  snapshotId: string;
  scope: LocalScope;
  count: TimingMetricUint64;
  method: string;
}
