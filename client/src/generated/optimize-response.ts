/* Generated from Rust. Run pnpm contracts:generate. */

export type Action =
  "list" | "detail" | "keep" | "not_applicable" | "redisplay" | "recheck" | "capabilities" | "checks";
export type HookSupportStatus = "no_verified_adapter" | "registry_observed" | "registry_partial";
export type Kind = "rule" | "skill" | "mcp" | "hook";
export type Observation = "used" | "loaded_only" | "unknown";
export type Category = "repair" | "trim" | "organize" | "space";
export type DecisionKind = "keep" | "not_applicable";
export type DecisionReason = "necessary" | "object_changed" | "incorrect_evidence";
export type RuleOutcome = "hit" | "miss" | "insufficient" | "unsupported" | "error";
export type RelationKind = "chain" | "copy";
export type HookTrust = "managed" | "untrusted" | "trusted" | "modified";
export type RecordKind = "observation" | "decision" | "recheck" | "redisplay";
export type FollowUpStatus = "no_observed_records" | "version_unknown" | "unavailable";

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
  ruleCatalog: RuleDefinition[];
  checks: RuleAssessment[];
  /**
   * Derived from the selected usage view; never stored as a user decision or receipt.
   */
  followUps: FollowUpObservation[];
}
export interface Capabilities {
  staticChecks: boolean;
  manualEditReview: boolean;
  decisions: boolean;
  inactivity: boolean;
  mcpFaults: boolean;
  spaceCleanup: boolean;
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
  decision?: UserDecision | null;
  /**
   * Current rule facts; user decisions never stand in for check outcomes.
   */
  checks: RuleAssessment[];
  findings: Finding[];
  checkedAt: string;
  ruleVersion: string;
  ruleParameters?: RuleParameters | null;
  recheckRuleParameters?: RuleParameters | null;
  /**
   * Exact metadata before rechecking; source bodies are never retained.
   */
  reviewBaseline?: Item | null;
  recordId?: string | null;
  recordedAt?: string | null;
  recordKind?: RecordKind | null;
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
  authorizedProjects: string[];
  /**
   * Current physical object keeps each source inventory identity and observation.
   */
  sourceContexts: SourceContext[];
  configuredState: string;
  contentHash: string;
  observedAt: string;
  current: boolean;
  stale: boolean;
  bytes?: number | null;
  contentTokens?: number | null;
  estimateStatus: string;
  characters?: number | null;
  measurementStatus: string;
  bytesSource?: string | null;
  estimate?: ContentEstimate | null;
  skillMetadata?: SkillMetadata | null;
  bodyTokenEstimate?: ContentEstimate | null;
  bodyEstimateStatus: string;
  usageCount?: number | null;
  lastRecordAt?: string | null;
  observation: Observation;
  counts: Counts;
  relatedTurns: number;
  relatedTasks: number;
  usage?: UsageSummary | null;
}
export interface SourceContext {
  inventoryId: string;
  global: boolean;
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
  resourceReads: number;
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
  /**
   * Bounded current-file diagnostics for directly reviewable static fields.
   */
  diagnostics: SkillDiagnostic[];
}
export interface SkillDiagnostic {
  code: string;
  field?: string | null;
  line?: number | null;
  column?: number | null;
  current?: string | null;
  expected?: string | null;
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
export interface UserDecision {
  kind: DecisionKind;
  reason: DecisionReason;
  recordedAt: string;
}
export interface RuleAssessment {
  rule: string;
  ruleVersion: string;
  itemId: string;
  contentVersion: string;
  checkedAt: string;
  outcome: RuleOutcome;
  reason?: string | null;
  findings: Finding[];
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
   * Scope-bound owner required to prove a declared relation.
   */
  relation?: RelationIdentity | null;
  references: ReferenceEvidence[];
  hook?: HookTargetEvidence | null;
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
export interface ReferenceEvidence {
  target: string;
  baseDirectory: string;
  expectedType?: string | null;
  status: string;
  startByte: number;
  endByte: number;
  startLine: number;
  endLine: number;
}
export interface HookTargetEvidence {
  project: string;
  nativeKey: string;
  registrationHash: string;
  hostVersion: string;
  trust: HookTrust;
  target: string;
  status: string;
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
export interface RuleDefinition {
  rule: string;
  version: string;
  kinds: Kind[];
  basis: string;
}
export interface FollowUpObservation {
  recordId: string;
  suggestionId: string;
  status: FollowUpStatus;
  after: string;
  observedAt: string;
  observedRecords?: number | null;
  lastRecordAt?: string | null;
  usageRevision?: string | null;
  absenceObservable: boolean;
}
