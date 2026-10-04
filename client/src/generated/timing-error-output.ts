/* Generated from Rust. Run pnpm contracts:generate. */

/**
 * CLI error output; core/socket transports retain their standard failure envelope.
 */
export interface TimingErrorOutput {
  outputVersion: number;
  error: TimingError;
}
export interface TimingError {
  code: string;
  message: string;
}
