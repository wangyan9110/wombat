/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "status" | "update" | "auto_update";

export interface Request {
  action: Action;
}
