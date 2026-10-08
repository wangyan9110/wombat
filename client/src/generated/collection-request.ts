/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "status" | "events" | "configure" | "pause" | "resume";
export type Mode = "logs" | "hooks";

export interface Request {
  action?: Action & string;
  mode?: Mode | null;
  roots?: string[] | null;
  project?: string | null;
  sourceInstanceId?: string | null;
  after?: number | null;
  limit?: number | null;
}
