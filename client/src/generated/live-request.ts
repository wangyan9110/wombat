/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "refresh" | "usage" | "threads" | "turns" | "steps";
export type Group = "day" | "week" | "month";
export type Sort = "tokens" | "recent" | "time";
export type Mode = "auto" | "fresh" | "cached";

export interface Request {
  query: Request1;
  mode?: Mode & string;
  verify?: boolean;
}
export interface Request1 {
  action: Action;
  snapshotId?: string | null;
  roots?: string[] | null;
  scope?: Scope;
  group?: Group | null;
  sort?: Sort | null;
  threadId?: string | null;
  turnId?: string | null;
  search?: string | null;
  offset?: number | null;
  limit?: number | null;
}
export interface Scope {
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
  threadId?: string | null;
}
