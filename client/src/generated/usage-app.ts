/* Generated from Rust. Run pnpm contracts:generate. */

export type AutomaticStatus = "checking" | "updated" | "unchanged" | "failed";
export type Action = "refresh" | "usage" | "threads" | "turns" | "steps";
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
  status: string;
  checkedAt?: string | null;
  revision: string;
  error?: string | null;
  errorCode?: string | null;
}
export interface SnapshotRef {
  snapshotId: string;
  createdAt: string;
  /**
   * Fixed selector for externally located legacy files; v3 uses snapshotId.
   */
  selector?: string | null;
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
