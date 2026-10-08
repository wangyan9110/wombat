/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "preview" | "send";

export interface Request {
  action?: Action & string;
  roots?: string[] | null;
  projectRoots?: string[] | null;
  project?: string | null;
  sourceInstanceId?: string | null;
  readView?: string | null;
  decisionRevision?: string | null;
  ruleOverrides?: RuleOverrides | null;
  suggestionIds?: string[] | null;
  selectionVersion?: string | null;
  language?: string | null;
  withoutSkill?: boolean | null;
  skillSelections?: Selection[] | null;
}
export interface RuleOverrides {
  agentsBytes?: number | null;
  descriptionCharacters?: number | null;
}
export interface Selection {
  projectId: string;
  path: string;
}
