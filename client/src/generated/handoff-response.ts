/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "preview" | "send";
export type RelationKind = "chain" | "copy";
export type HookTrust = "managed" | "untrusted" | "trusted" | "modified";
export type AllowanceStatus = "unknown" | "available" | "low" | "blocked";

export interface Response {
  outputVersion: number;
  action: Action;
  selectionVersion: string;
  readView: string;
  decisionRevision: string;
  projects: Project[];
  deliveries: Delivery[];
  allowanceChecks: AllowanceCheck[];
}
export interface Project {
  id: string;
  cwd: string;
  targets: Target[];
}
export interface Target {
  itemId: string;
  suggestionIds: string[];
  path: string;
  contentHash: string;
  expectedExists: boolean;
  sharedProjects: string[];
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
export interface Delivery {
  projectId: string;
  status: string;
  threadId?: string | null;
  nativeVersion?: string | null;
  errorCode?: string | null;
}
export interface AllowanceCheck {
  projectId: string;
  assessment: AllowanceAssessment;
}
export interface AllowanceAssessment {
  status: AllowanceStatus;
  model?: string | null;
  provider?: string | null;
  checkedAt?: string | null;
  /**
   * An observation deadline, not a prediction that allowance recovers then.
   */
  validUntil?: string | null;
  bucketId?: string | null;
  windowId?: string | null;
  reason: string;
}
