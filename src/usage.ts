import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { asObject, assertSafeInteger, type ModuleResult, type UsageData, type UsageRow, type UsageSection } from './contracts.js';

export type UsageKind = UsageSection['kind'];
export const usageKinds: UsageKind[] = ['daily', 'weekly', 'monthly', 'session'];
export const CCUSAGE_VERSION = '20.0.24';

export interface UsageOptions {
  since: string;
  until: string;
  timezone: string;
  noCost?: boolean;
  sourceDirs?: Record<string, string[]>;
  signal?: AbortSignal;
}

const dirEnv: Record<string, string> = {
  codex: 'CODEX_HOME', claude: 'CLAUDE_CONFIG_DIR', opencode: 'OPENCODE_DATA_DIR',
  amp: 'AMP_DATA_DIR', droid: 'DROID_SESSIONS_DIR', pi: 'PI_AGENT_DIR',
  hermes: 'HERMES_HOME', goose: 'GOOSE_PATH_ROOT', qwen: 'QWEN_HOME',
};

export function validateSourceDirs(sourceDirs: Record<string, string[]> = {}): void {
  for (const [source, dirs] of Object.entries(sourceDirs)) {
    if (!dirEnv[source]) throw new Error(`不支持 --source-dir 来源：${source}`);
    if (!dirs.length || dirs.some(dir => !dir.trim())) throw new Error(`--source-dir ${source} 缺少目录`);
  }
}

export function validateTimezone(timezone: string): string {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); return timezone; }
  catch { throw new Error(`无效时区：${timezone}`); }
}

export function validateDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`日期需为 YYYY-MM-DD：${date}`);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error(`无效日期：${date}`);
  return date;
}

export function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${validateDate(date)}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function todayInTimezone(timezone: string): string {
  validateTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

export function normalizeRange(since: string | undefined, until: string | undefined, timezone: string): { since: string; until: string } {
  const today = todayInTimezone(timezone);
  const start = validateDate(since ?? shiftDate(today, -29));
  const end = validateDate(until ?? shiftDate(today, 1));
  if (start >= end) throw new Error('日期范围需满足 --since 早于 --until；结束日期不包含在范围内');
  return { since: start, until: end };
}

function localCliPath(): string {
  return createRequire(import.meta.url).resolve('ccusage/src/cli.js');
}

function envForSources(sourceDirs: Record<string, string[]>): NodeJS.ProcessEnv {
  validateSourceDirs(sourceDirs);
  const env = { ...process.env };
  for (const [source, dirs] of Object.entries(sourceDirs)) {
    const key = dirEnv[source];
    if (dirs.length) env[key] = dirs.join(',');
  }
  return env;
}

async function executeCcusage(kind: UsageKind, options: UsageOptions): Promise<Record<string, unknown>> {
  const cli = localCliPath();
  await fs.access(cli);
  const args = [cli, kind, '--json', '--offline', '--timezone', options.timezone,
    '--since', options.since.replaceAll('-', ''), '--until', shiftDate(options.until, -1).replaceAll('-', '')];
  if (kind !== 'session') args.push('--by-agent');
  if (options.noCost) args.push('--no-cost');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: envForSources(options.sourceDirs ?? {}), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 120_000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > 100_000_000) child.kill('SIGTERM'); });
    child.stderr.on('data', (chunk: string) => { stderr += chunk.slice(0, 8000); });
    options.signal?.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (options.signal?.aborted) { reject(new Error('已取消')); return; }
      if (code !== 0) { reject(new Error(`ccusage ${kind} 退出码 ${String(code)}：${stderr.trim().slice(0, 500)}`)); return; }
      try { resolve(asObject(JSON.parse(stdout), `ccusage ${kind}`)); }
      catch (error) { reject(new Error(`ccusage ${kind} JSON 无法解析：${String(error)}`)); }
    });
  });
}

function numberOrNull(value: unknown, field: string): number | null { return assertSafeInteger(value, field); }
function costOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }

