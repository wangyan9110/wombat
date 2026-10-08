/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "status" | "events" | "configure" | "pause" | "resume";
export type Mode = "logs" | "hooks";
export type State = "logs_only" | "waiting" | "received" | "paused";
export type EventKind =
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "PermissionRequest"
  | "PreCompact"
  | "PostCompact"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop"
  | "Interrupt";
export type AssociationState = "unknown" | "linked" | "unavailable";

export interface Response {
  outputVersion: number;
  action: Action;
  checkedAt: string;
  mode: Mode;
  state: State;
  received: number;
  buffered: number;
  gaps: number;
  identityUnknown: number;
  lastReceivedAt?: string | null;
  events: EventRow[];
  nextAfter?: number | null;
  eventLimit: number;
  bufferLimit: number;
}
export interface EventRow {
  sequence: number;
  receivedAt: string;
  buffered: boolean;
  observation: Observation;
  association: Association;
}
export interface Observation {
  id: string;
  sourceInstanceId: string;
  sessionId: string;
  turnId?: string | null;
  toolUseId?: string | null;
  agentId?: string | null;
  project?: string | null;
  kind: EventKind;
  occurredAt?: string | null;
  nativeIdentity: boolean;
}
export interface Association {
  state: AssociationState;
  threadId?: string | null;
  turnId?: string | null;
  sourceEpoch?: string | null;
}
