/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "read" | "refresh";

export interface Request {
  action?: Action & string;
}
