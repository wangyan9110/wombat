/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "list" | "upsert" | "remove" | "check" | "acknowledge";
export type Period = "day" | "week" | "month";
export type NotificationKind = "budget_warning" | "budget_exceeded" | "period_review";
export type TokenAnalysisScope = "selected_canonical_measurements";
export type Presentation = "distribution" | "details" | "projects" | "models";

export interface Response {
  action: Action;
  snapshotId?: string | null;
  outputVersion: number;
  plans: Plan[];
  /**
   * Most recent 100 notifications. New checks return only newly created notifications.
   */
  notifications: Notification[];
  checkedAt: string;
  hostRequired: boolean;
}
export interface Plan {
  id: string;
  enabled: boolean;
  period: Period;
  /**
   * Identity filters and timezone only; date, undated, thread and turn filters are rejected.
   */
  scope?: Scope;
  /**
   * Token budget, not an account allowance or money allocation to tools.
   */
  tokenLimit?: number | null;
  /**
   * Fraction in (0,1]; 0.8 by default.
   */
  warningRatio?: number | null;
  review: boolean;
}
export interface Scope {
  allTime?: boolean | null;
  timezone?: string | null;
  since?: string | null;
  until?: string | null;
  agentKind?: string | null;
  sourceInstanceId?: string | null;
  model?: string | null;
  modelUnknown?: boolean | null;
  effortUnknown?: boolean | null;
  undated?: boolean | null;
  reasoningEffort?: string | null;
  project?: string | null;
  projectUnknown?: boolean | null;
  threadId?: string | null;
  /**
   * Exact turn inspection, always bound to a selected thread.
   */
  turnId?: string | null;
}
export interface Notification {
  /**
   * Authorized source set used for these facts and notification deduplication.
   */
  sourceInstanceIds: string[];
  id: string;
  planId: string;
  planRevision: string;
  kind: NotificationKind;
  checkedAt: string;
  snapshotRef: SnapshotRef;
  scope: Scope;
  summary: UsageSummary;
  statistics: TaskStatistics;
  partial: boolean;
  acknowledged: boolean;
}
export interface SnapshotRef {
  snapshotId: string;
  createdAt: string;
}
export interface UsageSummary {
  /**
   * All input, including cache reads and writes. Existing tokens.input stays uncached.
   */
  inputTotal?: number | null;
  cacheHitRate?: number | null;
  unpricedTokens?: number | null;
  tokens: TokenUsage;
  tokenAnalysis: TokenAnalysis;
  price: PriceResult;
  measurementCount: number;
}
export interface TokenUsage {
  input?: number | null;
  cacheRead?: number | null;
  cacheCreate?: number | null;
  output?: number | null;
  /**
   * Subset of output, never an additional billable category.
   */
  reasoning?: number | null;
  total?: number | null;
  /**
   * Source input including caches; retained for request-level price conditions.
   */
  rawInput?: number | null;
}
/**
 * Token subtotals are scoped to the canonical measurements selected by this query.
 * Existing `tokens` fields remain complete totals; partial observations live here.
 */
export interface TokenAnalysis {
  methodVersion: number;
  scope: TokenAnalysisScope;
  fields: TokenFields;
  /**
   * Independent analysis; immutable historical review items may contain only
   * the native observations captured when the user made the decision.
   */
  totalAnalysis?: AnalyzedTokenTotal | null;
}
export interface TokenFields {
  input: ObservedTokenSubtotal;
  cacheRead: ObservedTokenSubtotal;
  cacheCreate: ObservedTokenSubtotal;
  output: ObservedTokenSubtotal;
  reasoning: ObservedTokenSubtotal;
  total: ObservedTokenSubtotal;
  rawInput: ObservedTokenSubtotal;
}
/**
 * An observed subtotal never implies that unavailable records contributed zero.
 */
export interface ObservedTokenSubtotal {
  observedSubtotal?: number | null;
  coveredRecords: number;
  missingRecords: number;
  conflictingRecords: number;
  invalidRecords: number;
  indeterminateRecords: number;
}
export interface AnalyzedTokenTotal {
  methodVersion: number;
  subtotal?: number | null;
  coveredRecords: number;
  recordedRecords: number;
  /**
   * Unavailable native totals use recorded input (including caches) plus output
   * only for an identified response grain. Reasoning is already in output.
   */
  calculatedRecords: number;
  unavailableRecords: number;
  /**
   * Alternative records excluded by individual or combined safe-integer limits.
   */
  overflowRecords: number;
}
export interface PriceResult {
  currency: string;
  policy: string;
  priceRevision: string;
  /**
   * Present only when every applicable Token category has a known amount.
   */
  cost?: string | null;
  knownCost: string;
  /**
   * priced, partial, unknown
   */
  status: string;
  components: PriceComponent[];
  basis: PriceBasis[];
  issues: string[];
}
export interface PriceComponent {
  category: string;
  tokens?: number | null;
  cost?: string | null;
  knownCost: string;
  status: string;
  ratePerMillion?: string | null;
}
export interface PriceBasis {
  originalModel: string;
  pricingModel: string;
  modelProvider: string;
  apiProvider?: string | null;
  matchMethod: string;
  source: string;
  verifiedAt: string;
  priceRevision: string;
  catalogHash: string;
  /**
   * standard, longContext, conditionUnknown
   */
  condition: string;
  requestInputTokens?: number | null;
  requestScoped: boolean;
}
export interface TaskStatistics {
  selectedTask?: TaskTypicality | null;
  methodVersion: number;
  /**
   * Linear interpolation at (n-1)p, shared with timing distributions.
   */
  quantileMethod: string;
  population: TaskPopulation;
  dimension?: Presentation | null;
  /**
   * A task using several models occurs in each model population; counts are not additive.
   */
  groups: TaskStatisticsGroup[];
  growth?: TaskGrowth | null;
}
export interface TaskTypicality {
  threadId: string;
  tokens?: number | null;
  completePopulationTasks: number;
  /**
   * Midrank: (number below + half of ties) / complete sample size.
   */
  percentileRank?: number | null;
  aboveP90?: boolean | null;
}
export interface TaskPopulation {
  measuredTasks: number;
  completeTasks: number;
  incompleteTasks: number;
  completeTaskTokens?: number | null;
  meanTokens?: number | null;
  medianTokens?: number | null;
  p90Tokens?: number | null;
  unassignedUsage: UsageSummary;
}
export interface TaskStatisticsGroup {
  key?: string | null;
  population: TaskPopulation;
}
export interface TaskGrowth {
  baselineScope: Scope;
  baseline: TaskPopulation;
  taskCountDelta: number;
  meanTokensDelta?: number | null;
  /**
   * Symmetric arithmetic decomposition: ΔN × (μ0+μ1)/2.
   * Only available for complete, nonempty populations; never a causal attribution.
   */
  taskCountContribution?: number | null;
  /**
   * Δμ × (N0+N1)/2; sums with count contribution to attributed token growth.
   */
  perTaskContribution?: number | null;
  attributedTokenDelta?: number | null;
  unassignedTokenDelta?: number | null;
}
