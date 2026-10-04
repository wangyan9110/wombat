/* Generated from Rust. Run pnpm contracts:generate. */

export type Action = "list" | "choose" | "confirm" | "authorize" | "revoke";
export type Purpose = "source" | "project";

export interface Response {
  outputVersion: number;
  action: Action;
  grants: Grant[];
  chosenPath?: string | null;
  choiceToken?: string | null;
}
export interface Grant {
  id: string;
  purpose: Purpose;
  path: string;
  directoryIdentity: string;
  authorizedAt: string;
  status: string;
}
