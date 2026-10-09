/* Generated from Rust. Run pnpm contracts:generate. */

export interface Description {
  outputVersion: number;
  runtimeVersion: string;
  methods: string[];
  methodDescriptions: {
    [k: string]: string;
  };
  selectedMethod?: string | null;
  inputSchema?: unknown;
  outputSchema?: unknown;
  stdinBytes: number;
  stdinTimeoutMs: number;
  stdoutBytes: number;
}
