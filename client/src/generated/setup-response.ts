/* Generated from Rust. Run pnpm contracts:generate. */

export type DiscoveryStatus = "available" | "ambiguous" | "disabled" | "missing" | "unavailable" | "selection_changed";
export type HookRegistryStatus = "unavailable" | "partial" | "observed";
export type HookTrust = "managed" | "untrusted" | "trusted" | "modified";
export type HookHandler = "command" | "mcpTool" | "prompt" | "agent";

export interface Response {
  outputVersion: number;
  checkedAt: string;
  project?: string | null;
  nativeVersion?: string | null;
  discovery: Discovery;
  hooks?: HookRegistry | null;
  runtimeCapabilities: string[];
  marketplacePath?: string | null;
  errorCodes: string[];
}
export interface Discovery {
  status: DiscoveryStatus;
  instances: Instance[];
  errorCode?: string | null;
}
export interface Instance {
  name: string;
  path: string;
  enabled: boolean;
}
/**
 * A current native registry observation; it never proves that a Hook ran.
 */
export interface HookRegistry {
  nativeVersion?: string | null;
  checkedAt?: string | null;
  status: HookRegistryStatus;
  contexts: HookContext[];
}
export interface HookContext {
  project: string;
  complete: boolean;
  registrations: HookRegistration[];
}
export interface HookRegistration {
  itemId: string;
  nativeKey: string;
  contentHash: string;
  registrationHash: string;
  enabled: boolean;
  trust: HookTrust;
  handler: HookHandler;
  source: string;
  pluginId?: string | null;
}
