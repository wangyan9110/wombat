/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "list" | "detail" | "ignore" | "mark_edited" | "restore" | "recheck" | "capabilities";
export type HookSupportStatus = "no_verified_adapter";
export type Kind = "rule" | "skill" | "mcp";
export type Observation = "used" | "loaded_only" | "unknown";
export type Category = "repair" | "trim" | "organize" | "space";
export type RelationKind = "chain" | "copy";

export interface Response {
  outputVersion: number;
  action: Action;
  capabilities: Capabilities;
  readView?: string | null;
  configRevision: string;
  usageRevision?: string | null;
  decisionRevision: string;
  checkedAt: string;
  suggestions: Suggestion[];
  pending: number;
  history: number;
  page: Page;
  issues: Issue[];
  resultStatus: string;
  ruleParameters: RuleParameters;
}
export interface Capabilities {
  staticChecks: boolean;
  manualEditReview: boolean;
  decisions: boolean;
  inactivity: boolean;
  mcpFaults: boolean;
  spaceCleanup: boolean;
  previews: boolean;
  execution: boolean;
  recovery: boolean;
  loadingBudgetDiagnosis: boolean;
  exactInstructionBlocks: boolean;
  declaredCopyDrift: boolean;
  hookSupport: HookSupport;
}
export interface HookSupport {
  host?: string | null;
  hostVersion?: string | null;
  effectiveRegistry: boolean;
  status: HookSupportStatus;
}
export interface Suggestion {
  scopeProject?: string | null;
  id: string;
  item: Item;
  category: Category;
  status: string;
  findings: Finding[];
  checkedAt: string;
  ruleVersion: string;
  ruleParameters?: RuleParameters | null;
  recheckRuleParameters?: RuleParameters | null;
  /**
   * Exact measured metadata at manual-review marking; no source body is retained.
   */
  reviewBaseline?: Item | null;
  recordId?: string | null;
  recordedAt?: string | null;
}
export interface Item {
  id: string;
  name: string;
  kind: Kind;
  sourceInstanceId: string;
  path: string;
  project?: string | null;
  nativeKey?: string | null;
  /**
   * Authorized inventory memberships, not proof of joint host loading.
   */
  authorizedProjects?: string[];
  /**
   * Current physical object keeps each source inventory identity and observation.
   */
  sourceContexts?: SourceContext[];
  configuredState: string;
  contentHash: string;
  observedAt: string;
  current: boolean;
  stale: boolean;
  bytes?: number | null;
  contentTokens?: number | null;
  estimateStatus: string;
  characters?: number | null;
  measurementStatus?: string;
  bytesSource?: string | null;
  estimate?: ContentEstimate | null;
  skillMetadata?: SkillMetadata | null;
  bodyTokenEstimate?: ContentEstimate | null;
  bodyEstimateStatus?: string;
  usageCount?: number | null;
  lastRecordAt?: string | null;
  observation: Observation;
  counts: Counts;
  relatedTurns: number;
  usage?: UsageSummary | null;
}
export interface SourceContext {
  inventoryId: string;
  global?: boolean;
  sourceInstanceId: string;
  contentHash: string;
  configuredState: string;
  counts: Counts;
  observation: Observation;
  lastRecordAt?: string | null;
}
export interface Counts {
  fileReads: number;
  toolCalls: number;
  succeeded: number;
  failed: number;
  outcomeUnknown: number;
}
export interface ContentEstimate {
  tokens: number;
  encoding: string;
  method: string;
  payload: string;
  contentHash: string;
  applicability: string;
  tokenizerVersion?: string | null;
}
export interface SkillMetadata {
  status: string;
  descriptionCharacters?: number | null;
  issues: string[];
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
export interface Finding {
  rule: string;
  status: string;
  observed?: number | null;
  threshold?: number | null;
  evidenceCodes: string[];
  basis?: string | null;
  /**
   * Positions and relationships only; never retain source text or command arguments.
   */
  evidence?: StaticEvidence | null;
}
export interface StaticEvidence {
  method: string;
  applicability: string;
  declarationHash?: string | null;
  relationId?: string | null;
  direction?: string | null;
  transform?: string | null;
  versions: FileVersion[];
  positions: BlockPosition[];
  /**
   * Scope-bound owner; legacy evidence without this cannot prove a declared relation.
   */
  relation?: RelationIdentity | null;
}
export interface FileVersion {
  itemId: string;
  path: string;
  contentHash: string;
}
export interface BlockPosition {
  itemId: string;
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
  blockHash: string;
}
export interface RelationIdentity {
  sourceInstanceId: string;
  project: string;
  declarationPath: string;
  declarationHash: string;
  relationId: string;
  kind: RelationKind;
}
export interface RuleParameters {
  version: string;
  agentsBytesDefault: number;
  descriptionCharactersDefault: number;
  overrides: RuleOverrides;
  bodyTokens: number;
  descriptionStandardMax: number;
  applicability: string;
}
export interface RuleOverrides {
  agentsBytes?: number | null;
  descriptionCharacters?: number | null;
}
export interface Page {
  offset: number;
  limit: number;
  total: number;
  nextOffset?: number | null;
}
export interface Issue {
  code: string;
  path?: string | null;
}
