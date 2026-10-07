/* Generated from Rust. Run pnpm contracts:generate. */

export type TokenBasis = "analyzed_totals";
export type AutomaticStatus = "checking" | "updated" | "unchanged" | "failed";
export type ProjectLoadState = "pending" | "loading" | "ready";
export type Action = "refresh" | "usage" | "threads" | "turns" | "steps";
export type TokenAnalysisScope = "selected_canonical_measurements";
export type Item =
  | {
      date?: string | null;
      /**
       * Inclusive display date. Scope.until remains exclusive for queries.
       */
      endDate?: string | null;
      isSubtotal: boolean;
      model?: string | null;
      reasoningEffort?: string | null;
      usage: UsageSummary;
      scope: Scope;
      share?: number | null;
      costShare?: number | null;
      kind: "usage";
    }
  | {
      id: string;
      upstreamId?: string | null;
      matchedLastActivityAt?: string | null;
      agentKind: string;
      sourceInstanceId: string;
      title?: string | null;
      project?: string | null;
      startedAt?: string | null;
      lastActivityAt?: string | null;
      models: string[];
      reasoningEfforts: string[];
      /**
       * Distinct turns with measurements in the current thread-list scope.
       * None means the matched source records provide no turn association.
       */
      matchedTurnCount?: number | null;
      matchedUsage: UsageSummary;
      threadUsage: UsageSummary;
      kind: "thread";
    }
  | {
      id: string;
      threadId: string;
      ordinal?: number | null;
      startedAt?: string | null;
      endedAt?: string | null;
      /**
       * Latest reliable source event time, independent of ordinal and metering.
       */
      lastActivityAt?: string | null;
      status: string;
      models: string[];
      reasoningEfforts: string[];
      usage: UsageSummary;
      matchedUsage: UsageSummary;
      share?: number | null;
      costShare?: number | null;
      kind: "turn";
    }
  | {
      matchesScope?: boolean;
      id: string;
      threadId?: string | null;
      turnId?: string | null;
      timestamp?: string | null;
      model?: string | null;
      reasoningEffort?: string | null;
      usage: UsageSummary;
      share?: number | null;
      costShare?: number | null;
      sequence: number;
      timePrecision: string;
      kind: "measurement";
    }
  | {
      id: string;
      threadId: string;
      turnId?: string | null;
      timestamp?: string | null;
      name: string;
      status: string;
      sequence: number;
      timePrecision: string;
      operationType: string;
      exitCode?: number | null;
      durationMs?: number | null;
      path?: string | null;
      server?: string | null;
      tool?: string | null;
      kind: "operation";
    };

export interface Response {
  outputVersion: number;
  result: Response1;
  freshness: Freshness;
}
export interface Response1 {
  facets?: Facets | null;
  distribution?: Distribution | null;
  priceUpdate?: Automatic | null;
  freshness?: Freshness | null;
  outputVersion: number;
  action: Action;
  snapshotRef: SnapshotRef;
  scope: Scope;
  availableRange: AvailableRange;
  summary: UsageSummary;
  items: Item[];
  page: Page;
  quality: Quality;
}
/**
 * Observed dimensions, not a project registry or a configuration inventory.
 */
export interface Facets {
  /**
   * Metadata across this snapshot's authorized sources, independent of measurement/date filters.
   */
  discoveredThreadCount?: number | null;
  directories: string[];
  hasUnassigned: boolean;
  models: string[];
  reasoningEfforts: string[];
  agents: string[];
}
export interface Distribution {
  unpricedTokens?: number | null;
  /**
   * Basis for maxTokens and peak token scopes/dates.
   */
  tokenBasis: TokenBasis;
  /**
   * Maximum of bucket analyzed subtotals; not necessarily a complete total.
   */
  maxTokens?: number | null;
  maxCost?: string | null;
  peakTokenDates: (string | null)[];
  peakCostDates: (string | null)[];
  peakTokenScopes: Scope[];
  peakCostScopes: Scope[];
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
}
export interface Automatic {
  status: AutomaticStatus;
  attemptId: string;
  attemptedAt: string;
  retryAt: string;
  errorCode?: string | null;
}
export interface Freshness {
  /**
   * Projects restored from committed facts; pending projects are not zero usage.
   */
  projectLoads?: ProjectLoad[];
  status: string;
  /**
   * Ephemeral task headers; no completed ledger or coverage is available yet.
   */
  initialScan?: boolean;
  checkedAt?: string | null;
  revision: string;
  error?: string | null;
  errorCode?: string | null;
}
export interface ProjectLoad {
  project?: string | null;
  state: ProjectLoadState;
}
export interface SnapshotRef {
  snapshotId: string;
  createdAt: string;
}
export interface AvailableRange {
  since?: string | null;
  /**
   * Exclusive local date boundary.
   */
  until?: string | null;
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
export interface Page {
  offset: number;
  limit: number;
  total: number;
  nextOffset?: number | null;
}
export interface Quality {
  status: string;
  issues: Issue[];
  sources: SourceReport[];
}
export interface Issue {
  code: string;
  message: string;
  sourceInstanceId?: string | null;
  evidence?: EvidenceRef | null;
}
export interface EvidenceRef {
  file: string;
  line: number;
}
export interface SourceReport {
  source: SourceInstance;
  adapterVersion: string;
  sourceVersions?: string[];
  capabilities: Capabilities;
  /**
   * complete, partial, failed, notFound, cancelled
   */
  status: string;
  filesRead: number;
  bytesRead: number;
  issues: Issue[];
}
export interface SourceInstance {
  id: string;
  agentKind: string;
  root: string;
}
export interface Capabilities {
  usage: boolean;
  threads: boolean;
  turns: boolean;
  operations: boolean;
  reasoningEffort: boolean;
  responseIdentity: boolean;
  measurementGrain: string[];
}
