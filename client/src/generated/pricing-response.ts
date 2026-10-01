/* Generated from Rust. Run pnpm contracts:generate. */

export type AutomaticStatus = "checking" | "updated" | "unchanged" | "failed";
export type Action = "status" | "update" | "auto_update";

export interface Response {
  automatic?: Automatic | null;
  downloadRequired?: boolean;
  outputVersion: number;
  action: Action;
  origin: string;
  updated: boolean;
  source: string;
  sourceHash?: string | null;
  catalogHash: string;
  catalog: Catalog;
}
export interface Automatic {
  status: AutomaticStatus;
  attemptId: string;
  attemptedAt: string;
  retryAt: string;
  errorCode?: string | null;
}
export interface Catalog {
  revision: string;
  verifiedAt: string;
  policy: string;
  currency: string;
  models: ModelPrice[];
}
export interface ModelPrice {
  id: string;
  aliases: string[];
  source: string;
  rates: Rates;
  longContext?: LongContext | null;
}
export interface Rates {
  input?: string | null;
  cacheRead?: string | null;
  cacheCreate?: string | null;
  output?: string | null;
}
export interface LongContext {
  inputAbove: number;
  rates: Rates;
}
