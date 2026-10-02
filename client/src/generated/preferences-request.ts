/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "get" | "set";
export type Language = "zh" | "en";

export interface Request {
  action: Action;
  language?: Language | null;
}
