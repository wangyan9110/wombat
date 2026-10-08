/* Generated from Rust. Run pnpm contracts:generate. */

export type InstallationAction = "install" | "status" | "uninstall";
export type InstallationStatus = "absent" | "unmanaged" | "modified" | "installed";
export type DiscoveryStatus = "available" | "ambiguous" | "disabled" | "missing" | "unavailable" | "selection_changed";
export type DataStatus = "not_requested";

export interface Installation {
  outputVersion: number;
  action: InstallationAction;
  directory: string;
  status: InstallationStatus;
  version?: string | null;
  source?: string | null;
  discovery: Discovery;
  runtimeCapabilities: string[];
  dataStatus: DataStatus;
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
