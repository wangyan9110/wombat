import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SCHEMA_VERSION, type ModuleResult, type ScanSnapshot } from './contracts.js';
import { scanEnvironment } from './environment.js';
import { scanCodexSessions } from './codex.js';
import { inspectRuleFile } from './rules.js';
import { collectUsage, normalizeRange, validateSourceDirs, validateTimezone } from './usage.js';

export interface ScanOptions {
  workspace: string;
  since?: string;
  until?: string;
  timezone?: string;
  sourceDirs?: Record<string, string[]>;
  noCost?: boolean;
  signal?: AbortSignal;
}

export async function scan(options: ScanOptions): Promise<ScanSnapshot> {
  const workspace = await fs.realpath(path.resolve(options.workspace));
  const stat = await fs.stat(workspace);
  if (!stat.isDirectory()) throw new Error(`不是目录：${workspace}`);
  const timezone = validateTimezone(options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const range = normalizeRange(options.since, options.until, timezone);
  const sourceDirs = options.sourceDirs ?? {};
  validateSourceDirs(sourceDirs);
  const snapshot: ScanSnapshot = {
    schemaVersion: SCHEMA_VERSION, snapshotId: randomUUID(), createdAt: new Date().toISOString(),
    scope: { workspace, since: range.since, until: range.until, timezone, sourceDirs },
    modules: [], usage: null, resources: [], sessions: [], events: [], findings: [], warnings: [],
  };
  const environment = await scanEnvironment(workspace, sourceDirs);
  snapshot.resources = environment.resources;
  snapshot.modules.push(...environment.status);
  snapshot.warnings.push(...environment.warnings);
  const usage = await collectUsage({ ...range, timezone, noCost: options.noCost, sourceDirs, signal: options.signal });
  snapshot.usage = usage;
  snapshot.modules.push(...usage.status);
  const codexHome = sourceDirs.codex?.[0];
  const codex = await scanCodexSessions(range.since, range.until, codexHome ? path.join(codexHome, 'sessions') : undefined);
  snapshot.sessions = codex.sessions; snapshot.events = codex.events;
  snapshot.findings.push(...codex.findings); snapshot.modules.push(codex.status); snapshot.warnings.push(...codex.warnings);
  for (const file of environment.ruleFiles) {
    try { snapshot.findings.push(...await inspectRuleFile(file, workspace)); }
    catch (error) { snapshot.warnings.push(`规则检查失败 ${file}: ${String(error)}`); }
  }
  const ruleState: ModuleResult = {
    source: 'rules:AGENTS.md', state: snapshot.warnings.some(w => w.includes('规则')) ? 'partial' : 'success',
    count: snapshot.findings.filter(f => f.ruleId.startsWith('rules.')).length,
  };
  snapshot.modules.push(ruleState);
  snapshot.findings.sort((a, b) => {
    const weight = { actionable: 3, review: 2, info: 1 };
    return weight[b.severity] - weight[a.severity] || a.title.localeCompare(b.title);
  });
  return snapshot;
}