export function normalizeUsageRow(rawValue: unknown, kind: UsageKind, noCost = false): UsageRow {
  const raw = asObject(rawValue, `${kind} row`);
  const period = String(raw.period ?? raw.date ?? raw.week ?? raw.month ?? raw.session ?? 'unknown');
  const models = Array.isArray(raw.modelsUsed) ? raw.modelsUsed.filter((x): x is string => typeof x === 'string')
    : Array.isArray(raw.models) ? raw.models.filter((x): x is string => typeof x === 'string') : [];
  const breakdowns = Array.isArray(raw.modelBreakdowns) ? raw.modelBreakdowns : [];
  const unpriced = breakdowns.some(value => {
    if (!value || typeof value !== 'object') return false;
    return (value as Record<string, unknown>).missingPricing === true;
  });
  const costUSD = noCost ? null : costOrNull(raw.totalCost ?? raw.costUSD);
  return {
    period, agent: typeof raw.agent === 'string' ? raw.agent : 'all',
    session: kind === 'session' ? period : undefined, models,
    inputTokens: numberOrNull(raw.inputTokens, 'inputTokens'),
    outputTokens: numberOrNull(raw.outputTokens, 'outputTokens'),
    cacheReadTokens: numberOrNull(raw.cacheReadTokens, 'cacheReadTokens'),
    cacheCreationTokens: numberOrNull(raw.cacheCreationTokens, 'cacheCreationTokens'),
    reasoningTokens: numberOrNull(raw.reasoningTokens, 'reasoningTokens'),
    totalTokens: numberOrNull(raw.totalTokens, 'totalTokens'), costUSD,
    pricing: noCost ? 'hidden' : unpriced ? 'unpriced' : costUSD === null ? 'unknown' : 'priced', raw,
  };
}

export function normalizeUsageSection(raw: Record<string, unknown>, kind: UsageKind, noCost = false): UsageSection {
  const rowsValue = raw[kind] ?? raw.data;
  if (!Array.isArray(rowsValue)) throw new Error(`ccusage ${kind}: missing ${kind} array`);
  const totalsValue = raw.totals ?? raw.summary;
  const totals = totalsValue && typeof totalsValue === 'object' && !Array.isArray(totalsValue) ? totalsValue as Record<string, unknown> : null;
  const unpriced = Array.isArray(totals?.unpricedModels) && totals.unpricedModels.length > 0;
  const rows = rowsValue.flatMap(value => {
    const periodRow = asObject(value, `${kind} row`);
    const agents = Array.isArray(periodRow.agents) ? periodRow.agents : [];
    if (!agents.length) return [normalizeUsageRow(periodRow, kind, noCost)];
    return agents.map(agentValue => normalizeUsageRow({
      ...asObject(agentValue, `${kind} agent`),
      period: periodRow.period ?? periodRow.date ?? periodRow.week ?? periodRow.month ?? periodRow.session,
    }, kind, noCost));
  });
  if (unpriced) {
    for (const row of rows) if (row.pricing === 'priced' && row.agent === 'all') row.pricing = 'unpriced';
  }
  return { kind, rows, totals, raw };
}

export async function collectUsage(options: UsageOptions): Promise<UsageData> {
  validateSourceDirs(options.sourceDirs);
  const sections: UsageData['sections'] = {};
  const status: ModuleResult[] = [];
  for (const kind of usageKinds) {
    try {
      const raw = await executeCcusage(kind, options);
      sections[kind] = normalizeUsageSection(raw, kind, options.noCost);
      status.push({ source: `ccusage:${kind}`, state: sections[kind]?.rows.length ? 'success' : 'empty', count: sections[kind]?.rows.length, version: CCUSAGE_VERSION });
    } catch (error) { status.push({ source: `ccusage:${kind}`, state: options.signal?.aborted ? 'cancelled' : 'failed', detail: String(error), version: CCUSAGE_VERSION }); }
  }
  return { engine: 'ccusage', version: CCUSAGE_VERSION, sections, status };
}
