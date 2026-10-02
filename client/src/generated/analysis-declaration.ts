/* Generated from Rust. Run pnpm contracts:generate. */

/**
 * Existing, user-maintained .wombat/analysis.json; it declares intent, never host loading.
 */
export interface AnalysisDeclaration {
  version: number;
  chains?: DeclaredChain[];
  copies?: DeclaredCopy[];
}
export interface DeclaredChain {
  id: string;
  /**
   * Project-relative paths that the user explicitly declares jointly applicable.
   */
  files: string[];
}
export interface DeclaredCopy {
  id: string;
  source: string;
  copy: string;
  /**
   * First supported version: identity-v1. Other transforms stay unknown.
   */
  transform: string;
}
