/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "list" | "detail" | "evidence" | "related_scopes" | "capabilities";
export type Kind = "rule" | "skill" | "mcp";
export type Observation = "used" | "loaded_only" | "unknown";

export interface Response {
  outputVersion: number;
  action: Action;
  capabilities: Capabilities;
  readView?: string | null;
  usageRevision?: string | null;
  configRevision: string;
  checkedAt: string;
  scope: Scope;
  authorizedProjects: string[];
  summary: Summary;
  items: Item[];
  evidence: Evidence[];
  relatedScopes: RelatedScope[];
  page: Page;
  coverage: Coverage;
}
export interface Capabilities {
  kinds: Kind[];
  evidenceTypes: string[];
  tokenEstimates: boolean;
  historicalContent: boolean;
  writes: boolean;
  projectRegistry: boolean;
}
export interface Scope {
  since?: string | null;
  until?: string | null;
  timezone?: string | null;
  project?: string | null;
  agentKind?: string | null;
  sourceInstanceId?: string | null;
  threadId?: string | null;
}
export interface Summary {
  currentItems: number;
  historicalItems: number;
  observedItems: number;
  usage?: UsageSummary | null;
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
export interface Item {
  id: string;
  name: string;
  kind: Kind;
  sourceInstanceId: string;
  path: string;
  project?: string | null;
  nativeKey?: string | null;
  configuredState: string;
  contentHash: string;
  observedAt: string;
  current: boolean;
  stale: boolean;
  bytes?: number | null;
  contentTokens?: number | null;
  estimateStatus: string;
  observation: Observation;
  counts: Counts;
  relatedTurns: number;
  usage?: UsageSummary | null;
}
export interface Counts {
  fileReads: number;
  toolCalls: number;
  succeeded: number;
  failed: number;
  outcomeUnknown: number;
}
export interface Evidence {
  id: string;
  itemId: string;
  threadId: string;
  turnId?: string | null;
  title?: string | null;
  project?: string | null;
  timestamp?: string | null;
  eventType: string;
  outcome: string;
  association: string;
  usage?: UsageSummary | null;
}
export interface RelatedScope {
  project?: string | null;
  evidenceCount: number;
  usage?: UsageSummary | null;
}
export interface Page {
  offset: number;
  limit: number;
  total: number;
  nextOffset?: number | null;
}
export interface Coverage {
  status: string;
  historyStatus: string;
  issues: Issue[];
  supportedEvidence: string[];
  absenceObservable: boolean;
}
export interface Issue {
  code: string;
  path?: string | null;
}
