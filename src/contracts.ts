export const SCHEMA_VERSION = 1;

export type Agent = 'codex' | 'claude' | string;
export type ModuleState = 'success' | 'partial' | 'empty' | 'unsupported' | 'permission_denied' | 'failed' | 'cancelled';

export interface ModuleResult {
  state: ModuleState;
  source: string;
  detail?: string;
  count?: number;
  version?: string;
}

export interface ScanScope {
  workspace: string;
  since: string;
  until: string;
  timezone: string;
  sourceDirs: Record<string, string[]>;
}

export interface UsageRow {
  period: string;
  agent: string;
  session?: string;
  models: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  costUSD: number | null;
  pricing: 'priced' | 'unpriced' | 'unknown' | 'hidden';
  raw: Record<string, unknown>;
}

export interface UsageSection {
  kind: 'daily' | 'weekly' | 'monthly' | 'session';
  rows: UsageRow[];
  totals: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

export interface UsageData {
  engine: 'ccusage';
  version: string;
  sections: Partial<Record<UsageSection['kind'], UsageSection>>;
  status: ModuleResult[];
}

export interface Resource {
  id: string;
  agent: Agent;
  kind: 'rule' | 'skill' | 'mcp' | 'config';
  name: string;
  path: string;
  scope: 'user' | 'workspace';
  source: string;
  sizeBytes: number | null;
  fileCount: number | null;
  sha256: string | null;
  configured: boolean;
  loaded: 'observed' | 'unverified';
  used: 'observed' | 'unverified';
  linkedPath?: string;
  detail?: string;
}

export interface EvidenceRef {
  file: string;
  line: number;
  sha256?: string;
  sessionId?: string;
  eventId?: string;
}

export interface CodexEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: 'tool_call' | 'tool_output' | 'compaction' | 'error';
  tool?: string;
  target?: string;
  bytes?: number;
  outputSha256?: string;
  callId?: string;
  evidence: EvidenceRef;
}

export interface Session {
  id: string;
  agent: Agent;
  workspace: string | null;
  startedAt: string | null;
  lastActivityAt: string | null;
  sourceFile: string;
  eventCount: number;
}

export interface Finding {
  id: string;
  ruleId: string;
  ruleVersion: string;
  severity: 'info' | 'review' | 'actionable';
  confidence: 'fact' | 'indication' | 'needs_review';
  title: string;
  fact: string;
  hypothesis: string | null;
  recommendation: string | null;
  diff: string | null;
  agent: Agent;
  workspace: string | null;
  sessionId?: string;
  evidence: EvidenceRef[];
}

export interface ScanSnapshot {
  schemaVersion: number;
  snapshotId: string;
  createdAt: string;
  scope: ScanScope;
  modules: ModuleResult[];
  usage: UsageData | null;
  resources: Resource[];
  sessions: Session[];
  events: CodexEvent[];
  findings: Finding[];
  warnings: string[];
}

export function assertSafeInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field}: expected non-negative safe integer`);
  }
  return value;
}

export function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field}: expected object`);
  return value as Record<string, unknown>;
}

export function assertSnapshot(value: unknown): ScanSnapshot {
  const data = asObject(value, 'snapshot');
  if (data.schemaVersion !== SCHEMA_VERSION) throw new Error(`snapshot.schemaVersion: unsupported ${String(data.schemaVersion)}`);
  if (typeof data.snapshotId !== 'string') throw new Error('snapshot.snapshotId: expected string');
  if (!Array.isArray(data.modules) || !Array.isArray(data.resources) || !Array.isArray(data.findings)) {
    throw new Error('snapshot: missing collections');
  }
  return value as ScanSnapshot;
}
