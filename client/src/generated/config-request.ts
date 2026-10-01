/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "list" | "detail" | "evidence" | "related_scopes" | "capabilities";
export type Kind = "rule" | "skill" | "mcp";
export type Observation = "used" | "loaded_only" | "unknown";
export type Sort = "tokens" | "activity" | "size" | "name";

export interface Request {
  action?: Action & string;
  roots?: string[] | null;
  projectRoots?: string[] | null;
  snapshotId?: string | null;
  readView?: string | null;
  scope?: Scope;
  kind?: Kind | null;
  observation?: Observation | null;
  search?: string | null;
  sort?: Sort & string;
  itemId?: string | null;
  offset?: number | null;
  limit?: number | null;
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
