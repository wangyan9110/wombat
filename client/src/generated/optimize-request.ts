/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "list" | "detail" | "ignore" | "mark_edited" | "restore" | "recheck" | "capabilities";
export type Group = "pending" | "history";
export type Category = "repair" | "trim" | "organize" | "space";

export interface Request {
  action?: Action & string;
  roots?: string[] | null;
  projectRoots?: string[] | null;
  readView?: string | null;
  decisionRevision?: string | null;
  project?: string | null;
  sourceInstanceId?: string | null;
  suggestionId?: string | null;
  group?: Group & string;
  category?: Category | null;
  offset?: number | null;
  limit?: number | null;
  ruleOverrides?: RuleOverrides | null;
}
export interface RuleOverrides {
  agentsBytes?: number | null;
  descriptionCharacters?: number | null;
}
